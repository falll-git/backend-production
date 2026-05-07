const Joi = require("joi");

const REQUIRED_CHANGE_MESSAGE = "Tidak ada data yang diperbarui.";

exports.createRoleMenuSchema = Joi.object({
  role_id: Joi.string().uuid().required().messages({
    "any.required": "Role wajib dipilih.",
    "string.empty": "Role wajib dipilih.",
    "string.guid": "Format role tidak valid.",
  }),
  menu_id: Joi.string().uuid().required().messages({
    "any.required": "Menu wajib dipilih.",
    "string.empty": "Menu wajib dipilih.",
    "string.guid": "Format menu tidak valid.",
  }),
  can_create: Joi.boolean().default(false).optional().messages({
    "boolean.base": "Hak akses tambah tidak valid.",
  }),
  can_read: Joi.boolean().default(false).optional().messages({
    "boolean.base": "Hak akses baca tidak valid.",
  }),
  can_update: Joi.boolean().default(false).optional().messages({
    "boolean.base": "Hak akses ubah tidak valid.",
  }),
  can_delete: Joi.boolean().default(false).optional().messages({
    "boolean.base": "Hak akses hapus tidak valid.",
  }),
  features: Joi.array().items(Joi.string().trim()).default([]).optional().messages({
    "array.base": "Format fitur akses tidak valid.",
  }),
});

exports.updateRoleMenuSchema = Joi.object({
  role_id: Joi.string().uuid().optional().messages({
    "string.empty": "Role wajib dipilih.",
    "string.guid": "Format role tidak valid.",
  }),
  menu_id: Joi.string().uuid().optional().messages({
    "string.empty": "Menu wajib dipilih.",
    "string.guid": "Format menu tidak valid.",
  }),
  can_create: Joi.boolean().optional().messages({
    "boolean.base": "Hak akses tambah tidak valid.",
  }),
  can_read: Joi.boolean().optional().messages({
    "boolean.base": "Hak akses baca tidak valid.",
  }),
  can_update: Joi.boolean().optional().messages({
    "boolean.base": "Hak akses ubah tidak valid.",
  }),
  can_delete: Joi.boolean().optional().messages({
    "boolean.base": "Hak akses hapus tidak valid.",
  }),
  features: Joi.array().items(Joi.string().trim()).optional().messages({
    "array.base": "Format fitur akses tidak valid.",
  }),
}).min(1).messages({
  "object.min": REQUIRED_CHANGE_MESSAGE,
});
