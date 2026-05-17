const Joi = require("joi");
const {
  createParameterSchemas,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterSchemas({
  code: Joi.string().trim().min(1).max(50).required(),
  level: Joi.number().integer().min(1).max(99).required(),
  name: Joi.string().trim().min(1).max(255).required(),
  is_npf: Joi.boolean().default(false),
  description: Joi.string().trim().allow("", null).optional(),
  is_active: Joi.boolean().default(true),
});
