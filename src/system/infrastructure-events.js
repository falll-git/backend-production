const { logger: defaultLogger } = require("./logger");

function readPositiveIntEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function createThrottledErrorLogger({
  component,
  event = "infrastructure_connection_error",
  intervalMs = readPositiveIntEnv("INFRA_ERROR_LOG_INTERVAL_MS", 60_000),
  now = () => Date.now(),
  logger = defaultLogger,
} = {}) {
  if (!component) throw new Error("Komponen infrastructure logger wajib diisi.");
  let lastLoggedAt = null;
  let suppressedCount = 0;

  return (error) => {
    const currentTime = now();
    if (
      lastLoggedAt !== null &&
      currentTime - lastLoggedAt < intervalMs
    ) {
      suppressedCount += 1;
      return false;
    }

    logger.error(
      {
        event,
        component,
        suppressed_count: suppressedCount,
        err: error instanceof Error ? error : new Error(String(error)),
      },
      "Infrastructure dependency error",
    );
    lastLoggedAt = currentTime;
    suppressedCount = 0;
    return true;
  };
}

function attachEmitterErrorLogging(emitter, options) {
  if (!emitter || typeof emitter.on !== "function") {
    throw new Error("Emitter infrastructure wajib memiliki method on.");
  }
  const handler = createThrottledErrorLogger(options);
  emitter.on("error", handler);
  return handler;
}

module.exports = {
  attachEmitterErrorLogging,
  createThrottledErrorLogger,
};
