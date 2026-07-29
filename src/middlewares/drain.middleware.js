const runtimeState = require("../system/runtime-state");

function isHealthPath(pathname) {
  return /(?:^|\/)(?:health|ready)\/?$/.test(String(pathname || ""));
}

function createDrainMiddleware({
  isDraining = runtimeState.isDraining,
  retryAfterSeconds = 5,
} = {}) {
  return function drainMiddleware(req, res, next) {
    if (!isDraining() || isHealthPath(req.path || req.originalUrl)) {
      return next();
    }

    res.setHeader("Connection", "close");
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(503).json({
      status: false,
      success: false,
      request_id: req.requestId || null,
      message: "Layanan sedang melakukan graceful shutdown. Silakan coba lagi.",
    });
  };
}

module.exports = createDrainMiddleware();
module.exports.createDrainMiddleware = createDrainMiddleware;
module.exports.isHealthPath = isHealthPath;
