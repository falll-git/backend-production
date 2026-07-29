process.env.RUNTIME_ROLE ||= "slik-import-worker";

const { loadEnv, validateEnv } = require("../config/env");

loadEnv();
validateEnv();

const {
  shutdownObservability,
  startObservability,
} = require("../system/observability");
startObservability();

const prisma = require("../config/prisma");
const { usesSystemDatabase } = require("../config/prisma-runtime");
const {
  closeSlikImportQueue,
  createSlikImportWorker,
  SLIK_IMPORT_QUEUE_NAME,
} = require("../queues/slik-import.queue");
const {
  processSlikJob,
} = require("../modules/debtor-imports/debtorImports.service");
const { runStartupTasks } = require("../startup-tasks");
const { ensureStorageReady } = require("../system/storage-runtime");
const {
  assertDatabaseWorkerSecurity,
} = require("../system/database-security");
const { logger } = require("../system/logger");
const {
  createThrottledErrorLogger,
} = require("../system/infrastructure-events");
const {
  installFatalProcessHandlers,
} = require("../system/process-errors");

const workerLogger = logger.child({ component: "slik_import_worker" });

function readPositiveIntEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function attachWorkerLogging(worker) {
  worker.on("completed", (job) => {
    workerLogger.info(
      {
        event: "slik_import_job_completed",
        job_id: String(job.id),
        import_job_id: job.data?.jobId || null,
        request_id: job.data?.requestId || null,
      },
      "SLIK import job completed",
    );
  });

  worker.on("failed", (job, error) => {
    workerLogger.error(
      {
        event: "slik_import_job_failed",
        job_id: job?.id ? String(job.id) : null,
        import_job_id: job?.data?.jobId || null,
        request_id: job?.data?.requestId || null,
        err: error,
      },
      "SLIK import job failed",
    );
  });

  worker.on(
    "error",
    createThrottledErrorLogger({
      component: "slik_import_worker",
      event: "queue_worker_error",
      logger: workerLogger,
    }),
  );
}

async function startSlikImportWorker({
  exit = (code) => {
    if (code === 0) process.exitCode = 0;
    else process.exit(code);
  },
  registerSignals = true,
} = {}) {
  await ensureStorageReady();
  await prisma.$connect();
  await assertDatabaseWorkerSecurity(prisma, { usesSystemDatabase });

  const worker = createSlikImportWorker(processSlikJob, { autorun: false });
  attachWorkerLogging(worker);

  const startup = await runStartupTasks({ role: "slik-import-worker" });
  if (startup.failed.length > 0) {
    await worker.close(true);
    await closeSlikImportQueue();
    await prisma.$disconnect();
    throw new Error(
      `Recovery worker SLIK gagal: ${startup.failed.join(", ")}.`,
    );
  }

  let shuttingDown = false;
  const runPromise = worker.run();
  await worker.waitUntilReady();
  workerLogger.info(
    {
      event: "slik_import_worker_ready",
      queue_name: SLIK_IMPORT_QUEUE_NAME,
    },
    "SLIK import worker ready",
  );

  let shutdownPromise = null;
  let removeFatalProcessHandlers = () => {};
  const shutdown = (signal, requestedExitCode = 0) => {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    workerLogger.info(
      {
        event: "worker_shutdown_started",
        signal,
      },
      "SLIK import worker shutting down",
    );

    shutdownPromise = new Promise((resolve) => {
      let settled = false;
      const finish = (code) => {
        if (settled) return;
        settled = true;
        exit(code);
        resolve(code);
      };
      const forceExitTimer = setTimeout(() => {
        workerLogger.error(
          {
            event: "worker_shutdown_timeout",
            timeout_ms: readPositiveIntEnv(
              "WORKER_SHUTDOWN_TIMEOUT_MS",
              120_000,
            ),
          },
          "SLIK import worker graceful shutdown timed out",
        );
        finish(1);
      }, readPositiveIntEnv("WORKER_SHUTDOWN_TIMEOUT_MS", 120_000));

      (async () => {
        removeFatalProcessHandlers();
        await worker.close();
        await closeSlikImportQueue();
        await prisma.$disconnect();
        await shutdownObservability();
        clearTimeout(forceExitTimer);
        finish(requestedExitCode);
      })().catch((error) => {
        clearTimeout(forceExitTimer);
        workerLogger.error(
          {
            event: "worker_shutdown_failed",
            err: error,
          },
          "SLIK import worker shutdown failed",
        );
        finish(1);
      });
    });

    return shutdownPromise;
  };
  removeFatalProcessHandlers = installFatalProcessHandlers({ shutdown });

  runPromise.catch((error) => {
    if (!shuttingDown) {
      workerLogger.error(
        {
          event: "worker_processing_loop_stopped",
          err: error,
        },
        "SLIK import processing loop stopped",
      );
      void shutdown("PROCESSING_LOOP_ERROR", 1);
    }
  });
  runPromise.then(
    () => {
      if (!shuttingDown) {
        workerLogger.error(
          {
            event: "worker_processing_loop_ended",
          },
          "SLIK import processing loop ended unexpectedly",
        );
        void shutdown("PROCESSING_LOOP_ENDED", 1);
      }
    },
    () => {},
  );

  if (registerSignals) {
    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
  }

  return { shutdown, worker };
}

if (require.main === module) {
  startSlikImportWorker().catch(async (error) => {
    workerLogger.fatal(
      {
        event: "worker_startup_failed",
        err: error,
      },
      "SLIK import worker startup failed",
    );
    workerLogger.flush();
    await closeSlikImportQueue().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    await shutdownObservability();
    process.exit(1);
  });
}

module.exports = {
  startSlikImportWorker,
};
