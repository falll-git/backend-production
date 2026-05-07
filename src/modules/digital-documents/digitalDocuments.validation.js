const Joi = require("joi");

const uuid = Joi.string().uuid();
const optionalUuid = uuid.allow(null, "");
const uploadedFileSchema = Joi.object({
  buffer: Joi.any().required(),
  name: Joi.string().trim().required(),
  mime_type: Joi.string().trim().required(),
}).unknown(true);

const fileInputSchema = Joi.alternatives().try(
  Joi.string().trim().min(1),
  uploadedFileSchema,
);

const relatedUserIdsSchema = Joi.alternatives()
  .try(
    Joi.array().items(uuid),
    Joi.string().trim().allow("", null),
  )
  .optional();

const debtorSchema = Joi.object({
  debtor_number: Joi.string().trim().max(100).allow("", null).optional(),
  name: Joi.string().trim().max(255).allow("", null).optional(),
  identity_number: Joi.string().trim().max(100).allow("", null).optional(),
  financing_number: Joi.string().trim().max(100).allow("", null).optional(),
  description: Joi.string().trim().max(1000).allow("", null).optional(),
}).optional();

const createDigitalDocumentSchema = Joi.object({
  storage_id: uuid.required().label("Tempat penyimpanan"),
  document_type_id: uuid.required().label("Jenis dokumen"),
  owner_user_id: optionalUuid.optional().label("PIC dokumen"),
  owner_division_id: optionalUuid.optional().label("Divisi pemilik dokumen"),
  related_user_ids: relatedUserIdsSchema.label("User terkait"),
  debtor_id: optionalUuid.optional().label("Debitur"),
  debtor: debtorSchema,
  debtor_number: Joi.string().trim().max(100).allow("", null).optional(),
  debtor_name: Joi.string().trim().max(255).allow("", null).optional(),
  identity_number: Joi.string().trim().max(100).allow("", null).optional(),
  financing_number: Joi.string().trim().max(100).allow("", null).optional(),
  debtor_description: Joi.string().trim().max(1000).allow("", null).optional(),
  document_name: Joi.string()
    .trim()
    .min(3)
    .max(255)
    .required()
    .label("Nama dokumen"),
  document_date: Joi.date().iso().allow(null, "").optional().label("Tanggal dokumen"),
  due_date: Joi.date().iso().allow(null, "").optional().label("Tanggal jatuh tempo"),
  description: Joi.string().trim().allow("", null).optional(),
  is_restricted: Joi.boolean().default(false),
  file: fileInputSchema.required().label("File dokumen"),
}).messages({
  "any.required": "{{#label}} wajib diisi.",
  "string.empty": "{{#label}} wajib diisi.",
  "string.guid": "{{#label}} tidak valid.",
  "string.min": "{{#label}} minimal {{#limit}} karakter.",
  "string.max": "{{#label}} maksimal {{#limit}} karakter.",
  "date.format": "{{#label}} harus menggunakan format tanggal yang valid.",
});

const updateDigitalDocumentSchema = Joi.object({
  storage_id: uuid.optional().label("Tempat penyimpanan"),
  document_type_id: uuid.optional().label("Jenis dokumen"),
  owner_user_id: optionalUuid.optional().label("PIC dokumen"),
  owner_division_id: optionalUuid.optional().label("Divisi pemilik dokumen"),
  related_user_ids: relatedUserIdsSchema.label("User terkait"),
  debtor_id: optionalUuid.optional().label("Debitur"),
  debtor: debtorSchema,
  debtor_number: Joi.string().trim().max(100).allow("", null).optional(),
  debtor_name: Joi.string().trim().max(255).allow("", null).optional(),
  identity_number: Joi.string().trim().max(100).allow("", null).optional(),
  financing_number: Joi.string().trim().max(100).allow("", null).optional(),
  debtor_description: Joi.string().trim().max(1000).allow("", null).optional(),
  document_name: Joi.string()
    .trim()
    .min(3)
    .max(255)
    .optional()
    .label("Nama dokumen"),
  document_date: Joi.date().iso().allow(null, "").optional().label("Tanggal dokumen"),
  due_date: Joi.date().iso().allow(null, "").optional().label("Tanggal jatuh tempo"),
  description: Joi.string().trim().allow("", null).optional(),
  is_restricted: Joi.boolean().optional(),
  file: fileInputSchema.optional(),
}).messages({
  "string.guid": "{{#label}} tidak valid.",
  "string.min": "{{#label}} minimal {{#limit}} karakter.",
  "string.max": "{{#label}} maksimal {{#limit}} karakter.",
  "date.format": "{{#label}} harus menggunakan format tanggal yang valid.",
});

module.exports = {
  createDigitalDocumentSchema,
  updateDigitalDocumentSchema,
};
