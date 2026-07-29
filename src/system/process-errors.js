const { logger: defaultLogger } = require("./logger");

function installFatalProcessHandlers({
  shutdown,
  logger = defaultLogger,
  processRef = process,
} = {}) {
  if (typeof shutdown !== "function") {
    throw new Error("Shutdown handler wajib diberikan.");
  }
  let handlingFatalError = false;

  function handle(event, reason) {
    if (handlingFatalError) return;
    handlingFatalError = true;
    const error =
      reason instanceof Error ? reason : new Error(String(reason));
    logger.fatal(
      {
        event,
        component: "process",
        err: error,
      },
      "Fatal process error",
    );
    logger.flush?.();
    Promise.resolve(shutdown(event, 1)).catch((shutdownError) => {
      logger.fatal(
        {
          event: "fatal_shutdown_failed",
          component: "process",
          err: shutdownError,
        },
        "Fatal process shutdown failed",
      );
      logger.flush?.();
      processRef.exit?.(1);
    });
  }

  const onUncaughtException = (error) =>
    handle("uncaught_exception", error);
  const onUnhandledRejection = (reason) =>
    handle("unhandled_rejection", reason);
  processRef.on("uncaughtException", onUncaughtException);
  processRef.on("unhandledRejection", onUnhandledRejection);

  return function removeFatalProcessHandlers() {
    processRef.removeListener("uncaughtException", onUncaughtException);
    processRef.removeListener("unhandledRejection", onUnhandledRejection);
  };
}

module.exports = {
  installFatalProcessHandlers,
};
