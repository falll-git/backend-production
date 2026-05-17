const Joi = require("joi");

const uuid = Joi.string().uuid();
const optionalUuid = uuid.allow(null, "");
const fileSchema = Joi.object({
  buffer: Joi.any().required(),
  name: Joi.string().trim().required(),
  mime_type: Joi.string().trim().required(),
  size_bytes: Joi.number().integer().optional(),
}).unknown(true);

const debtorPayload = {
  debtor_number: Joi.string().trim().max(100).allow("", null).optional(),
  identity_number: Joi.string().trim().max(100).allow("", null).optional(),
  name: Joi.string().trim().min(2).max(255).required(),
  address: Joi.string().trim().allow("", null).optional(),
  phone: Joi.string().trim().allow("", null).optional(),
  branch_id: optionalUuid.optional(),
  marketing_user_id: optionalUuid.optional(),
  financing_number: Joi.string().trim().max(100).allow("", null).optional(),
  status: Joi.string().trim().max(50).default("ACTIVE"),
  description: Joi.string().trim().allow("", null).optional(),
};

exports.createDebtorSchema = Joi.object(debtorPayload);
exports.updateDebtorSchema = Joi.object(
  Object.fromEntries(
    Object.entries(debtorPayload).map(([field, schema]) => [
      field,
      schema.optional(),
    ]),
  ),
)
  .prefs({ noDefaults: true })
  .min(1)
  .messages({ "object.min": "Tidak ada data yang diperbarui." });

exports.createDebtorDocumentSchema = Joi.object({
  contract_id: optionalUuid.optional(),
  document_checklist_id: optionalUuid.optional(),
  document_type: Joi.string().trim().min(1).max(100).required(),
  category: Joi.string().valid("AWAL", "LAINNYA").default("LAINNYA"),
  description: Joi.string().trim().allow("", null).optional(),
  file: fileSchema.required(),
});
