const { loadEnv, validateEnv } = require("../config/env");
const {
  createSlikImportWorker,
  SLIK_IMPORT_QUEUE_NAME,
} = require("../queues/slik-import.queue");
const { processSlikJob } = require("../modules/debtor-imports/debtorImports.service");

loadEnv();
validateEnv();

const worker = createSlikImportWorker(processSlikJob);

worker.on("ready", () => {
  console.log(`[slik-import-worker] listening on queue ${SLIK_IMPORT_QUEUE_NAME}`);
});

worker.on("completed", (job) => {
  console.log("[slik-import-worker] job completed", {
    queueJobId: job.id,
    importJobId: job.data?.jobId,
  });
});

worker.on("failed", (job, error) => {
  console.error("[slik-import-worker] job failed", {
    queueJobId: job?.id,
    importJobId: job?.data?.jobId,
    error,
  });
});

worker.on("error", (error) => {
  console.error("[slik-import-worker] worker error", error);
});

async function shutdown(signal) {
  console.log(`[slik-import-worker] received ${signal}, shutting down`);
  try {
    await worker.close();
    process.exit(0);
  } catch (error) {
    console.error("[slik-import-worker] shutdown failed", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
