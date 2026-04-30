module.exports = (schema, options = {}) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
    ...options,
  });

  if (error) {
    return res.status(422).json({
      success: false,
      message: "Validation error",
      errors: error.details.map((err) => err.message),
    });
  }

  req.body = value;
  next();
};
