const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");

const SLIK_IMPORT_QUEUE_NAME = "slik-import";
const SLIK_IMPORT_JOB_NAME = "process-slik-import";

let queue;

function readBooleanEnv(key, fallback = true) {
  const value = process.env[key];
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function readPositiveIntEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function isSlikImportQueueEnabled() {
  return readBooleanEnv("SLIK_IMPORT_QUEUE_ENABLED", true);
}

function getRedisUrl() {
  return process.env.REDIS_URL || "redis://127.0.0.1:6379";
}

function createRedisConnection({ worker = false } = {}) {
  const connection = new IORedis(getRedisUrl(), {
    connectTimeout: 5000,
    maxRetriesPerRequest: worker ? null : 1,
    enableOfflineQueue: worker,
    retryStrategy(times) {
      if (!worker && times > 3) return null;
      return Math.min(times * 250, 2000);
    },
  });
  connection.on("error", () => {});
  return connection;
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
    queue.on("error", () => {});
  }

  return queue;
}

async function enqueueSlikImportJob({ jobId, userId = null }) {
  const importQueue = getSlikImportQueue();
  await importQueue.waitUntilReady();
  return importQueue.add(
    SLIK_IMPORT_JOB_NAME,
    { jobId, userId },
    {
      jobId: `slik-import-${jobId}`,
    },
  );
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
      await processor(job.data.jobId, job.data.userId || null);
    },
    {
      connection: createRedisConnection({ worker: true }),
      concurrency,
    },
  );
}

async function closeSlikImportQueue() {
  if (queue) {
    await queue.close();
    queue = null;
  }
}

module.exports = {
  SLIK_IMPORT_QUEUE_NAME,
  enqueueSlikImportJob,
  createSlikImportWorker,
  closeSlikImportQueue,
  isSlikImportQueueEnabled,
};
