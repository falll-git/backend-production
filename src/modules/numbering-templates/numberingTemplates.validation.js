const Joi = require("joi");
const {
  createParameterSchemas,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterSchemas({
  code: Joi.string().trim().min(1).max(50).required(),
  name: Joi.string().trim().min(1).max(255).required(),
  module: Joi.string().trim().min(1).max(100).required(),
  document_type: Joi.string().trim().min(1).max(100).required(),
  prefix_template: Joi.string().trim().min(1).max(255).required(),
  sequence_padding: Joi.number().integer().min(1).max(12).default(4),
  reset_period: Joi.string().valid("DAILY", "MONTHLY", "YEARLY", "NEVER").default("MONTHLY"),
  last_sequence: Joi.number().integer().min(0).optional(),
  last_period_key: Joi.string().trim().allow("", null).optional(),
  description: Joi.string().trim().allow("", null).optional(),
  is_active: Joi.boolean().default(true),
});
