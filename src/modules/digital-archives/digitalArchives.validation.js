const Joi = require("joi");

const uuid = Joi.string().uuid();
const paginationQuerySchema = Joi.object({
  page: Joi.alternatives()
    .try(Joi.number().integer().min(1), Joi.string().valid("all"))
    .optional(),
  limit: Joi.alternatives()
    .try(Joi.number().integer().min(1).max(500), Joi.string().valid("all"))
    .optional(),
  search: Joi.string().trim().allow("", null).optional(),
  sort_by: Joi.string().trim().allow("", null).optional(),
  sort_order: Joi.string().valid("asc", "desc", "ASC", "DESC").optional(),
}).unknown(true);

exports.paginationQuerySchema = paginationQuerySchema;
exports.officeParamsSchema = Joi.object({ officeId: uuid.required() });
exports.cabinetParamsSchema = Joi.object({ cabinetId: uuid.required() });
exports.rackParamsSchema = Joi.object({ rackId: uuid.required() });
exports.historyQuerySchema = paginationQuerySchema;
exports.reportQuerySchema = paginationQuerySchema.keys({
  from_date: Joi.date().iso().optional(),
  to_date: Joi.date().iso().optional(),
  status: Joi.string().trim().allow("", null).optional(),
  document_type_id: uuid.optional(),
  owner_user_id: uuid.optional(),
  owner_division_id: uuid.optional(),
});
