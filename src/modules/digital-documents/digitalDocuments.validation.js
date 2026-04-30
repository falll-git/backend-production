const Joi = require("joi");

const uuid = Joi.string().uuid();
const uploadedFileSchema = Joi.object({
  buffer: Joi.any().required(),
  name: Joi.string().trim().required(),
  mime_type: Joi.string().trim().required(),
}).unknown(true);

const fileInputSchema = Joi.alternatives().try(
  Joi.string().trim().min(1),
  uploadedFileSchema,
);

const createDigitalDocumentSchema = Joi.object({
  storage_id: uuid.required(),
  document_type_id: uuid.required(),
  document_name: Joi.string().trim().min(3).max(255).required(),
  description: Joi.string().trim().allow("", null).optional(),
  is_restricted: Joi.boolean().default(false),
  file: fileInputSchema.required(),
});

const updateDigitalDocumentSchema = Joi.object({
  storage_id: uuid.optional(),
  document_type_id: uuid.optional(),
  document_name: Joi.string().trim().min(3).max(255).optional(),
  description: Joi.string().trim().allow("", null).optional(),
  is_restricted: Joi.boolean().optional(),
  file: fileInputSchema.optional(),
});

module.exports = {
  createDigitalDocumentSchema,
  updateDigitalDocumentSchema,
};
