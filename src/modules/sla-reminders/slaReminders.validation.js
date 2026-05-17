const Joi = require("joi");
const {
  createParameterSchemas,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterSchemas({
  code: Joi.string().trim().min(1).max(50).required(),
  name: Joi.string().trim().min(1).max(255).required(),
  module: Joi.string().trim().min(1).max(100).required(),
  event_key: Joi.string().trim().min(1).max(100).required(),
  due_days: Joi.number().integer().min(0).required(),
  reminder_days_before: Joi.number().integer().min(0).default(0),
  escalation_days: Joi.number().integer().min(0).allow(null).optional(),
  description: Joi.string().trim().allow("", null).optional(),
  is_active: Joi.boolean().default(true),
});
