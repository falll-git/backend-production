const Joi = require("joi");

const periodMonth = Joi.string().pattern(/^\d{4}-(0[1-9]|1[0-2])$/);
const optionalUuid = Joi.string().uuid().allow("", null);
const paginationQuery = {
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
};
const commonReportQuery = {
  ...paginationQuery,
  search: Joi.string().trim().max(120).allow("").optional(),
  branch_id: optionalUuid.optional(),
  marketing_user_id: optionalUuid.optional(),
  customer_type: Joi.string().trim().max(50).allow("").optional(),
  status: Joi.string().trim().max(50).allow("").optional(),
  period_month: periodMonth.allow("").optional(),
  collectibility_level: Joi.number().integer().min(1).max(5).allow("").optional(),
};

exports.summaryQuerySchema = Joi.object({}).unknown(true);
exports.reportQuerySchema = Joi.object(commonReportQuery).unknown(true);
exports.collateralReportQuerySchema = Joi.object({
  ...commonReportQuery,
  collateral_type: Joi.string().trim().max(120).allow("").optional(),
  link_status: Joi.string().trim().valid("linked", "unlinked", "LINKED", "UNLINKED", "").optional(),
}).unknown(true);

exports.completenessReportQuerySchema = Joi.object({
  ...commonReportQuery,
  issue_type: Joi.string()
    .trim()
    .valid(
      "REQUIRED_DOCUMENTS_INCOMPLETE",
      "DEBTOR_WITHOUT_FACILITY",
      "FACILITY_WITHOUT_COLLATERAL",
      "UNLINKED_COLLATERAL",
      "MISSING_SLIK_PERIOD",
      "",
    )
    .optional(),
}).unknown(true);

exports.npfQuerySchema = Joi.object({
  ...commonReportQuery,
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
