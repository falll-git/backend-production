const Joi = require("joi");

exports.createDivisionSchema = Joi.object({
  name: Joi.string().trim().required().messages({
    "string.empty": "Division name is required",
  }),
});

exports.updateDivisionSchema = Joi.object({
  name: Joi.string().trim().optional(),
});
