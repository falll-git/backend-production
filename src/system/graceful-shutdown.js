const runtimeState = require("./runtime-state");
const { logger: systemLogger } = require("./logger");

function readPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveHttpServerSettings(env = process.env) {
  const keepAliveTimeoutMs = readPositiveInt(
    env.HTTP_KEEP_ALIVE_TIMEOUT_MS,
    65_000,
  );
  const headersTimeoutMs = readPositiveInt(
    env.HTTP_HEADERS_TIMEOUT_MS,
    66_000,
  );
  const requestTimeoutMs = readPositiveInt(
    env.HTTP_REQUEST_TIMEOUT_MS,
    300_000,
  );
  const maxHeadersCount = readPositiveInt(env.HTTP_MAX_HEADERS_COUNT, 200);

  if (headersTimeoutMs <= keepAliveTimeoutMs) {
    throw new Error(
      "HTTP_HEADERS_TIMEOUT_MS harus lebih besar dari HTTP_KEEP_ALIVE_TIMEOUT_MS.",
    );
  }

  return {
    keepAliveTimeoutMs,
    headersTimeoutMs,
    requestTimeoutMs,
    maxHeadersCount,
  };
}

function configureHttpServer(server, env = process.env) {
  const settings = resolveHttpServerSettings(env);
  server.keepAliveTimeout = settings.keepAliveTimeoutMs;
  server.headersTimeout = settings.headersTimeoutMs;
  server.requestTimeout = settings.requestTimeoutMs;
  server.maxHeadersCount = settings.maxHeadersCount;
  return settings;
}

function closeHttpServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    if (typeof server.closeIdleConnections === "function") {
      server.closeIdleConnections();
    }
  });
}

function wait(durationMs) {
  if (durationMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function createGracefulShutdown({
  server,
  cleanup,
  beginDrain = runtimeState.beginDrain,
  drainMs = readNonNegativeInt(
    process.env.GRACEFUL_SHUTDOWN_DRAIN_MS,
    5000,
  ),
  timeoutMs = readPositiveInt(
    process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS,
    30_000,
  ),
  waitFn = wait,
  logger = systemLogger,
  exit = (code) => {
    if (code === 0) process.exitCode = 0;
    else process.exit(code);
  },
} = {}) {
  if (!server || typeof server.close !== "function") {
    throw new Error("HTTP server wajib diberikan untuk graceful shutdown.");
  }
  if (typeof cleanup !== "function") {
    throw new Error("Cleanup handler wajib diberikan untuk graceful shutdown.");
  }
  if (timeoutMs <= drainMs) {
    throw new Error(
      "GRACEFUL_SHUTDOWN_TIMEOUT_MS harus lebih besar dari GRACEFUL_SHUTDOWN_DRAIN_MS.",
    );
  }

  let shutdownPromise = null;

  function shutdown(signal = "UNKNOWN", requestedExitCode = 0) {
    if (shutdownPromise) return shutdownPromise;

    beginDrain();
    if (typeof logger.info === "function") {
      logger.info(
        {
          event: "graceful_shutdown_started",
          component: "api_server",
          signal,
        },
        "Instance entering drain mode",
      );
    } else {
      logger.log(`${signal} received. Instance entering drain mode.`);
    }

    shutdownPromise = new Promise((resolve) => {
      let settled = false;
      const finish = (code) => {
        if (settled) return;
        settled = true;
        exit(code);
        resolve(code);
      };
      const forceExitTimer = setTimeout(() => {
        logger.error(
          {
            event: "graceful_shutdown_timeout",
            component: "api_server",
            signal,
            timeout_ms: timeoutMs,
          },
          "Graceful shutdown timed out",
        );
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
        finish(1);
      }, timeoutMs);

      (async () => {
        await waitFn(drainMs);
        await closeHttpServer(server);
        await cleanup();
        clearTimeout(forceExitTimer);
        finish(requestedExitCode);
      })().catch((error) => {
        clearTimeout(forceExitTimer);
        logger.error(
          {
            event: "graceful_shutdown_failed",
            component: "api_server",
            signal,
            err: error,
          },
          "Graceful shutdown failed",
        );
        finish(1);
      });
    });

    return shutdownPromise;
  }

  return {
    shutdown,
  };
}

module.exports = {
  closeHttpServer,
  configureHttpServer,
  createGracefulShutdown,
  resolveHttpServerSettings,
};
