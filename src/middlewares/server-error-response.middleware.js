function serverErrorResponse(req, res, next) {
  const sendJson = res.json.bind(res);

  res.json = (body) => {
    if (
      res.statusCode >= 500 &&
      body &&
      typeof body === "object" &&
      !Buffer.isBuffer(body)
    ) {
      return sendJson({
        ...body,
        request_id: body.request_id || req.requestId || null,
        message: "Internal server error",
      });
    }

    return sendJson(body);
  };

  next();
}

module.exports = serverErrorResponse;
