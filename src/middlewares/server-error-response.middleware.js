function isUnsafeClientMessage(message) {
  if (typeof message !== "string") return false;

  return /(?:prisma|postgres|database|sqlstate|node_modules|invalid\s+`?prisma|unique constraint|foreign key constraint|econn(?:refused|reset)|enoent|password authentication failed|(?:[a-z]:\\|\/var\/|\/home\/)[^\s]+)/i.test(
    message,
  );
}

const SAFE_SERVER_ERROR_CODES = new Set([
  "RATE_LIMIT_STORE_UNAVAILABLE",
  "SERVICE_DRAINING",
]);

function resolveClientMessage(statusCode, body) {
  const message = body?.message;
  if (isUnsafeClientMessage(message)) return "Internal server error";
  if (statusCode < 500) return message || "Request failed";
  if (SAFE_SERVER_ERROR_CODES.has(body?.code) && typeof message === "string") {
    return message;
  }
  return "Internal server error";
}

function serverErrorResponse(req, res, next) {
  const sendJson = res.json.bind(res);

  res.json = (body) => {
    if (
      res.statusCode >= 400 &&
      body &&
      typeof body === "object" &&
      !Buffer.isBuffer(body)
    ) {
      return sendJson({
        ...body,
        status: false,
        success: false,
        request_id: body.request_id || req.requestId || null,
        message: resolveClientMessage(res.statusCode, body),
      });
    }

    return sendJson(body);
  };

  next();
}

module.exports = serverErrorResponse;
module.exports.isUnsafeClientMessage = isUnsafeClientMessage;
module.exports.resolveClientMessage = resolveClientMessage;
