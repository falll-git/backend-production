const Joi = require("joi");

exports.createLetterPrioritySchema = Joi.object({
  name: Joi.string().min(3).max(50).trim().required().messages({
    "string.empty": "Letter priority name is required",
    "string.min": " Letter priority name must be at least 3 characters",
    "string.max": "Letter priority name must not exceed 50 characters",
  }),
});

exports.updateLetterPrioritySchema = Joi.object({
  name: Joi.string().min(3).max(50).trim().optional(),
});
