const test = require("node:test");
const assert = require("node:assert/strict");

const {
  INCREMENT_WITH_TTL_SCRIPT,
  createRedisRateLimitStore,
  hashRateLimitKey,
  resolveRateLimitStoreMode,
} = require("./rate-limit-store");

test("mode Redis menjadi default production dan memory hanya default non-production", () => {
  assert.equal(resolveRateLimitStoreMode({ NODE_ENV: "production" }), "redis");
  assert.equal(resolveRateLimitStoreMode({ NODE_ENV: "development" }), "memory");
  assert.equal(
    resolveRateLimitStoreMode({
      NODE_ENV: "development",
      RATE_LIMIT_STORE: "redis",
    }),
    "redis",
  );
});

test("key rate limit memakai HMAC dan tidak menyimpan identitas mentah", () => {
  const rawKey = "identity:admin@example.com";
  const digest = hashRateLimitKey(rawKey, "test-rate-limit-secret-redacted");
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digest.includes("admin@example.com"), false);
});

test("Redis store memakai satu evaluasi atomik dan key ter-hash", async () => {
  const calls = [];
  const client = {
    status: "ready",
    async eval(...args) {
      calls.push(args);
      return [3, 5000];
    },
    async ping() {
      return "PONG";
    },
    async quit() {},
  };
  const store = createRedisRateLimitStore({
    client,
    keySecret: "test-rate-limit-secret-redacted",
    namespace: "test:rate-limit",
  });

  const before = Date.now();
  const result = await store.consume({
    key: "identity:admin@example.com",
    windowMs: 60_000,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], INCREMENT_WITH_TTL_SCRIPT);
  assert.equal(calls[0][1], 1);
  assert.match(calls[0][2], /^test:rate-limit:[a-f0-9]{64}$/);
  assert.equal(calls[0][2].includes("admin@example.com"), false);
  assert.equal(calls[0][3], "60000");
  assert.equal(result.count, 3);
  assert.ok(result.resetAt >= before + 4900);
});
