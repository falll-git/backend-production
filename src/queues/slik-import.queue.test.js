const assert = require("node:assert/strict");
const test = require("node:test");
const {
  checkSlikImportQueueHealth,
  closeSlikImportQueue,
  disconnectTrackedRedisConnections,
  enqueueSlikImportJob,
  getRedisUrl,
  isSlikImportLocalFallbackEnabled,
  isSlikImportWorkerRequired,
  trackRedisConnection,
} = require("./slik-import.queue");
const {
  runWithRequestContext,
} = require("../utils/request-context");

test("fallback lokal hanya menjadi default di luar production", () => {
  assert.equal(
    isSlikImportLocalFallbackEnabled({ NODE_ENV: "development" }),
    true,
  );
  assert.equal(
    isSlikImportLocalFallbackEnabled({ NODE_ENV: "production" }),
    false,
  );
  assert.equal(
    isSlikImportLocalFallbackEnabled({
      NODE_ENV: "development",
      SLIK_IMPORT_LOCAL_FALLBACK_ENABLED: "false",
    }),
    false,
  );
});

test("worker SLIK menjadi dependency wajib secara default di production", () => {
  assert.equal(isSlikImportWorkerRequired({ NODE_ENV: "production" }), true);
  assert.equal(isSlikImportWorkerRequired({ NODE_ENV: "development" }), false);
});

test("queue production tidak diam-diam memakai Redis localhost", () => {
  assert.throws(
    () => getRedisUrl({ NODE_ENV: "production" }),
    /wajib untuk queue production/,
  );
  assert.equal(
    getRedisUrl({
      NODE_ENV: "production",
      JOB_QUEUE_REDIS_URL: "redis://queue.internal:6379",
    }),
    "redis://queue.internal:6379",
  );
});

test("health queue melaporkan worker aktif dan backlog tanpa data koneksi", async () => {
  const originalEnabled = process.env.SLIK_IMPORT_QUEUE_ENABLED;
  const originalRequired = process.env.SLIK_IMPORT_REQUIRE_WORKER;
  process.env.SLIK_IMPORT_QUEUE_ENABLED = "true";
  process.env.SLIK_IMPORT_REQUIRE_WORKER = "true";

  try {
    const result = await checkSlikImportQueueHealth(1000, {
      queueInstance: {
        async waitUntilReady() {},
        async getWorkersCount() {
          return 2;
        },
        async getJobCounts() {
          return { waiting: 3, active: 1, delayed: 2, failed: 4 };
        },
      },
    });

    assert.deepEqual(result, {
      enabled: true,
      reachable: true,
      worker_required: true,
      worker_count: 2,
      workers_available: true,
      queue_counts: {
        waiting: 3,
        active: 1,
        delayed: 2,
        failed: 4,
      },
    });
    assert.equal(JSON.stringify(result).includes("redis://"), false);
  } finally {
    if (originalEnabled === undefined) {
      delete process.env.SLIK_IMPORT_QUEUE_ENABLED;
    } else {
      process.env.SLIK_IMPORT_QUEUE_ENABLED = originalEnabled;
    }
    if (originalRequired === undefined) {
      delete process.env.SLIK_IMPORT_REQUIRE_WORKER;
    } else {
      process.env.SLIK_IMPORT_REQUIRE_WORKER = originalRequired;
    }
  }
});

test("job tetap masuk backlog saat worker belum aktif dan health pulih saat worker aktif", async () => {
  const originalEnabled = process.env.SLIK_IMPORT_QUEUE_ENABLED;
  const originalRequired = process.env.SLIK_IMPORT_REQUIRE_WORKER;
  process.env.SLIK_IMPORT_QUEUE_ENABLED = "true";
  process.env.SLIK_IMPORT_REQUIRE_WORKER = "true";
  const added = [];
  let workerCount = 0;
  const jobs = new Map();
  const queueInstance = {
    async waitUntilReady() {},
    async getJob(jobId) {
      return jobs.get(jobId) || null;
    },
    async add(name, data, options) {
      const job = { id: options.jobId, name, data };
      jobs.set(options.jobId, job);
      added.push(job);
      return job;
    },
    async getWorkersCount() {
      return workerCount;
    },
    async getJobCounts() {
      return {
        waiting: added.length,
        active: 0,
        delayed: 0,
        failed: 0,
      };
    },
  };

  try {
    const queuedJob = await runWithRequestContext(
      { request_id: "request-import-123" },
      () =>
        enqueueSlikImportJob({
          jobId: "import-123",
          userId: "user-123",
          queueInstance,
        }),
    );
    const withoutWorker = await checkSlikImportQueueHealth(1000, {
      queueInstance,
    });

    assert.equal(queuedJob.id, "slik-import-import-123");
    assert.equal(queuedJob.data.requestId, "request-import-123");
    assert.equal(added.length, 1);
    assert.equal(withoutWorker.workers_available, false);
    assert.equal(withoutWorker.queue_counts.waiting, 1);

    workerCount = 1;
    const recovered = await checkSlikImportQueueHealth(1000, {
      queueInstance,
    });
    assert.equal(recovered.workers_available, true);
    assert.equal(recovered.worker_count, 1);
    assert.equal(recovered.queue_counts.waiting, 1);
  } finally {
    if (originalEnabled === undefined) {
      delete process.env.SLIK_IMPORT_QUEUE_ENABLED;
    } else {
      process.env.SLIK_IMPORT_QUEUE_ENABLED = originalEnabled;
    }
    if (originalRequired === undefined) {
      delete process.env.SLIK_IMPORT_REQUIRE_WORKER;
    } else {
      process.env.SLIK_IMPORT_REQUIRE_WORKER = originalRequired;
    }
  }
});

test("shutdown queue memutus koneksi Redis eksternal agar proses tidak tertahan retry", async () => {
  let disconnected = 0;
  const connection = {
    status: "reconnecting",
    once() {},
    disconnect() {
      disconnected += 1;
      this.status = "end";
    },
  };
  trackRedisConnection(connection);

  try {
    await closeSlikImportQueue();
    assert.equal(disconnected, 1);
    assert.equal(connection.status, "end");
  } finally {
    disconnectTrackedRedisConnections();
  }
});
