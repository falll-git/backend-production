const Joi = require("joi");

exports.createLetterPrioritySchema = Joi.object({
  name: Joi.string().min(3).max(50).trim().required().messages({
    "any.required": "Nama prioritas surat wajib diisi.",
    "string.empty": "Nama prioritas surat wajib diisi.",
    "string.min": "Nama prioritas surat minimal 3 karakter.",
    "string.max": "Nama prioritas surat maksimal 50 karakter.",
  }),
});

exports.updateLetterPrioritySchema = Joi.object({
  name: Joi.string().min(3).max(50).trim().optional().messages({
    "string.empty": "Nama prioritas surat wajib diisi.",
    "string.min": "Nama prioritas surat minimal 3 karakter.",
    "string.max": "Nama prioritas surat maksimal 50 karakter.",
  }),
}).min(1).messages({
  "object.min": "Tidak ada data yang diperbarui.",
});
