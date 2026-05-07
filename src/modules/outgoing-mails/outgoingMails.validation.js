const Joi = require("joi");

const SEND_DATE_REQUIRED_MESSAGE = "Tanggal kirim surat wajib diisi.";
const SEND_DATE_INVALID_MESSAGE = "Format tanggal kirim surat tidak valid.";
const FILE_REQUIRED_MESSAGE = "Dokumen wajib diunggah.";
const REQUIRED_CHANGE_MESSAGE = "Tidak ada data yang diperbarui.";
const DELIVERY_MEDIA_VALUES = ["email", "pos", "kurir", "langsung"];

const uploadedFileSchema = Joi.object({
  buffer: Joi.any().required().messages({
    "any.required": FILE_REQUIRED_MESSAGE,
  }),
  name: Joi.string().trim().required().messages({
    "any.required": "Nama dokumen tidak terbaca.",
    "string.empty": "Nama dokumen tidak terbaca.",
  }),
  mime_type: Joi.string().trim().required().messages({
    "any.required": "Tipe dokumen tidak terbaca.",
    "string.empty": "Tipe dokumen tidak terbaca.",
  }),
}).unknown(true);

const fileInputSchema = Joi.alternatives()
  .try(Joi.string().trim().allow("", null), uploadedFileSchema)
  .optional();

const requiredFileInputSchema = Joi.alternatives()
  .try(Joi.string().trim().min(1), uploadedFileSchema)
  .required();

exports.createOutgoingMailSchema = Joi.object({
  letter_prioritie_id: Joi.string().required().messages({
    "any.required": "Prioritas surat wajib dipilih.",
    "string.empty": "Prioritas surat wajib dipilih.",
  }),
  delivery_media: Joi.string()
    .trim()
    .lowercase()
    .valid("email", "pos", "kurir", "langsung")
    .required()
    .messages({
      "any.only": "Media pengiriman harus email, pos, kurir, atau langsung.",
      "any.required": "Media pengiriman wajib dipilih.",
      "string.empty": "Media pengiriman wajib dipilih.",
    }),
  name: Joi.string().trim().required().messages({
    "any.required": "Nama penerima wajib diisi.",
    "string.empty": "Nama penerima wajib diisi.",
  }),
  send_date: Joi.date().iso().required().messages({
    "any.required": SEND_DATE_REQUIRED_MESSAGE,
    "date.base": SEND_DATE_INVALID_MESSAGE,
    "date.format": SEND_DATE_INVALID_MESSAGE,
  }),
  address: Joi.string().trim().required().messages({
    "any.required": "Alamat penerima wajib diisi.",
    "string.empty": "Alamat penerima wajib diisi.",
  }),
  mail_number: Joi.string().trim().required().messages({
    "any.required": "Nomor surat wajib diisi.",
    "string.empty": "Nomor surat wajib diisi.",
  }),
  file: requiredFileInputSchema.messages({
    "alternatives.match": FILE_REQUIRED_MESSAGE,
    "any.required": FILE_REQUIRED_MESSAGE,
    "string.empty": FILE_REQUIRED_MESSAGE,
    "string.min": FILE_REQUIRED_MESSAGE,
  }),
});

exports.updateOutgoingMailSchema = Joi.object({
  letter_prioritie_id: Joi.string().optional().messages({
    "string.empty": "Prioritas surat wajib dipilih.",
  }),
  delivery_media: Joi.string()
    .trim()
    .custom((value, helpers) => {
      const normalized = String(value || "")
        .trim()
        .toLowerCase();

      if (!normalized) {
        return helpers.error("string.empty");
      }

      if (!DELIVERY_MEDIA_VALUES.includes(normalized)) {
        return helpers.error("any.only");
      }

      return normalized;
    })
    .messages({
      "any.only": "Media pengiriman harus email, pos, kurir, atau langsung.",
      "string.empty": "Media pengiriman wajib dipilih.",
    }),
  name: Joi.string().trim().optional().messages({
    "string.empty": "Nama penerima wajib diisi.",
  }),
  send_date: Joi.date().iso().optional().messages({
    "date.base": SEND_DATE_INVALID_MESSAGE,
    "date.format": SEND_DATE_INVALID_MESSAGE,
  }),
  address: Joi.string().trim().optional().messages({
    "string.empty": "Alamat penerima wajib diisi.",
  }),
  mail_number: Joi.string().trim().optional().messages({
    "string.empty": "Nomor surat wajib diisi.",
  }),
  file: fileInputSchema,
  status: Joi.alternatives()
    .try(
      Joi.number().integer().valid(0, 1),
      Joi.string().trim().uppercase().valid("ACTIVE", "INACTIVE", "0", "1"),
    )
    .optional()
    .messages({
      "alternatives.match": "Status surat keluar tidak valid.",
    }),
}).min(1).messages({
  "object.min": REQUIRED_CHANGE_MESSAGE,
});
