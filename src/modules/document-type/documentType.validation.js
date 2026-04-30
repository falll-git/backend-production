const Joi = require("joi");

exports.createDocumentTypeSchema = Joi.object({
  code: Joi.string().min(3).max(50).trim().required().messages({
    "string.empty": "Document type code is required",
    "string.min": " Document type code must be at least 3 characters",
    "string.max": "Document type code must not exceed 50 characters",
  }),
  name: Joi.string().min(3).max(50).trim().required().messages({
    "string.empty": "Document type name is required",
    "string.min": " Document type name must be at least 3 characters",
    "string.max": "Document type name must not exceed 50 characters",
  }),
  is_active: Joi.boolean().required().messages({
    "string.empty": "Document type is_active is required",
  }),
  description: Joi.string().trim().optional(),
});

exports.updateDocumentTypeSchema = Joi.object({
  code: Joi.string().min(3).max(50).trim().optional(),
  name: Joi.string().min(3).max(50).trim().optional(),
  is_active: Joi.boolean().optional(),
  description: Joi.string().trim().optional(),
});
