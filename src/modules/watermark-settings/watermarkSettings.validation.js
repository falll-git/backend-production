const Joi = require("joi");

const WATERMARK_TYPES = ["TEXT", "IMAGE", "TEXT_IMAGE"];
const WATERMARK_POSITIONS = [
  "CENTER",
  "TOP_LEFT",
  "TOP_RIGHT",
  "BOTTOM_LEFT",
  "BOTTOM_RIGHT",
];
const TARGET_MODULES = [
  "digital_archive",
  "incoming_mail",
  "outgoing_mail",
  "memorandum",
];
const hexColorSchema = Joi.string()
  .trim()
  .pattern(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);

exports.updateWatermarkSettingsSchema = Joi.object({
  is_enabled: Joi.boolean().optional(),
  target_modules: Joi.array()
    .items(Joi.string().valid(...TARGET_MODULES))
    .unique()
    .optional(),
  watermark_type: Joi.string()
    .uppercase()
    .valid(...WATERMARK_TYPES)
    .optional(),
  text_template: Joi.string().trim().allow("", null).max(500).optional(),
  text_color: hexColorSchema.optional().messages({
    "string.pattern.base": "Warna teks watermark harus format hex.",
  }),
  text_opacity: Joi.number().min(0).max(1).optional(),
  font_family: Joi.string().trim().min(2).max(80).optional(),
  font_size: Joi.number().integer().min(8).max(200).optional(),
  image_opacity: Joi.number().min(0).max(1).optional(),
  image_scale: Joi.number().min(0.05).max(2).optional(),
  position: Joi.string()
    .uppercase()
    .valid(...WATERMARK_POSITIONS)
    .optional(),
  repeat_pattern: Joi.boolean().optional(),
  rotation: Joi.number().min(-360).max(360).optional(),
  spacing_x: Joi.number().integer().min(80).max(1200).optional(),
  spacing_y: Joi.number().integer().min(80).max(1200).optional(),
  clear_image: Joi.boolean().optional(),
})
  .min(1)
  .messages({
    "object.min": "Tidak ada data konfigurasi watermark yang diperbarui.",
  });
