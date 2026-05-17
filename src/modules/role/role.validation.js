const Joi = require("joi");

const REQUIRED_CHANGE_MESSAGE = "Tidak ada data yang diperbarui.";

exports.createRoleSchema = Joi.object({
  name: Joi.string().trim().required().messages({
    "any.required": "Nama role wajib diisi.",
    "string.empty": "Nama role wajib diisi.",
  }),
});

exports.updateRoleSchema = Joi.object({
  name: Joi.string().trim().optional().messages({
    "string.empty": "Nama role wajib diisi.",
  }),
}).min(1).messages({
  "object.min": REQUIRED_CHANGE_MESSAGE,
});
