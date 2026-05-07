const Joi = require("joi");

exports.authSchema = Joi.object({
  username: Joi.string().trim().required().messages({
    "any.required": "Username wajib diisi.",
    "string.empty": "Username wajib diisi.",
  }),
  password: Joi.string().required().messages({
    "any.required": "Password wajib diisi.",
    "string.empty": "Password wajib diisi.",
  }),
});

exports.refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().trim().required().messages({
    "any.required": "Sesi login wajib disertakan.",
    "string.empty": "Sesi login wajib disertakan.",
  }),
});

exports.changePasswordSchema = Joi.object({
  oldPassword: Joi.string().required().messages({
    "any.required": "Password saat ini wajib diisi.",
    "string.empty": "Password saat ini wajib diisi.",
  }),
  newPassword: Joi.string().min(8).required().messages({
    "any.required": "Password baru wajib diisi.",
    "string.empty": "Password baru wajib diisi.",
    "string.min": "Password baru minimal 8 karakter.",
  }),
  confirmPassword: Joi.string()
    .valid(Joi.ref("newPassword"))
    .required()
    .messages({
      "any.only": "Konfirmasi password tidak sesuai.",
      "any.required": "Konfirmasi password wajib diisi.",
      "string.empty": "Konfirmasi password wajib diisi.",
    }),
});

exports.forgotPasswordSchema = Joi.object({
  email: Joi.string().email().trim().required().messages({
    "any.required": "Email wajib diisi.",
    "string.empty": "Email wajib diisi.",
    "string.email": "Format email tidak valid.",
  }),
});

exports.verifySetPasswordSchema = Joi.object({
  token: Joi.string().trim().required().messages({
    "any.required": "Token aktivasi wajib disertakan.",
    "string.empty": "Token aktivasi wajib disertakan.",
  }),
});

exports.setPasswordSchema = Joi.object({
  token: Joi.string().trim().required().messages({
    "any.required": "Token aktivasi wajib disertakan.",
    "string.empty": "Token aktivasi wajib disertakan.",
  }),
  password: Joi.string().min(8).required().messages({
    "any.required": "Password wajib diisi.",
    "string.empty": "Password wajib diisi.",
    "string.min": "Password minimal 8 karakter.",
  }),
  confirmPassword: Joi.string().valid(Joi.ref("password")).required().messages({
    "any.only": "Konfirmasi password tidak sesuai.",
    "any.required": "Konfirmasi password wajib diisi.",
    "string.empty": "Konfirmasi password wajib diisi.",
  }),
});

exports.verifyResetPasswordSchema = Joi.object({
  token: Joi.string().trim().required().messages({
    "any.required": "Token reset password wajib disertakan.",
    "string.empty": "Token reset password wajib disertakan.",
  }),
});

exports.resetPasswordSchema = Joi.object({
  token: Joi.string().trim().required().messages({
    "any.required": "Token reset password wajib disertakan.",
    "string.empty": "Token reset password wajib disertakan.",
  }),
  password: Joi.string().min(8).required().messages({
    "any.required": "Password wajib diisi.",
    "string.empty": "Password wajib diisi.",
    "string.min": "Password minimal 8 karakter.",
  }),
  confirmPassword: Joi.string().valid(Joi.ref("password")).required().messages({
    "any.only": "Konfirmasi password tidak sesuai.",
    "any.required": "Konfirmasi password wajib diisi.",
    "string.empty": "Konfirmasi password wajib diisi.",
  }),
});
