const Joi = require("joi");

const uuid = Joi.string().uuid();

const createLoanSchema = Joi.object({
  document_ids: Joi.array().items(uuid).min(1).required().messages({
    "any.required": "Pilih minimal satu dokumen yang dipinjam.",
    "array.base": "Format dokumen yang dipinjam tidak valid.",
    "array.min": "Pilih minimal satu dokumen yang dipinjam.",
    "string.guid": "Dokumen yang dipilih tidak valid.",
  }),
  requested_start_date: Joi.date().iso().required().messages({
    "any.required": "Tanggal pinjam wajib diisi.",
    "date.base": "Format tanggal pinjam tidak valid.",
    "date.format": "Format tanggal pinjam tidak valid.",
  }),
  requested_due_date: Joi.date().iso().required().messages({
    "any.required": "Tanggal estimasi pengembalian wajib diisi.",
    "date.base": "Format tanggal estimasi pengembalian tidak valid.",
    "date.format": "Format tanggal estimasi pengembalian tidak valid.",
  }),
  request_reason: Joi.string().trim().min(5).required().messages({
    "any.required": "Alasan peminjaman wajib diisi.",
    "string.empty": "Alasan peminjaman wajib diisi.",
    "string.min": "Alasan peminjaman minimal 5 karakter.",
  }),
});

const approveLoanSchema = Joi.object({
  approval_note: Joi.string().trim().min(3).required().messages({
    "any.required": "Catatan persetujuan wajib diisi.",
    "string.empty": "Catatan persetujuan wajib diisi.",
    "string.min": "Catatan persetujuan minimal 3 karakter.",
  }),
});

const rejectLoanSchema = Joi.object({
  rejection_note: Joi.string().trim().min(3).required().messages({
    "any.required": "Alasan penolakan wajib diisi.",
    "string.empty": "Alasan penolakan wajib diisi.",
    "string.min": "Alasan penolakan minimal 3 karakter.",
  }),
});

const handoverLoanSchema = Joi.object({
  handover_at: Joi.date().iso().required().messages({
    "any.required": "Tanggal penyerahan wajib diisi.",
    "date.base": "Format tanggal penyerahan tidak valid.",
    "date.format": "Format tanggal penyerahan tidak valid.",
  }),
  handover_note: Joi.string().trim().allow("", null).optional(),
});

const returnLoanSchema = Joi.object({
  returned_at: Joi.date().iso().required().messages({
    "any.required": "Tanggal pengembalian wajib diisi.",
    "date.base": "Format tanggal pengembalian tidak valid.",
    "date.format": "Format tanggal pengembalian tidak valid.",
  }),
  return_note: Joi.string().trim().min(3).required().messages({
    "any.required": "Catatan pengembalian wajib diisi.",
    "string.empty": "Catatan pengembalian wajib diisi.",
    "string.min": "Catatan pengembalian minimal 3 karakter.",
  }),
});

module.exports = {
  approveLoanSchema,
  createLoanSchema,
  handoverLoanSchema,
  rejectLoanSchema,
  returnLoanSchema,
};
