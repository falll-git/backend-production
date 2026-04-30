const Joi = require("joi");

const uuid = Joi.string().uuid();

const createAccessRequestSchema = Joi.object({
  document_ids: Joi.array().items(uuid).min(1).required(),
  request_reason: Joi.string().trim().min(5).required(),
});

const approveAccessRequestSchema = Joi.object({
  expires_at: Joi.date().iso().required(),
  action_note: Joi.string().trim().min(3).required(),
});

const rejectAccessRequestSchema = Joi.object({
  action_note: Joi.string().trim().min(3).required(),
});

module.exports = {
  approveAccessRequestSchema,
  createAccessRequestSchema,
  rejectAccessRequestSchema,
};
