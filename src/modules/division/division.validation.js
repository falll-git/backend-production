const Joi = require("joi");

exports.createDivisionSchema = Joi.object({
  name: Joi.string().trim().required().messages({
    "any.required": "Nama divisi wajib diisi.",
    "string.empty": "Nama divisi wajib diisi.",
  }),
});

exports.updateDivisionSchema = Joi.object({
  name: Joi.string().trim().optional().messages({
    "string.empty": "Nama divisi wajib diisi.",
  }),
}).min(1).messages({
  "object.min": "Tidak ada data yang diperbarui.",
});
