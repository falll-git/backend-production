const Joi = require("joi");

exports.authSchema = Joi.object({
  username: Joi.string().trim().required().messages({
    "string.empty": "Username is required",
  }),
  password: Joi.string().required().messages({
    "string.empty": "Password is required",
  }),
});

exports.refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().trim().required().messages({
    "string.empty": "Refresh token is required",
  }),
});

exports.changePasswordSchema = Joi.object({
  oldPassword: Joi.string().required().messages({
    "string.empty": "Current password is required",
  }),
  newPassword: Joi.string().min(8).required().messages({
    "string.empty": "New password is required",
    "string.min": "New password must be at least 8 characters",
  }),
  confirmPassword: Joi.string()
    .valid(Joi.ref("newPassword"))
    .required()
    .messages({
      "any.only": "Password confirmation does not match",
      "string.empty": "Password confirmation is required",
    }),
});

exports.forgotPasswordSchema = Joi.object({
  email: Joi.string().email().trim().required().messages({
    "string.empty": "Email is required",
    "string.email": "Email must be a valid email address",
  }),
});

exports.verifySetPasswordSchema = Joi.object({
  token: Joi.string().trim().required().messages({
    "string.empty": "Invitation token is required",
  }),
});

exports.setPasswordSchema = Joi.object({
  token: Joi.string().trim().required().messages({
    "string.empty": "Invitation token is required",
  }),
  password: Joi.string().min(8).required().messages({
    "string.empty": "Password is required",
    "string.min": "Password must be at least 8 characters",
  }),
  confirmPassword: Joi.string().valid(Joi.ref("password")).required().messages({
    "any.only": "Password confirmation does not match",
    "string.empty": "Password confirmation is required",
  }),
});

exports.verifyResetPasswordSchema = Joi.object({
  token: Joi.string().trim().required().messages({
    "string.empty": "Reset password token is required",
  }),
});

exports.resetPasswordSchema = Joi.object({
  token: Joi.string().trim().required().messages({
    "string.empty": "Reset password token is required",
  }),
  password: Joi.string().min(8).required().messages({
    "string.empty": "Password is required",
    "string.min": "Password must be at least 8 characters",
  }),
  confirmPassword: Joi.string().valid(Joi.ref("password")).required().messages({
    "any.only": "Password confirmation does not match",
    "string.empty": "Password confirmation is required",
  }),
});
