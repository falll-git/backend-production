const Joi = require("joi");

exports.createDispositionSchema = Joi.object({
  name: Joi.string().required().messages({
    "string.empty": "Disposition name is required",
  }),
  due_date: Joi.number().integer().allow(null).optional(),
});

exports.updateDispositionSchema = Joi.object({
  name: Joi.string().optional(),
  due_date: Joi.number().integer().allow(null).optional(),
});
