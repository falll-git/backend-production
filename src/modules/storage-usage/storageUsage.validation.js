const Joi = require("joi");

exports.summaryQuerySchema = Joi.object({
  days: Joi.number().integer().min(7).max(90).optional(),
}).unknown(true);
