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
  timeline_id: optionalUuid.optional(),
  timeline_group_id: Joi.string().trim().max(100).allow("", null).optional(),
  related_activity_id: optionalUuid.optional(),
  activity_date: Joi.date().allow(null).optional(),
  target_date: Joi.date().allow(null).optional(),
  status: Joi.string().trim().max(50).default("PENDING"),
  action_plan: Joi.string().trim().allow("", null).optional(),
  visit_address: Joi.string().trim().allow("", null).optional(),
  visit_result: Joi.string().trim().allow("", null).optional(),
  conclusion: Joi.string().trim().allow("", null).optional(),
  handling_step: Joi.string().trim().allow("", null).optional(),
  handling_result: Joi.string().trim().allow("", null).optional(),
  notes: Joi.string().trim().allow("", null).optional(),
  file: fileSchema.optional(),
  files: filesSchema.optional(),
};

exports.createMarketingActivitySchema = Joi.object(payload);
exports.updateMarketingActivitySchema = Joi.object(
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
