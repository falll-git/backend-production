function isUnsafeClientMessage(message) {
  if (typeof message !== "string") return false;

  return /(?:prisma|postgres|database|sqlstate|node_modules|invalid\s+`?prisma|unique constraint|foreign key constraint|econn(?:refused|reset)|enoent|password authentication failed|(?:[a-z]:\\|\/var\/|\/home\/)[^\s]+)/i.test(
    message,
  );
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
        message:
          res.statusCode >= 500 || isUnsafeClientMessage(body.message)
            ? "Internal server error"
            : body.message || "Request failed",
      });
    }

    return sendJson(body);
  };

  next();
}

module.exports = serverErrorResponse;
module.exports.isUnsafeClientMessage = isUnsafeClientMessage;
