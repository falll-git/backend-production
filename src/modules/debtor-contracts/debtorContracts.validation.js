const Joi = require("joi");

const uuid = Joi.string().uuid();
const optionalUuid = uuid.allow(null, "");
const amount = Joi.number().min(0).precision(2);

const contractPayload = {
  no_kontrak: Joi.string().trim().min(1).max(100).required(),
  debtor_id: uuid.required(),
  product_id: uuid.required(),
  akad_type_id: uuid.required(),
  branch_id: optionalUuid.optional(),
  marketing_user_id: optionalUuid.optional(),
  tanggal_akad: Joi.date().required(),
  tanggal_jatuh_tempo: Joi.date().allow(null).optional(),
  plafond: amount.default(0),
  pokok: amount.default(0),
  margin: amount.default(0),
  tenor: Joi.number().integer().min(1).required(),
  outstanding_pokok: amount.default(0),
  outstanding_margin: amount.default(0),
  status: Joi.string().trim().max(50).default("ACTIVE"),
  objek_pembiayaan: Joi.string().trim().allow("", null).optional(),
  agunan: Joi.string().trim().allow("", null).optional(),
};

exports.createDebtorContractSchema = Joi.object(contractPayload);
exports.updateDebtorContractSchema = Joi.object(
  Object.fromEntries(
    Object.entries(contractPayload).map(([field, schema]) => [
      field,
      schema.optional(),
    ]),
  ),
)
  .prefs({ noDefaults: true })
  .min(1)
  .messages({ "object.min": "Tidak ada data yang diperbarui." });
