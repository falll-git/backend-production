const Joi = require("joi");

const uploadedFileSchema = Joi.object({
  buffer: Joi.any().required(),
  name: Joi.string().trim().required(),
  mime_type: Joi.string().trim().required(),
}).unknown(true);

const fileInputSchema = Joi.alternatives()
  .try(Joi.string().trim().allow("", null), uploadedFileSchema)
  .optional();

const baseIncomingMailCreateSchema = Joi.object({
  letter_prioritie_id: Joi.string().required().messages({
    "string.empty": "Letter priority ID is required",
  }),
  division_id: Joi.string().required().messages({
    "string.empty": "Division ID is required",
  }),
  regarding: Joi.string().trim().required().messages({
    "string.empty": "Regarding is required",
  }),
  description: Joi.string().allow("", null).optional(),
  name: Joi.string().trim().required().messages({
    "string.empty": "Sender name is required",
  }),
  receive_date: Joi.date().iso().required().messages({
    "date.base": "Receive date must be a valid date",
    "any.required": "Receive date is required",
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

exports.createIncomingMailWithDispositionSchema = baseIncomingMailCreateSchema;

exports.redisposeIncomingMailSchema = Joi.object({
  receiver_id: Joi.string().required().messages({
    "string.empty": "Receiver ID is required",
  }),
  note: Joi.string().allow("", null).optional(),
  start_date: Joi.date().iso().allow(null).optional(),
  due_date: Joi.date().iso().allow(null).optional(),
});

exports.updateIncomingDispositionStatusSchema = Joi.object({
  status: Joi.string()
    .trim()
    .uppercase()
    .valid("IN_PROGRESS", "COMPLETED")
    .required()
    .messages({
      "any.only": "Status disposisi harus IN_PROGRESS atau COMPLETED",
      "any.required": "Status disposisi wajib diisi",
    }),
});

exports.updateIncomingMailSchema = Joi.object({
  letter_prioritie_id: Joi.string().optional(),
  division_id: Joi.string().optional(),
  regarding: Joi.string().trim().optional(),
  description: Joi.string().allow("", null).optional(),
  name: Joi.string().trim().optional(),
  receive_date: Joi.date().iso().optional(),
  address: Joi.string().trim().optional(),
  mail_number: Joi.string().trim().optional(),
  file: fileInputSchema,
  status: Joi.alternatives()
    .try(
      Joi.number().integer().min(0).max(3),
      Joi.string()
        .trim()
        .uppercase()
        .valid("NEW", "IN_PROGRESS", "COMPLETED", "OVERDUE", "0", "1", "2", "3"),
    )
    .optional(),
}).min(1);
