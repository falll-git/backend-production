const Joi = require("joi");

const passwordSchema = Joi.string()
  .min(12)
  .max(128)
  .pattern(/^(?=.*[A-Za-z])(?=.*\d).+$/)
  .messages({
    "string.min": "Password minimal 12 karakter.",
    "string.max": "Password maksimal 128 karakter.",
    "string.pattern.base": "Password wajib mengandung huruf dan angka.",
  });

const currentPasswordSchema = Joi.string().max(128).required().messages({
  "any.required": "Password saat ini wajib diisi.",
  "string.empty": "Password saat ini wajib diisi.",
  "string.max": "Password saat ini maksimal 128 karakter.",
});

const actionTokenSchema = Joi.string().trim().max(4096).required();

exports.authSchema = Joi.object({
  username: Joi.string().trim().max(128).required().messages({
    "any.required": "Username wajib diisi.",
    "string.empty": "Username wajib diisi.",
  }),
  password: Joi.string().max(128).required().messages({
    "any.required": "Password wajib diisi.",
    "string.empty": "Password wajib diisi.",
  }),
  remember: Joi.boolean().optional(),
});

exports.refreshTokenSchema = Joi.object({
  remember: Joi.boolean().optional(),
});

exports.changePasswordSchema = Joi.object({
  oldPassword: currentPasswordSchema,
  newPassword: passwordSchema.required().messages({
    "any.required": "Password baru wajib diisi.",
    "string.empty": "Password baru wajib diisi.",
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
  email: Joi.string().email().trim().max(254).required().messages({
    "any.required": "Email wajib diisi.",
    "string.empty": "Email wajib diisi.",
    "string.email": "Format email tidak valid.",
  }),
});

exports.verifySetPasswordSchema = Joi.object({
  token: actionTokenSchema.messages({
    "any.required": "Token aktivasi wajib disertakan.",
    "string.empty": "Token aktivasi wajib disertakan.",
  }),
});

exports.setPasswordSchema = Joi.object({
  token: actionTokenSchema.messages({
    "any.required": "Token aktivasi wajib disertakan.",
    "string.empty": "Token aktivasi wajib disertakan.",
  }),
  password: passwordSchema.required().messages({
    "any.required": "Password wajib diisi.",
    "string.empty": "Password wajib diisi.",
  }),
  confirmPassword: Joi.string().valid(Joi.ref("password")).required().messages({
    "any.only": "Konfirmasi password tidak sesuai.",
    "any.required": "Konfirmasi password wajib diisi.",
    "string.empty": "Konfirmasi password wajib diisi.",
  }),
});

exports.verifyResetPasswordSchema = Joi.object({
  token: actionTokenSchema.messages({
    "any.required": "Token reset password wajib disertakan.",
    "string.empty": "Token reset password wajib disertakan.",
  }),
});

exports.resetPasswordSchema = Joi.object({
  token: actionTokenSchema.messages({
    "any.required": "Token reset password wajib disertakan.",
    "string.empty": "Token reset password wajib disertakan.",
  }),
  password: passwordSchema.required().messages({
    "any.required": "Password wajib diisi.",
    "string.empty": "Password wajib diisi.",
  }),
  confirmPassword: Joi.string().valid(Joi.ref("password")).required().messages({
    "any.only": "Konfirmasi password tidak sesuai.",
    "any.required": "Konfirmasi password wajib diisi.",
    "string.empty": "Konfirmasi password wajib diisi.",
  }),
});
