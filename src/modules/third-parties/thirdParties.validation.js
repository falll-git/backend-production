const Joi = require("joi");
const {
  createParameterSchemas,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterSchemas({
  code: Joi.string().trim().min(1).max(50).required(),
  name: Joi.string().trim().min(1).max(255).required(),
  category: Joi.string().valid("NOTARY", "INSURANCE", "KJPP").required(),
  address: Joi.string().trim().allow("", null).optional(),
  phone: Joi.string().trim().allow("", null).optional(),
  email: Joi.string().trim().email().allow("", null).optional(),
  contact_person: Joi.string().trim().allow("", null).optional(),
  description: Joi.string().trim().allow("", null).optional(),
  is_active: Joi.boolean().default(true),
});
