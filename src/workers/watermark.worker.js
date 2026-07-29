process.env.RUNTIME_ROLE ||= "watermark-worker";

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
  runWatermarkWorker,
} = require("../modules/watermark-settings/watermarkProcessor.service");
const { runStartupTasks } = require("../startup-tasks");
const { ensureStorageReady } = require("../system/storage-runtime");
const {
  assertDatabaseWorkerSecurity,
} = require("../system/database-security");
const {
  createWatermarkWorkerHeartbeat,
} = require("../system/worker-heartbeat");
const { logger } = require("../system/logger");
const {
  installFatalProcessHandlers,
} = require("../system/process-errors");

const workerLogger = logger.child({ component: "watermark_worker" });

function readPositiveIntEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function wait(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function yieldEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function startWatermarkWorker({
  exit = (code) => {
    if (code === 0) process.exitCode = 0;
    else process.exit(code);
  },
  registerSignals = true,
} = {}) {
  await ensureStorageReady();
  await prisma.$connect();
  await assertDatabaseWorkerSecurity(prisma, { usesSystemDatabase });

  const startup = await runStartupTasks({ role: "watermark-worker" });
  if (startup.failed.length > 0) {
    await prisma.$disconnect();
    throw new Error(
      `Recovery worker watermark gagal: ${startup.failed.join(", ")}.`,
    );
  }

  const pollIntervalMs = readPositiveIntEnv(
    "WATERMARK_WORKER_POLL_INTERVAL_MS",
    2000,
  );
  const batchSize = readPositiveIntEnv("WATERMARK_WORKER_BATCH_SIZE", 1);
  const heartbeat = createWatermarkWorkerHeartbeat();
  await heartbeat.start();
  let stopping = false;

  const loopPromise = (async () => {
    workerLogger.info(
      {
        event: "watermark_worker_ready",
        poll_interval_ms: pollIntervalMs,
        batch_size: batchSize,
      },
      "Watermark worker polling database queue",
    );
    while (!stopping) {
      const result = await runWatermarkWorker({ batchSize });
      if (stopping) break;
      if (result.processed_count === 0) {
        await wait(pollIntervalMs);
      } else {
        await yieldEventLoop();
      }
    }
  })();

  let shutdownPromise = null;
  let removeFatalProcessHandlers = () => {};
  const shutdown = (signal, requestedExitCode = 0) => {
    if (shutdownPromise) return shutdownPromise;
    stopping = true;
    workerLogger.info(
      {
        event: "worker_shutdown_started",
        signal,
      },
      "Watermark worker shutting down",
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
          "Watermark worker graceful shutdown timed out",
        );
        finish(1);
      }, readPositiveIntEnv("WORKER_SHUTDOWN_TIMEOUT_MS", 120_000));

      (async () => {
        removeFatalProcessHandlers();
        await loopPromise;
        await heartbeat.stop();
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
          "Watermark worker shutdown failed",
        );
        finish(1);
      });
    });

    return shutdownPromise;
  };
  removeFatalProcessHandlers = installFatalProcessHandlers({ shutdown });

  loopPromise.catch((error) => {
    if (!stopping) {
      workerLogger.error(
        {
          event: "worker_processing_loop_stopped",
          err: error,
        },
        "Watermark worker processing loop stopped",
      );
      void shutdown("PROCESSING_LOOP_ERROR", 1);
    }
  });

  if (registerSignals) {
    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
  }

  return { shutdown };
}

if (require.main === module) {
  startWatermarkWorker().catch(async (error) => {
    workerLogger.fatal(
      {
        event: "worker_startup_failed",
        err: error,
      },
      "Watermark worker startup failed",
    );
    workerLogger.flush();
    await prisma.$disconnect().catch(() => {});
    await shutdownObservability();
    process.exit(1);
  });
}

module.exports = {
  startWatermarkWorker,
};
