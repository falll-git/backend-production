const Joi = require("joi");

const periodMonth = Joi.string().pattern(/^\d{4}-(0[1-9]|1[0-2])$/);

exports.summaryQuerySchema = Joi.object({}).unknown(true);

exports.npfQuerySchema = Joi.object({
  from_period: periodMonth.optional(),
  to_period: periodMonth.optional(),
}).unknown(true);

exports.marketingActivityQuerySchema = Joi.object({
  from_date: Joi.date().iso().optional(),
  to_date: Joi.date().iso().optional(),
  activity_kind: Joi.string()
    .valid(
      "ACTION_PLAN",
      "VISIT_RESULT",
      "HANDLING_STEP",
      "HASIL_KUNJUNGAN",
      "LANGKAH_PENANGANAN",
    )
    .optional(),
  status: Joi.string().trim().max(50).optional(),
  search: Joi.string().trim().max(120).allow("").optional(),
  sort: Joi.string().valid("newest", "oldest", "TERBARU", "TERLAMA").optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
}).unknown(true);
