const Joi = require("joi");

exports.createStorageSchema = Joi.object({
  office_code: Joi.string().min(2).max(50).trim().required().messages({
    "string.empty": "Office code is required",
    "string.min": "Office code must be at least 2 characters",
    "string.max": "Office code must not exceed 50 characters",
  }),
  office_label: Joi.string().min(3).max(100).trim().required().messages({
    "string.empty": "Office label is required",
    "string.min": "Office label must be at least 3 characters",
    "string.max": "Office label must not exceed 100 characters",
  }),
  code: Joi.string().min(2).max(50).trim().required().messages({
    "string.empty": "Storage code is required",
    "string.min": "Storage code must be at least 2 characters",
    "string.max": "Storage code must not exceed 50 characters",
  }),
  name: Joi.string().min(3).max(50).trim().required().messages({
    "string.empty": "Storage name is required",
    "string.min": " Storage name must be at least 3 characters",
    "string.max": "Storage name must not exceed 50 characters",
  }),
  capacity: Joi.alternatives()
    .try(
      Joi.number().integer().min(0),
      Joi.string().trim().pattern(/^\d+$/),
    )
    .required()
    .messages({
      "alternatives.match": "Storage capacity must be a non-negative integer",
      "any.required": "Storage capacity is required",
    }),
  is_active: Joi.boolean().required().messages({
    "string.empty": "Storage is_active is required",
  }),
});

exports.updateStorageSchema = Joi.object({
  code: Joi.string().min(2).max(50).trim().optional(),
  name: Joi.string().min(3).max(50).trim().optional(),
  is_active: Joi.boolean().optional(),
  office_code: Joi.string().trim().optional(),
  office_label: Joi.string().trim().optional(),
  capacity: Joi.alternatives()
    .try(
      Joi.number().integer().min(0),
      Joi.string().trim().pattern(/^\d+$/),
    )
    .optional()
    .messages({
      "alternatives.match": "Storage capacity must be a non-negative integer",
    }),
});
