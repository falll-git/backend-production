const { logger: defaultLogger } = require("./logger");

const loggedErrors = new WeakSet();

function logErrorOnce(
  error,
  {
    event = "unhandled_error",
    message = "Unhandled application error",
    fields = {},
    logger = defaultLogger,
  } = {},
) {
  if (error && typeof error === "object") {
    if (loggedErrors.has(error)) return false;
    loggedErrors.add(error);
  }
  try {
    const { recordActiveException } = require("./observability");
    recordActiveException(error);
  } catch {
    // Structured logging tetap berjalan jika tracing belum tersedia.
  }
  logger.error(
    {
      event,
      ...fields,
      err: error instanceof Error ? error : new Error(String(error)),
    },
    message,
  );
  return true;
}

module.exports = {
  logErrorOnce,
};
