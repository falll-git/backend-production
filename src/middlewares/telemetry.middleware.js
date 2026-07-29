const {
  SpanKind,
  SpanStatusCode,
  runWithSpan,
} = require("../system/observability");

function requestPath(req) {
  return String(req.originalUrl || req.url || "/").split("?")[0] || "/";
}

function telemetry(req, res, next) {
  const path = requestPath(req);
  return runWithSpan(
    `HTTP ${req.method || "UNKNOWN"} ${path}`,
    {
      kind: SpanKind.SERVER,
      parentCarrier: req.headers,
      attributes: {
        "http.request.method": req.method || "UNKNOWN",
        "url.path": path,
        "server.address": req.hostname || null,
      },
    },
    (span) =>
      new Promise((resolve, reject) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          span?.setAttribute("http.response.status_code", res.statusCode);
          if (res.statusCode >= 500) {
            span?.setStatus({ code: SpanStatusCode.ERROR });
          }
          resolve();
        };
        res.once("finish", finish);
        res.once("close", finish);
        try {
          next();
        } catch (error) {
          reject(error);
        }
      }),
  );
}

module.exports = telemetry;
module.exports.requestPath = requestPath;
