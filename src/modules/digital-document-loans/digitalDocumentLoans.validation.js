const Joi = require("joi");

const uuid = Joi.string().uuid();

const createLoanSchema = Joi.object({
  document_ids: Joi.array().items(uuid).min(1).required(),
  requested_start_date: Joi.date().iso().required(),
  requested_due_date: Joi.date().iso().required(),
  request_reason: Joi.string().trim().min(5).required(),
});

const approveLoanSchema = Joi.object({
  approval_note: Joi.string().trim().min(3).required(),
});

const rejectLoanSchema = Joi.object({
  rejection_note: Joi.string().trim().min(3).required(),
});

const handoverLoanSchema = Joi.object({
  handover_at: Joi.date().iso().required(),
  handover_note: Joi.string().trim().allow("", null).optional(),
});

const returnLoanSchema = Joi.object({
  returned_at: Joi.date().iso().required(),
  return_note: Joi.string().trim().min(3).required(),
});

module.exports = {
  approveLoanSchema,
  createLoanSchema,
  handoverLoanSchema,
  rejectLoanSchema,
  returnLoanSchema,
};
