const Joi = require("joi");

const passwordSchema = Joi.string()
  .min(8)
  .max(128)
  .pattern(/^(?=.*[A-Za-z])(?=.*\d).+$/)
  .messages({
    "string.min": "Password minimal 8 karakter.",
    "string.max": "Password maksimal 128 karakter.",
    "string.pattern.base": "Password wajib mengandung huruf dan angka.",
  });

exports.authSchema = Joi.object({
  username: Joi.string().trim().required().messages({
    "any.required": "Username wajib diisi.",
    "string.empty": "Username wajib diisi.",
  }),
  password: Joi.string().required().messages({
    "any.required": "Password wajib diisi.",
    "string.empty": "Password wajib diisi.",
  }),
  remember: Joi.boolean().optional(),
});

exports.refreshTokenSchema = Joi.object({
  remember: Joi.boolean().optional(),
});

exports.changePasswordSchema = Joi.object({
  oldPassword: Joi.string().required().messages({
    "any.required": "Password saat ini wajib diisi.",
    "string.empty": "Password saat ini wajib diisi.",
  }),
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
