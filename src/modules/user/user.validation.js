const Joi = require("joi");

exports.createUserSchema = Joi.object({
  name: Joi.string().trim().required().messages({
    "any.required": "Nama pengguna wajib diisi.",
    "string.empty": "Nama pengguna wajib diisi.",
  }),
  username: Joi.string().trim().required().messages({
    "any.required": "Username wajib diisi.",
    "string.empty": "Username wajib diisi.",
  }),
  email: Joi.string().email().trim().required().messages({
    "any.required": "Email wajib diisi.",
    "string.empty": "Email wajib diisi.",
    "string.email": "Format email tidak valid.",
  }),
  phone: Joi.string().trim().optional(),
  is_active: Joi.boolean().optional(),
  can_access_restricted_documents: Joi.boolean().optional(),
  is_restrict: Joi.boolean().optional(),
  password: Joi.forbidden().messages({
    "any.unknown": "Password dibuat melalui tautan aktivasi.",
  }),
  send_invite: Joi.boolean().optional(),
  role_id: Joi.string().trim().required().messages({
    "any.required": "Role wajib dipilih.",
    "string.empty": "Role wajib dipilih.",
  }),
  division_id: Joi.string().trim().required().messages({
    "any.required": "Divisi wajib dipilih.",
    "string.empty": "Divisi wajib dipilih.",
  }),
});

exports.updateUserSchema = Joi.object({
  name: Joi.string().trim().optional().messages({
    "string.empty": "Nama pengguna wajib diisi.",
  }),
  username: Joi.string().trim().optional().messages({
    "string.empty": "Username wajib diisi.",
  }),
  email: Joi.string().email().trim().optional().messages({
    "string.empty": "Email wajib diisi.",
    "string.email": "Format email tidak valid.",
  }),
  phone: Joi.string().trim().optional(),
  is_active: Joi.boolean().optional(),
  can_access_restricted_documents: Joi.boolean().optional(),
  is_restrict: Joi.boolean().optional(),
  password: Joi.forbidden().messages({
    "any.unknown": "Password hanya dapat diubah melalui alur reset password.",
  }),
  role_id: Joi.string().trim().optional().messages({
    "string.empty": "Role wajib dipilih.",
  }),
  division_id: Joi.string().trim().optional().messages({
    "string.empty": "Divisi wajib dipilih.",
  }),
}).min(1).messages({
  "object.min": "Tidak ada data yang diperbarui.",
});

exports.closeAccessSchema = Joi.object({
  reason: Joi.string().trim().min(5).max(500).required().messages({
    "any.required": "Alasan penutupan akses wajib diisi.",
    "string.empty": "Alasan penutupan akses wajib diisi.",
    "string.min": "Alasan penutupan akses minimal 5 karakter.",
    "string.max": "Alasan penutupan akses maksimal 500 karakter.",
  }),
});

exports.reactivateAccessSchema = Joi.object({
  reason: Joi.string().trim().min(5).max(500).required().messages({
    "any.required": "Alasan aktivasi ulang wajib diisi.",
    "string.empty": "Alasan aktivasi ulang wajib diisi.",
    "string.min": "Alasan aktivasi ulang minimal 5 karakter.",
    "string.max": "Alasan aktivasi ulang maksimal 500 karakter.",
  }),
});
