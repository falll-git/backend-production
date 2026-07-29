const test = require("node:test");
const assert = require("node:assert/strict");
const { createReadinessService } = require("./health.service");

test("readiness siap ketika seluruh dependency wajib tersedia", async () => {
  const service = createReadinessService({
    databaseCheck: async () => true,
    storageCheck: async () => true,
    redisCheck: async () => true,
    queueEnabled: true,
    now: () => Date.parse("2026-07-21T12:00:00.000Z"),
  });

  const result = await service.checkReadiness({ force: true });

  assert.equal(result.ready, true);
  assert.equal(result.state, "ready");
  assert.equal(result.checks.database.status, "up");
  assert.equal(result.checks.storage.status, "up");
  assert.equal(result.checks.redis.status, "up");
});

test("readiness gagal ketika database wajib tidak tersedia", async () => {
  const service = createReadinessService({
    databaseCheck: async () => {
      throw new Error("database unavailable");
    },
    storageCheck: async () => true,
    queueEnabled: false,
  });

  const result = await service.checkReadiness({ force: true });

  assert.equal(result.ready, false);
  assert.equal(result.state, "not_ready");
  assert.deepEqual(result.checks.database.required, true);
  assert.equal(result.checks.database.status, "down");
  assert.equal(result.checks.redis.status, "disabled");
  assert.equal(JSON.stringify(result).includes("database unavailable"), false);
});

test("queue Redis yang gagal menandai API degraded tanpa menjatuhkan readiness", async () => {
  const service = createReadinessService({
    databaseCheck: async () => true,
    storageCheck: async () => true,
    redisCheck: async () => {
      throw new Error("redis unavailable");
    },
    queueEnabled: true,
  });

  const result = await service.checkReadiness({ force: true });

  assert.equal(result.ready, true);
  assert.equal(result.state, "degraded");
  assert.equal(result.checks.redis.required, false);
  assert.equal(result.checks.redis.status, "down");
});

test("readiness hanya mempublikasikan detail kapasitas dan database yang aman", async () => {
  const service = createReadinessService({
    databaseCheck: async () => ({
      invalid_indexes: 0,
      active_slow_queries: 0,
    }),
    storageCheck: async () => ({
      writable: true,
      capacity: { free_bytes: 1024, free_inodes: 100 },
    }),
    queueEnabled: false,
  });

  const result = await service.checkReadiness({ force: true });
  const serialized = JSON.stringify(result);
  assert.equal(result.checks.database.details.invalid_indexes, 0);
  assert.equal(result.checks.storage.details.capacity.free_bytes, 1024);
  assert.equal(serialized.includes("DATABASE_URL"), false);
  assert.equal(serialized.includes("UPLOAD_DIR"), false);
});

test("readiness gagal ketika Redis rate limit yang wajib tidak tersedia", async () => {
  const service = createReadinessService({
    databaseCheck: async () => true,
    storageCheck: async () => true,
    queueEnabled: false,
    rateLimitRedisEnabled: true,
    rateLimitStoreCheck: async () => {
      throw new Error("redis rate limit unavailable");
    },
  });

  const result = await service.checkReadiness({ force: true });

  assert.equal(result.ready, false);
  assert.equal(result.state, "not_ready");
  assert.equal(result.checks.redis.status, "disabled");
  assert.equal(result.checks.rate_limit_store.required, true);
  assert.equal(result.checks.rate_limit_store.status, "down");
  assert.equal(JSON.stringify(result).includes("unavailable"), false);
});

test("application cache yang gagal hanya menandai degraded karena fallback database aktif", async () => {
  const service = createReadinessService({
    databaseCheck: async () => true,
    storageCheck: async () => true,
    queueEnabled: false,
    rateLimitRedisEnabled: false,
    applicationCacheEnabled: true,
    applicationCacheCheck: async () => {
      throw new Error("cache unavailable");
    },
  });

  const result = await service.checkReadiness({ force: true });

  assert.equal(result.ready, true);
  assert.equal(result.state, "degraded");
  assert.equal(result.checks.application_cache.required, false);
  assert.equal(result.checks.application_cache.status, "down");
  assert.equal(JSON.stringify(result).includes("cache unavailable"), false);
});

