const Joi = require("joi");

const uploadedFileSchema = Joi.object({
  buffer: Joi.any().required(),
  name: Joi.string().trim().required(),
  mime_type: Joi.string().trim().required(),
}).unknown(true);

const fileInputSchema = Joi.alternatives()
  .try(Joi.string().trim().allow("", null), uploadedFileSchema)
  .optional();

exports.createMemorandumSchema = Joi.object({
  division_id: Joi.string().required().messages({
    "string.empty": "Division ID is required",
  }),
  memo_number: Joi.string().trim().required().messages({
    "string.empty": "Memo number is required",
  }),
  memo_date: Joi.date().iso().required().messages({
    "date.base": "Memo date must be a valid date",
    "any.required": "Memo date is required",
  }),
  received_date: Joi.date().iso().required().messages({
    "date.base": "Received date must be a valid date",
    "any.required": "Received date is required",
  }),
  due_date: Joi.date().iso().allow(null).optional(),
  regarding: Joi.string().trim().required().messages({
    "string.empty": "Regarding is required",
  }),
  description: Joi.string().trim().required().messages({
    "string.empty": "Description is required",
  }),
  file: fileInputSchema.required().messages({
    "any.required": "File is required",
  }),
});

exports.updateMemorandumSchema = Joi.object({
  division_id: Joi.string().optional(),
  memo_number: Joi.string().trim().optional(),
  memo_date: Joi.date().iso().optional(),
  received_date: Joi.date().iso().optional(),
  due_date: Joi.date().iso().allow(null).optional(),
  regarding: Joi.string().trim().optional(),
  description: Joi.string().allow("", null).optional(),
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

exports.redisposeMemorandumSchema = Joi.object({
  receiver_id: Joi.string().required().messages({
    "string.empty": "Receiver ID is required",
  }),
  note: Joi.string().allow("", null).optional(),
  start_date: Joi.date().iso().allow(null).optional(),
  due_date: Joi.date().iso().allow(null).optional(),
});

exports.updateMemorandumDispositionStatusSchema = Joi.object({
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
