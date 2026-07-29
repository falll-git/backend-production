const { logger } = require("../system/logger");

function readBooleanEnv(key, fallback) {
  const value = process.env[key];
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase(),
  );
}

function requestPath(req) {
  const raw = String(req.originalUrl || req.url || "/");
  return raw.split("?")[0] || "/";
}

function requestLogging(req, res, next) {
  if (!readBooleanEnv("HTTP_ACCESS_LOG_ENABLED", true)) return next();
  const path = requestPath(req);
  const logHealth = readBooleanEnv("HTTP_ACCESS_LOG_HEALTH", false);
  if (!logHealth && ["/health", "/ready"].includes(path)) return next();

  const startedAt = process.hrtime.bigint();
  res.once("finish", () => {
    const durationMs =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logger.info(
      {
        event: "http_request_completed",
        request_method: req.method || null,
        request_path: path,
        response_status: res.statusCode,
        duration_ms: Number(durationMs.toFixed(3)),
        outcome:
          res.statusCode >= 500
            ? "server_error"
            : res.statusCode >= 400
              ? "client_error"
              : "success",
      },
      "HTTP request completed",
    );
  });
  return next();
}

module.exports = requestLogging;
module.exports.requestPath = requestPath;
