const test = require("node:test");
const assert = require("node:assert/strict");

const {
  authKeyGenerator,
  createRateLimiter,
  fileDownloadKeyGenerator,
} = require("./rate-limit.middleware");
const {
  createMemoryRateLimitStore,
} = require("../system/rate-limit-store");

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

async function invoke(limiter, request = {}) {
  const response = createResponse();
  let continued = false;
  await limiter(request, response, () => {
    continued = true;
  });
  return { response, continued };
}

test("rate limiter meneruskan request sampai batas dan menolak sisanya", async () => {
  let now = 1_000;
  const limiter = createRateLimiter({
    windowMs: 60_000,
    max: 2,
    keyGenerator: () => "same-key",
    profile: "test",
    store: createMemoryRateLimitStore({ now: () => now }),
  });

  for (let index = 0; index < 2; index += 1) {
    const result = await invoke(limiter);
    assert.equal(result.continued, true);
    assert.equal(result.response.statusCode, 200);
    assert.equal(result.response.headers["RateLimit-Limit"], "2");
  }

  const blocked = await invoke(limiter, { requestId: "request-123" });
  assert.equal(blocked.continued, false);
  assert.equal(blocked.response.statusCode, 429);
  assert.equal(blocked.response.payload.status, false);
  assert.equal(blocked.response.payload.success, false);
  assert.equal(blocked.response.payload.request_id, "request-123");
  assert.equal(blocked.response.headers["RateLimit-Remaining"], "0");
  assert.match(blocked.response.headers["Retry-After"], /^\d+$/);

  now += 60_001;
  const afterReset = await invoke(limiter);
  assert.equal(afterReset.continued, true);
});

test("rate limiter tetap berjalan setelah menerima banyak kunci unik", async () => {
  let keyIndex = 0;
  const limiter = createRateLimiter({
    windowMs: 60_000,
    max: 1,
    keyGenerator: () => `key-${keyIndex++}`,
    store: createMemoryRateLimitStore(),
  });

  for (let index = 0; index < 5100; index += 1) {
    const result = await invoke(limiter);
    assert.equal(result.continued, true);
  }
});

test("key autentikasi dinormalisasi dan dibatasi sebelum di-hash", () => {
  const prefix = "A".repeat(128);
  const baseRequest = {
    ip: "127.0.0.1",
    method: "POST",
    path: "/login",
  };

  assert.equal(
    authKeyGenerator({
      ...baseRequest,
      body: { username: `  ${prefix}PERTAMA  ` },
    }),
    authKeyGenerator({
      ...baseRequest,
      body: { username: `${prefix.toLowerCase()}KEDUA` },
    }),
  );
});

test("key download memakai scope akses tanpa token atau path file", () => {
  const key = fileDownloadKeyGenerator({
    ip: "127.0.0.1",
    path: "/dokumen-rahasia.pdf",
    query: { access_token: "token-yang-tidak-boleh-masuk-key" },
    fileAccess: {
      user_id: "user-123",
      module: "digital_archive",
    },
  });

  assert.match(key, /user:user-123/);
  assert.match(key, /module:digital_archive/);
  assert.equal(key.includes("token-yang-tidak-boleh-masuk-key"), false);
  assert.equal(key.includes("dokumen-rahasia.pdf"), false);
});

test("kegagalan store ditolak aman tanpa membocorkan error", async () => {
  const limiter = createRateLimiter({
    store: {
      async consume() {
        throw new Error("redis://user:secret@internal:6379");
      },
    },
    profile: "store-failure-test",
  });

  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await invoke(limiter, { requestId: "request-503" });
    assert.equal(result.continued, false);
    assert.equal(result.response.statusCode, 503);
    assert.equal(result.response.payload.request_id, "request-503");
    assert.equal(
      JSON.stringify(result.response.payload).includes("secret"),
      false,
    );
  } finally {
    console.error = originalError;
  }
});
