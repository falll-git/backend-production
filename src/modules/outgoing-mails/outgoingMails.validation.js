const Joi = require("joi");

const SEND_DATE_REQUIRED_MESSAGE = "Tanggal kirim surat wajib diisi.";
const SEND_DATE_INVALID_MESSAGE = "Format tanggal kirim surat tidak valid.";
const SEND_DUE_DATE_INVALID_MESSAGE = "Format target pengiriman tidak valid.";
const RESPONSE_DUE_DATE_INVALID_MESSAGE = "Format batas follow-up tidak valid.";
const FILE_REQUIRED_MESSAGE = "Dokumen wajib diunggah.";
const REQUIRED_CHANGE_MESSAGE = "Tidak ada data yang diperbarui.";
const uploadedFileSchema = Joi.object({
  buffer: Joi.any().optional(),
  temp_path: Joi.string().trim().optional(),
  name: Joi.string().trim().required().messages({
    "any.required": "Nama dokumen tidak terbaca.",
    "string.empty": "Nama dokumen tidak terbaca.",
  }),
  mime_type: Joi.string().trim().required().messages({
    "any.required": "Tipe dokumen tidak terbaca.",
    "string.empty": "Tipe dokumen tidak terbaca.",
  }),
  size_bytes: Joi.number().integer().min(0).optional(),
})
  .or("buffer", "temp_path")
  .unknown(true)
  .messages({
    "object.missing": FILE_REQUIRED_MESSAGE,
  });

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
  storage_id: Joi.string().trim().required().messages({
    "any.required": "Tempat penyimpanan fisik wajib dipilih.",
    "string.empty": "Tempat penyimpanan fisik wajib dipilih.",
  }),
  delivery_media: Joi.string()
    .trim()
    .min(1)
    .max(50)
    .required()
    .messages({
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
  send_due_date: Joi.date().iso().allow("", null).optional().messages({
    "date.base": SEND_DUE_DATE_INVALID_MESSAGE,
    "date.format": SEND_DUE_DATE_INVALID_MESSAGE,
  }),
  response_due_date: Joi.date().iso().allow("", null).optional().messages({
    "date.base": RESPONSE_DUE_DATE_INVALID_MESSAGE,
    "date.format": RESPONSE_DUE_DATE_INVALID_MESSAGE,
  }),
  follow_up_note: Joi.string().allow("", null).optional(),
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
  storage_id: Joi.string().trim().optional().messages({
    "string.empty": "Tempat penyimpanan fisik wajib dipilih.",
  }),
  delivery_media: Joi.string()
    .trim()
    .custom((value, helpers) => {
      const normalized = String(value || "").trim();

      if (!normalized) {
        return helpers.error("string.empty");
      }

      return normalized;
    })
    .messages({
      "string.empty": "Media pengiriman wajib dipilih.",
    }),
  name: Joi.string().trim().optional().messages({
    "string.empty": "Nama penerima wajib diisi.",
  }),
  send_date: Joi.date().iso().optional().messages({
    "date.base": SEND_DATE_INVALID_MESSAGE,
    "date.format": SEND_DATE_INVALID_MESSAGE,
  }),
  send_due_date: Joi.date().iso().allow("", null).optional().messages({
    "date.base": SEND_DUE_DATE_INVALID_MESSAGE,
    "date.format": SEND_DUE_DATE_INVALID_MESSAGE,
  }),
  response_due_date: Joi.date().iso().allow("", null).optional().messages({
    "date.base": RESPONSE_DUE_DATE_INVALID_MESSAGE,
    "date.format": RESPONSE_DUE_DATE_INVALID_MESSAGE,
  }),
  follow_up_note: Joi.string().allow("", null).optional(),
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
