process.env.RUNTIME_ROLE ||= "api";

const { loadEnv, validateEnv } = require("./config/env");

loadEnv();
validateEnv();

const {
  shutdownObservability,
  startObservability,
} = require("./system/observability");
startObservability();

const app = require("./app");
const prisma = require("./config/prisma");
const systemPrisma = require("./config/prisma-system");
const { closeSlikImportQueue } = require("./queues/slik-import.queue");
const { ensureStorageReady } = require("./system/storage-runtime");
const {
  assertDatabaseRuntimeSecurity,
  assertDatabaseSystemSecurity,
} = require("./system/database-security");
const {
  cleanupExpiredUploadTempFiles,
  startTemporaryFileCleanupScheduler,
} = require("./system/temporary-file-cleanup");
const {
  assertRateLimitStoreReady,
  closeRateLimitStore,
} = require("./system/rate-limit-store");
const {
  closeApplicationCache,
} = require("./system/application-cache");
const {
  closeWorkerHeartbeatHealth,
} = require("./system/worker-heartbeat");
const {
  configureHttpServer,
  createGracefulShutdown,
} = require("./system/graceful-shutdown");
const { logger } = require("./system/logger");
const {
  installFatalProcessHandlers,
} = require("./system/process-errors");

function resolvePort(value) {
  const port = Number.parseInt(value || "7111", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT harus berupa angka valid antara 1 dan 65535.");
  }

  return port;
}

async function listen(appInstance, port, host) {
  return new Promise((resolve, reject) => {
    const server = appInstance.listen(port, host);
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

async function startServer() {
  const port = resolvePort(process.env.PORT);
  const host = process.env.HOST || "0.0.0.0";
  await ensureStorageReady();
  await prisma.$connect();
  await assertDatabaseRuntimeSecurity(prisma);
  if (systemPrisma !== prisma) {
    await systemPrisma.$connect();
    await assertDatabaseSystemSecurity(systemPrisma);
  }
  let server;
  try {
    await assertRateLimitStoreReady();
    await cleanupExpiredUploadTempFiles({
      dryRun: false,
      prismaClient: prisma,
    });
    server = await listen(app, port, host);
    configureHttpServer(server);
  } catch (error) {
    await closeRateLimitStore();
    if (systemPrisma !== prisma) await systemPrisma.$disconnect();
    await prisma.$disconnect();
    throw error;
  }
  const tempCleanupScheduler = startTemporaryFileCleanupScheduler({
    prismaClient: prisma,
  });
  logger.info(
    {
      event: "api_server_started",
      component: "api_server",
      host,
      port,
    },
    "API server started",
  );
  let removeFatalProcessHandlers = () => {};
  const { shutdown } = createGracefulShutdown({
    server,
    cleanup: async () => {
      removeFatalProcessHandlers();
      tempCleanupScheduler.stop();
      await closeSlikImportQueue();
      await closeWorkerHeartbeatHealth();
      await closeApplicationCache();
      await closeRateLimitStore();
      if (systemPrisma !== prisma) await systemPrisma.$disconnect();
      await prisma.$disconnect();
      await shutdownObservability();
    },
  });
  removeFatalProcessHandlers = installFatalProcessHandlers({ shutdown });
  Object.defineProperty(server, "gracefulShutdown", {
    configurable: false,
    enumerable: false,
    value: shutdown,
    writable: false,
  });

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  return server;
}

if (require.main === module) {
  startServer().catch(async (error) => {
    logger.fatal(
      {
        event: "api_server_startup_failed",
        component: "api_server",
        err: error,
      },
      "API server startup failed",
    );
    await shutdownObservability();
    logger.flush();
    process.exit(1);
  });
}

module.exports = {
  startServer,
};
