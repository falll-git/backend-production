const Joi = require("joi");

exports.createRoleMenuSchema = Joi.object({
  role_id: Joi.string().uuid().required(),
  menu_id: Joi.string().uuid().required(),
  can_create: Joi.boolean().default(false).optional(),
  can_read: Joi.boolean().default(false).optional(),
  can_update: Joi.boolean().default(false).optional(),
  can_delete: Joi.boolean().default(false).optional(),
});

exports.updateRoleMenuSchema = Joi.object({
  role_id: Joi.string().uuid().optional(),
  menu_id: Joi.string().uuid().optional(),
  can_create: Joi.boolean().optional(),
  can_read: Joi.boolean().optional(),
  can_update: Joi.boolean().optional(),
  can_delete: Joi.boolean().optional(),
});
