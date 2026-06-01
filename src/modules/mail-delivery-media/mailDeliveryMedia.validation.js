const Joi = require("joi");
const {
  createParameterSchemas,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterSchemas({
  code: Joi.string()
    .trim()
    .uppercase()
    .valid("EMAIL", "POS", "KURIR", "LANGSUNG")
    .required(),
  name: Joi.string().trim().min(1).max(255).required(),
  description: Joi.string().trim().allow("", null).optional(),
  is_active: Joi.boolean().default(true),
});
