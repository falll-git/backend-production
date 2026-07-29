const assert = require("node:assert/strict");
const test = require("node:test");

const {
  INSPECT_HEARTBEAT_SCRIPT,
  RECORD_HEARTBEAT_SCRIPT,
  RELEASE_HEARTBEAT_SCRIPT,
  createMemoryWorkerHeartbeatStore,
  createRedisWorkerHeartbeatStore,
  createWorkerHeartbeat,
} = require("./worker-heartbeat");

test("heartbeat menandai worker aktif, kedaluwarsa, lalu pulih setelah beat baru", async () => {
  let now = 1000;
  let scheduledCallback;
  const store = createMemoryWorkerHeartbeatStore({ now: () => now });
  const heartbeat = createWorkerHeartbeat({
    role: "watermark-worker",
    store,
    token: "worker-a",
    intervalMs: 4000,
    ttlMs: 10000,
    now: () => now,
    setIntervalFn(callback) {
      scheduledCallback = callback;
      return { unref() {} };
    },
    clearIntervalFn() {},
    logger: { warn() {} },
  });

  await heartbeat.start();
  assert.deepEqual(await store.inspect({ role: "watermark-worker" }), {
    worker_count: 1,
    workers_available: true,
    ttl_ms: 10000,
  });

  now = 11001;
  assert.deepEqual(await store.inspect({ role: "watermark-worker" }), {
    worker_count: 0,
    workers_available: false,
    ttl_ms: 0,
  });

  scheduledCallback();
  await heartbeat.beat();
  assert.deepEqual(await store.inspect({ role: "watermark-worker" }), {
    worker_count: 1,
    workers_available: true,
    ttl_ms: 10000,
  });

  await heartbeat.stop();
  assert.equal(
    (await store.inspect({ role: "watermark-worker" })).worker_count,
    0,
  );
});

test("heartbeat mendukung beberapa instance tanpa saling menghapus", async () => {
  let now = 5000;
  const store = createMemoryWorkerHeartbeatStore({ now: () => now });
  const baseOptions = {
    role: "watermark-worker",
    store,
    intervalMs: 3000,
    ttlMs: 10000,
    now: () => now,
    setIntervalFn() {
      return { unref() {} };
    },
    clearIntervalFn() {},
    logger: { warn() {} },
  };
  const first = createWorkerHeartbeat({ ...baseOptions, token: "worker-a" });
  const second = createWorkerHeartbeat({ ...baseOptions, token: "worker-b" });

  await first.start();
  await second.start();
  assert.equal(
    (await store.inspect({ role: "watermark-worker" })).worker_count,
    2,
  );

  await first.stop();
  assert.equal(
    (await store.inspect({ role: "watermark-worker" })).worker_count,
    1,
  );

  now += 10001;
  assert.equal(
    (await store.inspect({ role: "watermark-worker" })).worker_count,
    0,
  );
  await second.stop();
});

test("Redis heartbeat memakai sorted set bertoken dan tidak mengeluarkan URL atau token", async () => {
  const calls = [];
  const client = {
    status: "ready",
    async eval(...args) {
      calls.push(args);
      if (args[0] === INSPECT_HEARTBEAT_SCRIPT) return [2, 9000];
      return 1;
    },
    async quit() {},
  };
  const store = createRedisWorkerHeartbeatStore({
    client,
    prefix: "test:worker-heartbeat",
  });

  await store.beat({
    role: "watermark-worker",
    token: "private-instance-token",
    ttlMs: 15000,
    nowMs: 1000,
  });
  const details = await store.inspect({
    role: "watermark-worker",
    nowMs: 2000,
  });
  await store.release({
    role: "watermark-worker",
    token: "private-instance-token",
  });

  assert.deepEqual(details, {
    worker_count: 2,
    workers_available: true,
    ttl_ms: 9000,
  });
  assert.equal(calls[0][0], RECORD_HEARTBEAT_SCRIPT);
  assert.equal(calls[0][2], "test:worker-heartbeat:watermark-worker");
  assert.equal(calls[1][0], INSPECT_HEARTBEAT_SCRIPT);
  assert.equal(calls[2][0], RELEASE_HEARTBEAT_SCRIPT);
  assert.equal(JSON.stringify(details).includes("private-instance-token"), false);
  assert.equal(JSON.stringify(details).includes("redis://"), false);
});

test("TTL heartbeat wajib lebih besar dari dua interval", () => {
  assert.throws(
    () =>
      createWorkerHeartbeat({
        role: "watermark-worker",
        store: {},
        intervalMs: 5000,
        ttlMs: 10000,
      }),
    /lebih besar dari dua kali/,
  );
});
