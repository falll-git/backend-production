const Joi = require("joi");
const {
  createParameterSchemas,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterSchemas({
  code: Joi.string().trim().min(1).max(50).required(),
  name: Joi.string().trim().min(1).max(255).required(),
  category: Joi.string().trim().max(50).allow("", null).optional(),
  document_type: Joi.string().trim().max(100).allow("", null).optional(),
  description: Joi.string().trim().allow("", null).optional(),
  is_required: Joi.boolean().default(false),
  is_active: Joi.boolean().default(true),
});
