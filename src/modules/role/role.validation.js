const Joi = require("joi");

exports.createRoleSchema = Joi.object({
  name: Joi.string().trim().required().messages({
    "string.empty": "Role name is required",
  }),
});

exports.updateRoleSchema = Joi.object({
  name: Joi.string().trim().optional(),
});
