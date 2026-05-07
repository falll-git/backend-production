const Joi = require("joi");

const ROLE_TYPE_MESSAGE = "Tipe role harus Role Utama atau Role Tambahan.";
const REQUIRED_CHANGE_MESSAGE = "Tidak ada data yang diperbarui.";

exports.createRoleSchema = Joi.object({
  name: Joi.string().trim().required().messages({
    "any.required": "Nama role wajib diisi.",
    "string.empty": "Nama role wajib diisi.",
  }),
  type: Joi.string().valid("MAIN", "ADDITIONAL", "DIVISION").default("ADDITIONAL").optional().messages({
    "any.only": ROLE_TYPE_MESSAGE,
    "string.empty": ROLE_TYPE_MESSAGE,
  }),
});

exports.updateRoleSchema = Joi.object({
  name: Joi.string().trim().optional().messages({
    "string.empty": "Nama role wajib diisi.",
  }),
  type: Joi.string().valid("MAIN", "ADDITIONAL", "DIVISION").optional().messages({
    "any.only": ROLE_TYPE_MESSAGE,
    "string.empty": ROLE_TYPE_MESSAGE,
  }),
}).min(1).messages({
  "object.min": REQUIRED_CHANGE_MESSAGE,
});
