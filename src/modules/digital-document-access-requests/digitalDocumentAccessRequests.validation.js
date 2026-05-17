const Joi = require("joi");

const uuid = Joi.string().uuid();

const createAccessRequestSchema = Joi.object({
  document_ids: Joi.array().items(uuid).min(1).required().messages({
    "any.required": "Pilih minimal satu dokumen yang diajukan.",
    "array.base": "Format dokumen yang diajukan tidak valid.",
    "array.min": "Pilih minimal satu dokumen yang diajukan.",
    "string.guid": "Dokumen yang dipilih tidak valid.",
  }),
  request_reason: Joi.string().trim().min(5).required().messages({
    "any.required": "Alasan pengajuan wajib diisi.",
    "string.empty": "Alasan pengajuan wajib diisi.",
    "string.min": "Alasan pengajuan minimal 5 karakter.",
  }),
  expires_at: Joi.date().iso().required().messages({
    "any.required": "Tanggal berakhir akses wajib diisi.",
    "date.base": "Format tanggal berakhir akses tidak valid.",
    "date.format": "Format tanggal berakhir akses tidak valid.",
  }),
});

const approveAccessRequestSchema = Joi.object({
  expires_at: Joi.date().iso().optional().messages({
    "date.base": "Format tanggal berakhir akses tidak valid.",
    "date.format": "Format tanggal berakhir akses tidak valid.",
  }),
  action_note: Joi.string().trim().min(3).required().messages({
    "any.required": "Catatan persetujuan wajib diisi.",
    "string.empty": "Catatan persetujuan wajib diisi.",
    "string.min": "Catatan persetujuan minimal 3 karakter.",
  }),
});

const rejectAccessRequestSchema = Joi.object({
  action_note: Joi.string().trim().min(3).required().messages({
    "any.required": "Alasan penolakan wajib diisi.",
    "string.empty": "Alasan penolakan wajib diisi.",
    "string.min": "Alasan penolakan minimal 3 karakter.",
  }),
});

module.exports = {
  approveAccessRequestSchema,
  createAccessRequestSchema,
  rejectAccessRequestSchema,
};
