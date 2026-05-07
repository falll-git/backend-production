const Joi = require("joi");

exports.createStorageSchema = Joi.object({
  office_code: Joi.string().min(2).max(50).trim().required().messages({
    "any.required": "Kode kantor wajib diisi.",
    "string.empty": "Kode kantor wajib diisi.",
    "string.min": "Kode kantor minimal 2 karakter.",
    "string.max": "Kode kantor maksimal 50 karakter.",
  }),
  office_label: Joi.string().min(3).max(100).trim().required().messages({
    "any.required": "Nama kantor wajib diisi.",
    "string.empty": "Nama kantor wajib diisi.",
    "string.min": "Nama kantor minimal 3 karakter.",
    "string.max": "Nama kantor maksimal 100 karakter.",
  }),
  code: Joi.string().min(2).max(50).trim().required().messages({
    "any.required": "Kode lemari wajib diisi.",
    "string.empty": "Kode lemari wajib diisi.",
    "string.min": "Kode lemari minimal 2 karakter.",
    "string.max": "Kode lemari maksimal 50 karakter.",
  }),
  name: Joi.string().min(3).max(50).trim().required().messages({
    "any.required": "Nama rak wajib diisi.",
    "string.empty": "Nama rak wajib diisi.",
    "string.min": "Nama rak minimal 3 karakter.",
    "string.max": "Nama rak maksimal 50 karakter.",
  }),
  capacity: Joi.alternatives()
    .try(
      Joi.number().integer().min(0),
      Joi.string().trim().pattern(/^\d+$/),
    )
    .required()
    .messages({
      "alternatives.match": "Kapasitas rak harus berupa angka nol atau lebih.",
      "any.required": "Kapasitas rak wajib diisi.",
    }),
  is_active: Joi.boolean().required().messages({
    "any.required": "Status rak wajib dipilih.",
    "boolean.base": "Status rak tidak valid.",
  }),
});

exports.updateStorageSchema = Joi.object({
  code: Joi.string().min(2).max(50).trim().optional().messages({
    "string.empty": "Kode lemari wajib diisi.",
    "string.min": "Kode lemari minimal 2 karakter.",
    "string.max": "Kode lemari maksimal 50 karakter.",
  }),
  name: Joi.string().min(3).max(50).trim().optional().messages({
    "string.empty": "Nama rak wajib diisi.",
    "string.min": "Nama rak minimal 3 karakter.",
    "string.max": "Nama rak maksimal 50 karakter.",
  }),
  is_active: Joi.boolean().optional().messages({
    "boolean.base": "Status rak tidak valid.",
  }),
  office_code: Joi.string().trim().optional().messages({
    "string.empty": "Kode kantor wajib diisi.",
  }),
  office_label: Joi.string().trim().optional().messages({
    "string.empty": "Nama kantor wajib diisi.",
  }),
  capacity: Joi.alternatives()
    .try(
      Joi.number().integer().min(0),
      Joi.string().trim().pattern(/^\d+$/),
    )
    .optional()
    .messages({
      "alternatives.match": "Kapasitas rak harus berupa angka nol atau lebih.",
    }),
}).min(1).messages({
  "object.min": "Tidak ada data yang diperbarui.",
});
