const Joi = require("joi");

const REQUIRED_CHANGE_MESSAGE = "Tidak ada data yang diperbarui.";

exports.createMenuSchema = Joi.object({
  name: Joi.string().required().messages({
    "any.required": "Nama menu wajib diisi.",
    "string.empty": "Nama menu wajib diisi.",
  }),
  parent_id: Joi.string().uuid().allow(null, "").optional().messages({
    "string.guid": "Format menu induk tidak valid.",
  }),
  parent: Joi.string().allow(null, "").optional(),
  children: Joi.string().allow(null, "").optional(),
  icon: Joi.string().allow(null, "").optional(),
  url: Joi.string().allow(null, "").optional(),
  order: Joi.number().integer().allow(null).optional().messages({
    "number.base": "Urutan menu harus berupa angka.",
    "number.integer": "Urutan menu harus berupa bilangan bulat.",
  }),
});

exports.updateMenuSchema = Joi.object({
  name: Joi.string().optional().messages({
    "string.empty": "Nama menu wajib diisi.",
  }),
  parent_id: Joi.string().uuid().allow(null, "").optional().messages({
    "string.guid": "Format menu induk tidak valid.",
  }),
  parent: Joi.string().allow(null, "").optional(),
  children: Joi.string().allow(null, "").optional(),
  icon: Joi.string().allow(null, "").optional(),
  url: Joi.string().allow(null, "").optional(),
  order: Joi.number().integer().allow(null).optional().messages({
    "number.base": "Urutan menu harus berupa angka.",
    "number.integer": "Urutan menu harus berupa bilangan bulat.",
  }),
}).min(1).messages({
  "object.min": REQUIRED_CHANGE_MESSAGE,
});