test("watermark worker yang tidak aktif menandai API degraded tanpa membocorkan identitas", async () => {
  const service = createReadinessService({
    databaseCheck: async () => true,
    storageCheck: async () => true,
    queueEnabled: false,
    rateLimitRedisEnabled: false,
    applicationCacheEnabled: false,
    watermarkWorkerEnabled: true,
    watermarkWorkerCheck: async () => ({
      enabled: true,
      worker_count: 0,
      workers_available: false,
      ttl_ms: 0,
    }),
  });

  const result = await service.checkReadiness({ force: true });

  assert.equal(result.ready, true);
  assert.equal(result.state, "degraded");
  assert.equal(result.checks.watermark_worker.required, false);
  assert.equal(result.checks.watermark_worker.status, "degraded");
  assert.equal(result.checks.watermark_worker.details.worker_count, 0);
  assert.equal(JSON.stringify(result).includes("worker-token"), false);
  assert.equal(JSON.stringify(result).includes("redis://"), false);
});

test("readiness pulih ketika watermark worker kembali aktif", async () => {
  const service = createReadinessService({
    databaseCheck: async () => true,
    storageCheck: async () => true,
    queueEnabled: false,
    rateLimitRedisEnabled: false,
    applicationCacheEnabled: false,
    watermarkWorkerEnabled: true,
    watermarkWorkerCheck: async () => ({
      enabled: true,
      worker_count: 1,
      workers_available: true,
      ttl_ms: 12000,
    }),
  });

  const result = await service.checkReadiness({ force: true });

  assert.equal(result.ready, true);
  assert.equal(result.state, "ready");
  assert.equal(result.checks.watermark_worker.status, "up");
  assert.equal(result.checks.watermark_worker.details.worker_count, 1);
});

test("observability yang gagal start menandai API degraded tanpa menjadi dependency wajib", async () => {
  const service = createReadinessService({
    databaseCheck: async () => true,
    storageCheck: async () => true,
    queueEnabled: false,
    rateLimitRedisEnabled: false,
    applicationCacheEnabled: false,
    watermarkWorkerEnabled: false,
    observabilityEnabled: true,
    observabilityCheck: async () => {
      throw new Error("collector unavailable with secret");
    },
  });

  const result = await service.checkReadiness({ force: true });

  assert.equal(result.ready, true);
  assert.equal(result.state, "degraded");
  assert.equal(result.checks.observability.required, false);
  assert.equal(result.checks.observability.status, "down");
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("readiness langsung gagal ketika instance memasuki drain", async () => {
  let dependencyCalls = 0;
  const dependencyCheck = async () => {
    dependencyCalls += 1;
    return {};
  };
  const service = createReadinessService({
    databaseCheck: dependencyCheck,
    storageCheck: dependencyCheck,
    queueEnabled: false,
    rateLimitRedisEnabled: false,
    applicationCacheEnabled: false,
    isDraining: () => true,
  });

  const result = await service.checkReadiness({ force: true });

  assert.equal(result.ready, false);
  assert.equal(result.state, "draining");
  assert.deepEqual(result.checks, {});
  assert.equal(dependencyCalls, 0);
});

test("worker SLIK yang tidak tersedia menandai API degraded dan backlog tetap terlihat", async () => {
  const service = createReadinessService({
    databaseCheck: async () => true,
    storageCheck: async () => true,
    queueEnabled: true,
    redisCheck: async () => ({
      enabled: true,
      reachable: true,
      worker_required: true,
      workers_available: false,
      worker_count: 0,
      queue_counts: {
        waiting: 7,
        active: 0,
        delayed: 1,
        failed: 0,
      },
    }),
    rateLimitRedisEnabled: false,
    applicationCacheEnabled: false,
  });

  const result = await service.checkReadiness({ force: true });

  assert.equal(result.ready, true);
  assert.equal(result.state, "degraded");
  assert.equal(result.checks.redis.required, false);
  assert.equal(result.checks.redis.status, "degraded");
  assert.equal(result.checks.redis.details.queue_counts.waiting, 7);
});
