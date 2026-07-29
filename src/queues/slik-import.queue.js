const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const {
  getRequestContext,
  runWithRequestContext,
} = require("../utils/request-context");
const {
  attachEmitterErrorLogging,
} = require("../system/infrastructure-events");
const { logger } = require("../system/logger");
const {
  SpanKind,
  injectTraceCarrier,
  runWithSpan,
} = require("../system/observability");

const queueLogger = logger.child({ component: "slik_import_queue" });

const SLIK_IMPORT_JOB_NAME = "process-slik-import";

let queue;
const redisConnections = new Set();

function readBooleanEnv(key, fallback = true) {
  const value = process.env[key];
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function readPositiveIntEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function getSlikImportQueueName(env = process.env) {
  const configured = String(env.SLIK_IMPORT_QUEUE_NAME || "").trim();
  const queueName = configured || "slik-import";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(queueName)) {
    throw new Error(
      "SLIK_IMPORT_QUEUE_NAME hanya boleh berisi huruf, angka, garis bawah, atau tanda hubung (maksimal 80 karakter).",
    );
  }
  return queueName;
}

const SLIK_IMPORT_QUEUE_NAME = getSlikImportQueueName();

function isSlikImportQueueEnabled() {
  return readBooleanEnv("SLIK_IMPORT_QUEUE_ENABLED", true);
}

function isSlikImportLocalFallbackEnabled(env = process.env) {
  const value = env.SLIK_IMPORT_LOCAL_FALLBACK_ENABLED;
  if (value === undefined || value === null || value === "") {
    return env.NODE_ENV !== "production";
  }
  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase(),
  );
}

function isSlikImportWorkerRequired(env = process.env) {
  const value = env.SLIK_IMPORT_REQUIRE_WORKER;
  if (value === undefined || value === null || value === "") {
    return env.NODE_ENV === "production";
  }
  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase(),
  );
}

function getRedisUrl(env = process.env) {
  const configured = env.JOB_QUEUE_REDIS_URL || env.REDIS_URL;
  if (configured) return configured;
  if (env.NODE_ENV === "production") {
    throw new Error(
      "JOB_QUEUE_REDIS_URL atau REDIS_URL wajib untuk queue production.",
    );
  }
  return "redis://127.0.0.1:6379";
}

function createRedisConnection({ worker = false } = {}) {
  const connection = new IORedis(getRedisUrl(), {
    connectTimeout: readPositiveIntEnv(
      "JOB_QUEUE_REDIS_CONNECT_TIMEOUT_MS",
      5000,
    ),
    maxRetriesPerRequest: worker ? null : 1,
    enableOfflineQueue: worker,
    retryStrategy(times) {
      return Math.min(times * 250, 2000);
    },
  });
  attachEmitterErrorLogging(connection, {
    component: worker
      ? "slik_import_worker_redis"
      : "slik_import_queue_redis",
    event: "redis_connection_error",
  });
  redisConnections.add(connection);
  connection.once("end", () => {
    redisConnections.delete(connection);
  });
  return connection;
}

function trackRedisConnection(connection) {
  if (!connection) return connection;
  redisConnections.add(connection);
  connection.once?.("end", () => {
    redisConnections.delete(connection);
  });
  return connection;
}

function disconnectTrackedRedisConnections() {
  for (const connection of redisConnections) {
    try {
      if (connection.status !== "end") connection.disconnect();
    } catch {
      // Shutdown tetap dilanjutkan; koneksi sedang ditutup secara paksa.
    }
  }
  redisConnections.clear();
}

async function checkSlikImportQueueHealth(
  timeoutMs = 1500,
  { queueInstance } = {},
) {
  if (!isSlikImportQueueEnabled()) {
    return {
      enabled: false,
      reachable: null,
      worker_required: isSlikImportWorkerRequired(),
      worker_count: 0,
      workers_available: false,
    };
  }

  const importQueue = queueInstance || getSlikImportQueue();
  let timeout;

  try {
    const details = await Promise.race([
      (async () => {
        await importQueue.waitUntilReady();
        const [workerCount, counts] = await Promise.all([
          importQueue.getWorkersCount(),
          importQueue.getJobCounts("waiting", "active", "delayed", "failed"),
        ]);
        return {
          enabled: true,
          reachable: true,
          worker_required: isSlikImportWorkerRequired(),
          worker_count: workerCount,
          workers_available: workerCount > 0,
          queue_counts: {
            waiting: Number(counts.waiting || 0),
            active: Number(counts.active || 0),
            delayed: Number(counts.delayed || 0),
            failed: Number(counts.failed || 0),
          },
        };
      })(),
      new Promise((resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Redis health check timed out.")),
          timeoutMs,
        );
      }),
    ]);

    return details;
  } finally {
    clearTimeout(timeout);
  }
}

