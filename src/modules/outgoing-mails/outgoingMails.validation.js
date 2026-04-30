const Joi = require("joi");

const uploadedFileSchema = Joi.object({
  buffer: Joi.any().required(),
  name: Joi.string().trim().required(),
  mime_type: Joi.string().trim().required(),
}).unknown(true);

const fileInputSchema = Joi.alternatives()
  .try(Joi.string().trim().allow("", null), uploadedFileSchema)
  .optional();

exports.createOutgoingMailSchema = Joi.object({
  letter_prioritie_id: Joi.string().required().messages({
    "string.empty": "Letter priority ID is required",
  }),
  delivery_media: Joi.string()
    .trim()
    .lowercase()
    .valid("email", "pos", "kurir", "langsung")
    .required()
    .messages({
      "string.empty": "Delivery media is required",
      "any.only": "Delivery media must be one of: email, pos, kurir, langsung",
    }),
  name: Joi.string().trim().required().messages({
    "string.empty": "Recipient name is required",
  }),
  send_date: Joi.date().iso().required().messages({
    "date.base": "Send date must be a valid date",
    "any.required": "Send date is required",
  }),
  address: Joi.string().trim().required().messages({
    "string.empty": "Address is required",
  }),
  mail_number: Joi.string().trim().required().messages({
    "string.empty": "Mail number is required",
  }),
  file: fileInputSchema.required().messages({
    "any.required": "File is required",
  }),
});

exports.updateOutgoingMailSchema = Joi.object({
  letter_prioritie_id: Joi.string().optional(),
  delivery_media: Joi.string()
    .trim()
    .lowercase()
    .valid("email", "pos", "kurir", "langsung", "EMAIL", "POS", "KURIR", "LANGSUNG"),
  name: Joi.string().trim().optional(),
  send_date: Joi.date().iso().optional(),
  address: Joi.string().trim().optional(),
  mail_number: Joi.string().trim().optional(),
  file: fileInputSchema,
  status: Joi.alternatives()
    .try(
      Joi.number().integer().valid(0, 1),
      Joi.string().trim().uppercase().valid("ACTIVE", "INACTIVE", "0", "1"),
    )
    .optional(),
}).min(1);
