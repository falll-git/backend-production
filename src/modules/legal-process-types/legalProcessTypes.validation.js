const Joi = require("joi");
const {
  createParameterSchemas,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterSchemas({
  code: Joi.string().trim().min(1).max(50).required(),
  name: Joi.string().trim().min(1).max(255).required(),
  category: Joi.string()
    .valid("NOTARY_DEED", "INSURANCE_TYPE", "KJPP_APPRAISAL", "INSURANCE_CLAIM")
    .required(),
  description: Joi.string().trim().allow("", null).optional(),
  is_active: Joi.boolean().default(true),
});
