const Joi = require("joi");

exports.createDocumentTypeSchema = Joi.object({
  code: Joi.string().min(3).max(50).trim().required().messages({
    "any.required": "Kode jenis dokumen wajib diisi.",
    "string.empty": "Kode jenis dokumen wajib diisi.",
    "string.min": "Kode jenis dokumen minimal 3 karakter.",
    "string.max": "Kode jenis dokumen maksimal 50 karakter.",
  }),
  name: Joi.string().min(3).max(50).trim().required().messages({
    "any.required": "Nama jenis dokumen wajib diisi.",
    "string.empty": "Nama jenis dokumen wajib diisi.",
    "string.min": "Nama jenis dokumen minimal 3 karakter.",
    "string.max": "Nama jenis dokumen maksimal 50 karakter.",
  }),
  is_active: Joi.boolean().required().messages({
    "any.required": "Status jenis dokumen wajib dipilih.",
    "boolean.base": "Status jenis dokumen tidak valid.",
  }),
  description: Joi.string().trim().optional(),
});

exports.updateDocumentTypeSchema = Joi.object({
  code: Joi.string().min(3).max(50).trim().optional().messages({
    "string.empty": "Kode jenis dokumen wajib diisi.",
    "string.min": "Kode jenis dokumen minimal 3 karakter.",
    "string.max": "Kode jenis dokumen maksimal 50 karakter.",
  }),
  name: Joi.string().min(3).max(50).trim().optional().messages({
    "string.empty": "Nama jenis dokumen wajib diisi.",
    "string.min": "Nama jenis dokumen minimal 3 karakter.",
    "string.max": "Nama jenis dokumen maksimal 50 karakter.",
  }),
  is_active: Joi.boolean().optional().messages({
    "boolean.base": "Status jenis dokumen tidak valid.",
  }),
  description: Joi.string().trim().optional(),
}).min(1).messages({
  "object.min": "Tidak ada data yang diperbarui.",
});
