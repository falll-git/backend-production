module.exports = (schema, options = {}) => (req, res, next) => {
  const { source = "body", ...joiOptions } = options;
  const { error, value } = schema.validate(req[source], {
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
  next();
};
