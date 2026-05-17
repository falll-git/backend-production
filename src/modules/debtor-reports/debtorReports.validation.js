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
}).unknown(true);
