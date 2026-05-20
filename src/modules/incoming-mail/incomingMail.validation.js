const Joi = require("joi");

const RECEIVE_DATE_REQUIRED_MESSAGE = "Tanggal terima surat wajib diisi.";
const RECEIVE_DATE_INVALID_MESSAGE = "Format tanggal terima surat tidak valid.";
const START_DATE_INVALID_MESSAGE = "Format tanggal mulai disposisi tidak valid.";
const DUE_DATE_INVALID_MESSAGE = "Format tanggal batas disposisi tidak valid.";
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

function normalizeDivisionIds(value, helpers) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return helpers.error("array.base");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
  }

  return trimmed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const divisionIdsSchema = Joi.any()
  .custom(normalizeDivisionIds)
  .custom((value, helpers) => {
    const normalized = Array.isArray(value)
      ? value.map((item) => String(item).trim()).filter(Boolean)
      : [];
    const unique = [...new Set(normalized)];

    if (unique.length === 0) {
      return undefined;
    }

    if (unique.length !== normalized.length) {
      return helpers.error("array.unique");
    }

    return unique;
  })
  .messages({
    "any.custom": "Format divisi tujuan tidak sesuai.",
    "array.base": "Format divisi tujuan tidak sesuai.",
    "array.min": "Pilih minimal satu divisi tujuan.",
    "array.unique": "Divisi tujuan tidak boleh duplikat.",
  });

const baseIncomingMailCreateSchema = Joi.object({
  letter_prioritie_id: Joi.string().required().messages({
    "any.required": "Prioritas surat wajib dipilih.",
    "string.empty": "Prioritas surat wajib dipilih.",
  }),
  storage_id: Joi.string().trim().required().messages({
    "any.required": "Tempat penyimpanan fisik wajib dipilih.",
    "string.empty": "Tempat penyimpanan fisik wajib dipilih.",
  }),
  target_division_id: Joi.string().trim().optional().messages({
    "string.empty": "Divisi tujuan wajib dipilih.",
  }),
  target_division_ids: divisionIdsSchema.optional(),
  division_id: Joi.forbidden().messages({
    "any.unknown": "Gunakan target_division_ids untuk divisi tujuan surat masuk.",
  }),
  division_ids: Joi.forbidden().messages({
    "any.unknown": "Gunakan target_division_ids untuk divisi tujuan surat masuk.",
  }),
  regarding: Joi.string().trim().required().messages({
    "any.required": "Perihal surat wajib diisi.",
    "string.empty": "Perihal surat wajib diisi.",
  }),
  description: Joi.string().allow("", null).optional(),
  name: Joi.string().trim().required().messages({
    "any.required": "Nama pengirim wajib diisi.",
    "string.empty": "Nama pengirim wajib diisi.",
  }),
  receive_date: Joi.date().iso().required().messages({
    "any.required": RECEIVE_DATE_REQUIRED_MESSAGE,
    "date.base": RECEIVE_DATE_INVALID_MESSAGE,
    "date.format": RECEIVE_DATE_INVALID_MESSAGE,
  }),
  address: Joi.string().trim().required().messages({
    "any.required": "Alamat pengirim wajib diisi.",
    "string.empty": "Alamat pengirim wajib diisi.",
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
})
  .or("target_division_id", "target_division_ids")
  .messages({
    "object.missing": "Pilih minimal satu divisi tujuan.",
  });

exports.createIncomingMailWithDispositionSchema = baseIncomingMailCreateSchema;

exports.redisposeIncomingMailSchema = Joi.object({
  receiver_id: Joi.string().optional().messages({
    "any.required": "Penerima disposisi wajib dipilih.",
    "string.empty": "Penerima disposisi wajib dipilih.",
  }),
  receiver_ids: Joi.array()
    .items(Joi.string().trim().required())
    .min(1)
    .optional()
    .messages({
      "array.base": "Penerima disposisi tidak valid.",
      "array.min": "Penerima disposisi wajib dipilih.",
      "string.empty": "Penerima disposisi wajib dipilih.",
    }),
  note: Joi.string().allow("", null).optional(),
  start_date: Joi.date().iso().allow(null).optional().messages({
    "date.base": START_DATE_INVALID_MESSAGE,
    "date.format": START_DATE_INVALID_MESSAGE,
  }),
  due_date: Joi.date().iso().allow(null).optional().messages({
    "date.base": DUE_DATE_INVALID_MESSAGE,
    "date.format": DUE_DATE_INVALID_MESSAGE,
  }),
})
  .or("receiver_id", "receiver_ids")
  .messages({
    "object.missing": "Penerima disposisi wajib dipilih.",
  });

exports.updateIncomingDispositionStatusSchema = Joi.object({
  status: Joi.string()
    .trim()
    .uppercase()
    .valid("IN_PROGRESS", "COMPLETED")
    .required()
    .messages({
      "any.only": "Status disposisi hanya dapat diubah menjadi diproses atau selesai.",
      "any.required": "Status disposisi wajib diisi.",
      "string.empty": "Status disposisi wajib diisi.",
    }),
});

exports.updateIncomingMailSchema = Joi.object({
  letter_prioritie_id: Joi.string().optional().messages({
    "string.empty": "Prioritas surat wajib dipilih.",
  }),
  storage_id: Joi.string().trim().optional().messages({
    "string.empty": "Tempat penyimpanan fisik wajib dipilih.",
  }),
  target_division_id: Joi.forbidden().messages({
    "any.unknown": "Divisi tujuan surat masuk tidak dapat diubah.",
  }),
  target_division_ids: Joi.forbidden().messages({
    "any.unknown": "Divisi tujuan surat masuk tidak dapat diubah.",
  }),
  division_id: Joi.forbidden().messages({
    "any.unknown": "Divisi tujuan surat masuk tidak dapat diubah.",
  }),
  division_ids: Joi.forbidden().messages({
    "any.unknown": "Divisi tujuan surat masuk tidak dapat diubah.",
  }),
  regarding: Joi.string().trim().optional().messages({
    "string.empty": "Perihal surat wajib diisi.",
  }),
  description: Joi.string().allow("", null).optional(),
  name: Joi.string().trim().optional().messages({
    "string.empty": "Nama pengirim wajib diisi.",
  }),
  receive_date: Joi.date().iso().optional().messages({
    "date.base": RECEIVE_DATE_INVALID_MESSAGE,
    "date.format": RECEIVE_DATE_INVALID_MESSAGE,
  }),
  address: Joi.string().trim().optional().messages({
    "string.empty": "Alamat pengirim wajib diisi.",
  }),
  mail_number: Joi.string().trim().optional().messages({
    "string.empty": "Nomor surat wajib diisi.",
  }),
  file: fileInputSchema,
  status: Joi.alternatives()
    .try(
      Joi.number().integer().min(0).max(3),
      Joi.string()
        .trim()
        .uppercase()
        .valid("NEW", "IN_PROGRESS", "COMPLETED", "OVERDUE", "0", "1", "2", "3"),
    )
    .optional()
    .messages({
      "alternatives.match": "Status surat masuk tidak valid.",
      "alternatives.types": "Status surat masuk tidak valid.",
    }),
})
  .min(1)
  .messages({
    "object.min": REQUIRED_CHANGE_MESSAGE,
  });
