const Joi = require("joi");

const uuid = Joi.string().uuid();
const optionalUuid = uuid.allow("", null);
const fileSchema = Joi.object({
  buffer: Joi.any().required(),
  name: Joi.string().trim().required(),
  mime_type: Joi.string().trim().required(),
  size_bytes: Joi.number().integer().optional(),
}).unknown(true);

exports.importJobSchema = Joi.object({
  file: fileSchema.required(),
  debtor_id: optionalUuid.optional(),
  contract_id: optionalUuid.optional(),
  period_month: Joi.string()
    .trim()
    .pattern(/^\d{4}-(0[1-9]|1[0-2])$/)
    .allow("", null)
    .optional(),
  raw_reference: Joi.string().trim().allow("", null).optional(),
  summary: Joi.alternatives().try(Joi.object(), Joi.array()).optional(),
  total_rows: Joi.number().integer().min(0).optional(),
});
