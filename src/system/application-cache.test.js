const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RELEASE_LOCK_SCRIPT,
  buildCacheKey,
  createApplicationCache,
  createMemoryCacheStore,
  createRedisCacheStore,
  stableSerialize,
} = require("./application-cache");

test("serialisasi dan key cache stabil walau urutan property berbeda", () => {
  assert.equal(
    stableSerialize({ b: 2, a: { d: 4, c: 3 } }),
    stableSerialize({ a: { c: 3, d: 4 }, b: 2 }),
  );
  assert.equal(
    buildCacheKey({
      namespace: "parameter:test",
      version: 1,
      parts: { page: 1, filter: { active: true } },
    }),
    buildCacheKey({
      namespace: "parameter:test",
      version: 1,
      parts: { filter: { active: true }, page: 1 },
    }),
  );
});

test("cache-aside menghasilkan miss lalu hit tanpa memanggil loader lagi", async () => {
  const store = createMemoryCacheStore();
  const cache = createApplicationCache({ enabled: true, store, random: () => 0 });
  let loads = 0;
  const loader = async () => ({ value: ++loads });

  const first = await cache.getOrLoad({
    namespace: "parameter:test",
    parts: { type: "list" },
    loader,
  });
  const second = await cache.getOrLoad({
    namespace: "parameter:test",
    parts: { type: "list" },
    loader,
  });

  assert.deepEqual(first, { value: 1 });
  assert.deepEqual(second, { value: 1 });
  assert.equal(loads, 1);
  assert.equal(cache.metrics().miss, 1);
  assert.equal(cache.metrics().hit, 1);
});

test("TTL kedaluwarsa dan invalidasi namespace memaksa pembacaan ulang", async () => {
  let now = 1000;
  const store = createMemoryCacheStore({ now: () => now });
  const cache = createApplicationCache({
    enabled: true,
    store,
    ttlMs: 100,
    jitterPercent: 0,
    now: () => now,
  });
  let loads = 0;
  const read = () =>
    cache.getOrLoad({
      namespace: "parameter:test",
      parts: { id: "one" },
      loader: async () => ++loads,
    });

  assert.equal(await read(), 1);
  now += 101;
  assert.equal(await read(), 2);
  await cache.invalidate("parameter:test");
  assert.equal(await read(), 3);
});

test("kegagalan Redis bersifat fail-open dan error loader tidak disimpan", async () => {
  const failingStore = {
    prefix: "test:cache",
    async getVersion() {
      throw new Error("redis://secret@internal");
    },
    async close() {},
  };
  const cache = createApplicationCache({ enabled: true, store: failingStore });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await cache.getOrLoad({
      namespace: "parameter:test",
      parts: {},
      loader: async () => "database-result",
    });
    assert.equal(result, "database-result");
    assert.equal(cache.metrics().error, 1);
  } finally {
    console.warn = originalWarn;
  }

  const memoryStore = createMemoryCacheStore();
  const secondCache = createApplicationCache({
    enabled: true,
    store: memoryStore,
  });
  let attempts = 0;
  await assert.rejects(
    secondCache.getOrLoad({
      namespace: "parameter:error",
      parts: {},
      loader: async () => {
        attempts += 1;
        throw new Error("database failed");
      },
    }),
    /database failed/,
  );
  await assert.rejects(
    secondCache.getOrLoad({
      namespace: "parameter:error",
      parts: {},
      loader: async () => {
        attempts += 1;
        throw new Error("database failed");
      },
    }),
    /database failed/,
  );
  assert.equal(attempts, 2);
});

test("entry terlalu besar tidak disimpan", async () => {
  const store = createMemoryCacheStore();
  const cache = createApplicationCache({
    enabled: true,
    store,
    maxEntryBytes: 32,
  });
  let loads = 0;
  const read = () =>
    cache.getOrLoad({
      namespace: "parameter:large",
      parts: {},
      loader: async () => {
        loads += 1;
        return "x".repeat(100);
      },
    });

  await read();
  await read();
  assert.equal(loads, 2);
  assert.equal(cache.metrics().skipped_oversize, 2);
});

test("single-flight lintas instance mencegah stampede pada key yang sama", async () => {
  const store = createMemoryCacheStore();
  const options = {
    enabled: true,
    store,
    waitIntervalMs: 5,
    waitTimeoutMs: 200,
    lockTtlMs: 1000,
  };
  const firstCache = createApplicationCache(options);
  const secondCache = createApplicationCache(options);
  let loads = 0;
  const loader = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { ok: true };
  };

  const [first, second] = await Promise.all([
    firstCache.getOrLoad({
      namespace: "parameter:stampede",
      parts: { page: 1 },
      loader,
    }),
    secondCache.getOrLoad({
      namespace: "parameter:stampede",
      parts: { page: 1 },
      loader,
    }),
  ]);

  assert.deepEqual(first, { ok: true });
  assert.deepEqual(second, { ok: true });
  assert.equal(loads, 1);
});

test("Redis store memakai prefix terpisah, TTL, lock NX, dan unlock bertoken", async () => {
  const calls = [];
  const client = {
    status: "ready",
    async get(key) {
      calls.push(["get", key]);
      return key.endsWith(":version") ? "4" : null;
    },
    async set(...args) {
      calls.push(["set", ...args]);
      return args.includes("NX") ? "OK" : "OK";
    },
    async del(key) {
      calls.push(["del", key]);
      return 1;
    },
    async incr(key) {
      calls.push(["incr", key]);
      return 5;
    },
    async eval(...args) {
      calls.push(["eval", ...args]);
      return 1;
    },
    async ping() {
      return "PONG";
    },
    async quit() {},
  };
  const store = createRedisCacheStore({ client, prefix: "test:app-cache" });

  assert.equal(await store.getVersion("parameter:test"), 4);
  await store.set("test:key", "value", 1000);
  assert.equal(await store.acquireLock("test:key", "token", 5000), true);
  await store.releaseLock("test:key", "token");
  assert.equal(await store.bumpVersion("parameter:test"), 5);

  assert.deepEqual(calls[0], [
    "get",
    "test:app-cache:parameter:test:version",
  ]);
  assert.ok(
    calls.some(
      (call) =>
        call[0] === "set" &&
        call[1] === "test:key" &&
        call[3] === "PX" &&
        call[4] === 1000,
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call[0] === "set" &&
        call[1] === "test:key:lock" &&
        call.includes("NX"),
    ),
  );
  assert.ok(
    calls.some(
      (call) => call[0] === "eval" && call[1] === RELEASE_LOCK_SCRIPT,
    ),
  );
});
