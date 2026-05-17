const Joi = require("joi");
const {
  createParameterSchemas,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterSchemas({
  code: Joi.string().trim().min(1).max(50).required(),
  name: Joi.string().trim().min(1).max(255).required(),
  legal_name: Joi.string().trim().allow("", null).optional(),
  address: Joi.string().trim().allow("", null).optional(),
  phone: Joi.string().trim().allow("", null).optional(),
  email: Joi.string().trim().email().allow("", null).optional(),
  tax_number: Joi.string().trim().allow("", null).optional(),
  license_number: Joi.string().trim().allow("", null).optional(),
  is_active: Joi.boolean().default(true),
});
