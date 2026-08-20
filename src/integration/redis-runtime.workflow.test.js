const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const Redis = require("ioredis");

const RUN_REDIS_INTEGRATION =
  process.env.RUN_REDIS_INTEGRATION === "true";
const REDIS_URL = String(process.env.REDIS_INTEGRATION_URL || "").trim();
const RUN_ID = crypto.randomUUID().replaceAll("-", "");

process.env.SLIK_IMPORT_QUEUE_ENABLED = "true";
process.env.JOB_QUEUE_REDIS_URL ||= REDIS_URL;
process.env.SLIK_IMPORT_QUEUE_NAME = `redis-runtime-${RUN_ID.slice(0, 16)}`;

const {
  createApplicationCache,
  createRedisCacheStore,
} = require("../system/application-cache");
const {
  createRedisWorkerHeartbeatStore,
  createWorkerHeartbeat,
} = require("../system/worker-heartbeat");
const {
  checkSlikImportQueueHealth,
  closeSlikImportQueue,
  createSlikImportWorker,
  enqueueSlikImportJob,
} = require("../queues/slik-import.queue");

function createRedisClient() {
  return new Redis(REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 3_000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
}

async function deleteMatchingKeys(client, patterns) {
  for (const pattern of patterns) {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await client.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = nextCursor;
      if (keys.length > 0) await client.del(...keys);
    } while (cursor !== "0");
  }
}

function withTimeout(promise, durationMs, message) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), durationMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

test(
  "Redis nyata mendukung application cache, worker heartbeat, dan antrean BullMQ",
  { skip: !RUN_REDIS_INTEGRATION },
  async (t) => {
    assert.match(REDIS_URL, /^rediss?:\/\//, "URL Redis integration wajib diisi.");

    const cachePrefix = `test:cache:${RUN_ID}`;
    const heartbeatPrefix = `test:heartbeat:${RUN_ID}`;
    const queuePrefix = `bull:${process.env.SLIK_IMPORT_QUEUE_NAME}`;
    const cleanupClient = createRedisClient();
    const cacheStore = createRedisCacheStore({
      client: createRedisClient(),
      prefix: cachePrefix,
    });
    const cache = createApplicationCache({
      enabled: true,
      store: cacheStore,
      ttlMs: 10_000,
      jitterPercent: 0,
    });
    const heartbeatStore = createRedisWorkerHeartbeatStore({
      client: createRedisClient(),
      prefix: heartbeatPrefix,
    });
    const heartbeat = createWorkerHeartbeat({
      role: "watermark-worker",
      store: heartbeatStore,
      intervalMs: 100,
      ttlMs: 1_000,
    });
    let worker;
    let runPromise;

    t.after(async () => {
      await heartbeat.stop().catch(() => {});
      await heartbeatStore.close().catch(() => {});
      if (worker) await worker.close(true).catch(() => {});
      await closeSlikImportQueue().catch(() => {});
      if (runPromise) await runPromise.catch(() => {});
      await cache.close().catch(() => {});
      try {
        if (cleanupClient.status === "wait") await cleanupClient.connect();
        await deleteMatchingKeys(cleanupClient, [
          `${cachePrefix}:*`,
          `${heartbeatPrefix}:*`,
          `${queuePrefix}:*`,
        ]);
      } finally {
        if (cleanupClient.status !== "end") await cleanupClient.quit();
      }
    });

    let loaderCalls = 0;
    const loadValue = () => {
      loaderCalls += 1;
      return { value: loaderCalls };
    };
    const first = await cache.getOrLoad({
      namespace: "parameters",
      parts: ["all"],
      loader: loadValue,
    });
    const second = await cache.getOrLoad({
      namespace: "parameters",
      parts: ["all"],
      loader: loadValue,
    });
    assert.deepEqual(first, { value: 1 });
    assert.deepEqual(second, first);
    assert.equal(loaderCalls, 1, "Pembacaan kedua wajib berasal dari Redis.");
    assert.equal(await cache.invalidate("parameters"), true);
    const afterInvalidation = await cache.getOrLoad({
      namespace: "parameters",
      parts: ["all"],
      loader: loadValue,
    });
    assert.deepEqual(afterInvalidation, { value: 2 });
    assert.deepEqual(await cache.ping(), { enabled: true, mode: "redis" });

    await heartbeat.start();
    const heartbeatActive = await heartbeatStore.inspect({
      role: "watermark-worker",
    });
    assert.equal(heartbeatActive.workers_available, true);
    assert.equal(heartbeatActive.worker_count, 1);
    await heartbeat.stop();
    const heartbeatReleased = await heartbeatStore.inspect({
      role: "watermark-worker",
    });
    assert.equal(heartbeatReleased.workers_available, false);
    assert.equal(heartbeatReleased.worker_count, 0);

    const processed = new Promise((resolve, reject) => {
      worker = createSlikImportWorker(async (jobId, userId) => {
        assert.equal(jobId, `job-${RUN_ID}`);
        assert.equal(userId, `user-${RUN_ID}`);
        resolve({ jobId, userId });
      }, { autorun: false });
      worker.once("failed", (_job, error) => reject(error));
    });
    runPromise = worker.run();
    await worker.waitUntilReady();
    await enqueueSlikImportJob({
      jobId: `job-${RUN_ID}`,
      userId: `user-${RUN_ID}`,
    });

    const result = await withTimeout(
      processed,
      8_000,
      "Worker Redis tidak selesai.",
    );
    assert.deepEqual(result, {
      jobId: `job-${RUN_ID}`,
      userId: `user-${RUN_ID}`,
    });
    const queueHealth = await checkSlikImportQueueHealth(3_000);
    assert.equal(queueHealth.reachable, true);
    assert.equal(queueHealth.workers_available, true);
  },
);
