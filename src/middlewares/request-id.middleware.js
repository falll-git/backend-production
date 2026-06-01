const crypto = require("crypto");

const REQUEST_ID_HEADER = "X-Request-Id";

function sanitizeRequestId(value) {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(trimmed)) return null;

  return trimmed;
}

function requestId(req, res, next) {
  const forwardedRequestId = sanitizeRequestId(req.get(REQUEST_ID_HEADER));
  const id = forwardedRequestId || crypto.randomUUID();

  req.requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);

  return next();
}

module.exports = requestId;
module.exports.REQUEST_ID_HEADER = REQUEST_ID_HEADER;
