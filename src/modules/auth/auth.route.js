const express = require("express");
const router = express.Router();
const controller = require("./auth.controller");
const validate = require("../../middlewares/validate.middleware");
const auth = require("../../middlewares/auth.middleware");
const {
  authRateLimit,
  authRefreshRateLimit,
} = require("../../middlewares/rate-limit.middleware");
const {
  authSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  refreshTokenSchema,
  resetPasswordSchema,
  setPasswordSchema,
  verifyResetPasswordSchema,
  verifySetPasswordSchema,
} = require("./auth.validation");

router.post("/login", authRateLimit, validate(authSchema), controller.login);
router.post(
  "/refresh",
  authRefreshRateLimit,
  validate(refreshTokenSchema),
  controller.refresh,
);
router.post(
  "/forgot-password",
  authRateLimit,
  validate(forgotPasswordSchema),
  controller.forgotPassword,
);
router.post("/logout", controller.logout);
router.post(
  "/change-password",
  auth,
  validate(changePasswordSchema),
  controller.changePassword,
);
router.post(
  "/set-password/verify",
  authRateLimit,
  validate(verifySetPasswordSchema),
  controller.verifySetPasswordToken,
);
router.post(
  "/set-password",
  authRateLimit,
  validate(setPasswordSchema),
  controller.setPassword,
);
router.post(
  "/reset-password/verify",
  authRateLimit,
  validate(verifyResetPasswordSchema),
  controller.verifyResetPasswordToken,
);
router.post(
  "/reset-password",
  authRateLimit,
  validate(resetPasswordSchema),
  controller.resetPassword,
);
module.exports = router;
