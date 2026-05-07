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
  is_restrict: Joi.boolean().optional(),
  password: Joi.string().min(8).optional().messages({
    "string.min": "Password minimal 8 karakter.",
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
  is_restrict: Joi.boolean().optional(),
  password: Joi.string().min(8).optional().messages({
    "string.min": "Password minimal 8 karakter.",
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
