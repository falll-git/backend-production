module.exports = (schema, options = {}) => {
  const { source = "body", ...joiOptions } = options;
  const middleware = (req, res, next) => {
    const input =
      source === "body" && req[source] === undefined ? {} : req[source];
    const { error, value } = schema.validate(input, {
      abortEarly: false,
      stripUnknown: true,
      ...joiOptions,
    });

    if (error) {
      return res.status(422).json({
        success: false,
        message: "Data yang dikirim belum sesuai.",
        errors: error.details.map((err) => err.message),
      });
    }

    Object.defineProperty(req, source, {
      value,
      configurable: true,
      enumerable: true,
      writable: true,
    });
    return next();
  };

  Object.defineProperty(middleware, "validation", {
    value: Object.freeze({ schema, source }),
    enumerable: false,
  });

  return middleware;
};