function getSlikImportQueue() {
  if (!isSlikImportQueueEnabled()) {
    throw new Error("Queue import SLIK sedang dinonaktifkan.");
  }
  if (!queue) {
    queue = new Queue(SLIK_IMPORT_QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 30000,
        },
        removeOnComplete: {
          age: 86400,
          count: 1000,
        },
        removeOnFail: {
          age: 604800,
          count: 1000,
        },
      },
    });
    attachEmitterErrorLogging(queue, {
      component: "slik_import_queue",
      event: "queue_error",
    });
  }

  return queue;
}

async function enqueueSlikImportJob({
  jobId,
  userId = null,
  force = false,
  queueInstance,
}) {
  const importQueue = queueInstance || getSlikImportQueue();
  const requestContext = getRequestContext();
  await importQueue.waitUntilReady();
  const queueJobId = `slik-import-${jobId}`;
  const existingJob = await importQueue.getJob(queueJobId);

  if (existingJob) {
    const state = await existingJob.getState();
    if (force && ["completed", "failed"].includes(state)) {
      await existingJob.remove();
    } else {
      return existingJob;
    }
  }

  const addedJob = await importQueue.add(
    SLIK_IMPORT_JOB_NAME,
    {
      jobId,
      userId,
      requestId: requestContext.request_id || null,
      traceContext: injectTraceCarrier(),
    },
    {
      jobId: queueJobId,
    },
  );
  queueLogger.info(
    {
      event: "slik_import_job_scheduled",
      job_id: queueJobId,
      import_job_id: jobId,
      queue_name: SLIK_IMPORT_QUEUE_NAME,
    },
    "SLIK import job scheduled",
  );
  return addedJob;
}

function createSlikImportWorker(processor, options = {}) {
  if (!isSlikImportQueueEnabled()) {
    throw new Error("Queue import SLIK sedang dinonaktifkan.");
  }

  const concurrency = readPositiveIntEnv(
    "SLIK_IMPORT_WORKER_CONCURRENCY",
    options.concurrency || 1,
  );

  return new Worker(
    SLIK_IMPORT_QUEUE_NAME,
    async (job) => {
      await runWithSpan(
        "SLIK import job",
        {
          kind: SpanKind.CONSUMER,
          parentCarrier: job.data?.traceContext || null,
          attributes: {
            "messaging.system": "bullmq",
            "messaging.destination.name": SLIK_IMPORT_QUEUE_NAME,
            "messaging.message.id": String(job.id),
          },
        },
        () =>
          runWithRequestContext(
            {
              request_id: job.data?.requestId || null,
              job_id: String(job.id),
              import_job_id: job.data?.jobId || null,
              queue_name: SLIK_IMPORT_QUEUE_NAME,
            },
            () => processor(job.data.jobId, job.data.userId || null),
          ),
      );
    },
    {
      connection: createRedisConnection({ worker: true }),
      concurrency,
      autorun: options.autorun !== false,
    },
  );
}

async function closeSlikImportQueue() {
  const currentQueue = queue;
  queue = null;
  try {
    if (currentQueue) await currentQueue.close();
  } finally {
    disconnectTrackedRedisConnections();
  }
}

module.exports = {
  SLIK_IMPORT_QUEUE_NAME,
  checkSlikImportQueueHealth,
  enqueueSlikImportJob,
  createSlikImportWorker,
  closeSlikImportQueue,
  disconnectTrackedRedisConnections,
  getRedisUrl,
  getSlikImportQueueName,
  isSlikImportLocalFallbackEnabled,
  isSlikImportQueueEnabled,
  isSlikImportWorkerRequired,
  trackRedisConnection,
};
