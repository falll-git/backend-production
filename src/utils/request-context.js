const { AsyncLocalStorage } = require("node:async_hooks");

const requestContextStorage = new AsyncLocalStorage();

function requestContext(req, res, next) {
  const context = {
    request_id: req.requestId || null,
    request_method: req.method || null,
    request_path: String(req.originalUrl || req.url || "").split("?")[0] || null,
  };

  return requestContextStorage.run(context, next);
}

function getRequestContext() {
  return requestContextStorage.getStore() || {};
}

function runWithRequestContext(context, callback) {
  if (typeof callback !== "function") {
    throw new Error("Callback request context wajib berupa fungsi.");
  }
  return requestContextStorage.run(
    {
      ...getRequestContext(),
      ...(context || {}),
    },
    callback,
  );
}

module.exports = {
  getRequestContext,
  requestContext,
  runWithRequestContext,
};
