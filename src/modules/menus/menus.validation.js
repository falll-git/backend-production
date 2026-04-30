const Joi = require("joi");

exports.createMenuSchema = Joi.object({
  name: Joi.string().required().messages({
    "string.empty": "Menu name is required",
  }),
  parent_id: Joi.string().uuid().allow(null, "").optional(),
  parent: Joi.string().allow(null, "").optional(),
  children: Joi.string().allow(null, "").optional(),
  icon: Joi.string().allow(null, "").optional(),
  url: Joi.string().allow(null, "").optional(),
  order: Joi.number().integer().allow(null).optional().messages({
    "number.integer": "Order must be an integer",
    "any.required": "Order is required",
  }),
});

exports.updateMenuSchema = Joi.object({
  name: Joi.string().optional(),
  parent_id: Joi.string().uuid().allow(null, "").optional(),
  parent: Joi.string().allow(null, "").optional(),
  children: Joi.string().allow(null, "").optional(),
  icon: Joi.string().allow(null, "").optional(),
  url: Joi.string().allow(null, "").optional(),
  order: Joi.number().integer().allow(null).optional(),
});
