const Joi = require("joi");

const sortValues = ["newest", "oldest"];

exports.listSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().trim().max(200).allow("").optional(),
  module: Joi.string().trim().max(80).allow("").optional(),
  action: Joi.string().trim().max(80).allow("").optional(),
  actor_id: Joi.string().trim().max(80).allow("").optional(),
  source: Joi.string().trim().max(80).allow("").optional(),
  entity_type: Joi.string().trim().max(120).allow("").optional(),
  date_from: Joi.date().iso().optional(),
  date_to: Joi.date().iso().min(Joi.ref("date_from")).optional(),
  sort: Joi.string().valid(...sortValues).default("newest"),
});

exports.exportSchema = exports.listSchema.fork(["page", "limit"], (schema) =>
  schema.forbidden(),
);

exports.idSchema = Joi.object({
  id: Joi.string().guid({ version: ["uuidv4"] }).required(),
});
