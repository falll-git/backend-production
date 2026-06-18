const Joi = require("joi");

const uuid = Joi.string().uuid();
const optionalUuid = uuid.allow("", null);
const fileSchema = Joi.object({
  buffer: Joi.any().required(),
  name: Joi.string().trim().required(),
  mime_type: Joi.string().trim().required(),
  size_bytes: Joi.number().integer().optional(),
}).unknown(true);
const filesSchema = Joi.array().items(fileSchema).min(1).max(20);

const payload = {
  debtor_id: uuid.required(),
  contract_id: optionalUuid.optional(),
  letter_type: Joi.string().trim().min(1).max(50).required(),
  issued_at: Joi.date().required(),
  sent_at: Joi.date().allow(null).optional(),
  delivery_status: Joi.string().trim().max(50).default("BELUM_DIKIRIM"),
  description: Joi.string().trim().allow("", null).optional(),
  file: fileSchema.optional(),
  files: filesSchema.optional(),
};

exports.createWarningLetterSchema = Joi.object(payload)
  .or("file", "files")
  .messages({
    "object.missing": "File surat peringatan wajib dipilih.",
  });
exports.updateWarningLetterSchema = Joi.object(
  Object.fromEntries(
    Object.entries(payload).map(([field, schema]) => [
      field,
      schema.optional(),
    ]),
  ),
)
  .prefs({ noDefaults: true })
  .min(1)
  .messages({ "object.min": "Tidak ada data yang diperbarui." });
