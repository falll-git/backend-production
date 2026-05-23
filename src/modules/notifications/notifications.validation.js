const Joi = require("joi");

exports.listNotificationsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(50).default(10).optional(),
  unread_only: Joi.boolean().optional(),
  module: Joi.string().trim().max(80).optional(),
});
