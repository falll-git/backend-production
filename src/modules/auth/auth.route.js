const express = require("express");
const router = express.Router();
const controller = require("./auth.controller");
const validate = require("../../middlewares/validate.middleware");
const auth = require("../../middlewares/auth.middleware");
const {
  authIpRateLimit,
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

const publicAuthRateLimits = [authIpRateLimit, authRateLimit];

router.post(
  "/login",
  ...publicAuthRateLimits,
  validate(authSchema),
  controller.login,
);
router.post(
  "/refresh",
  authRefreshRateLimit,
  validate(refreshTokenSchema),
  controller.refresh,
);
router.post(
  "/forgot-password",
  ...publicAuthRateLimits,
  validate(forgotPasswordSchema),
  controller.forgotPassword,
);
router.post("/logout", controller.logout);
router.post(
  "/change-password",
  auth,
  authRateLimit,
  validate(changePasswordSchema),
  controller.changePassword,
);
router.post(
  "/set-password/verify",
  ...publicAuthRateLimits,
  validate(verifySetPasswordSchema),
  controller.verifySetPasswordToken,
);
router.post(
  "/set-password",
  ...publicAuthRateLimits,
  validate(setPasswordSchema),
  controller.setPassword,
);
router.post(
  "/reset-password/verify",
  ...publicAuthRateLimits,
  validate(verifyResetPasswordSchema),
  controller.verifyResetPasswordToken,
);
router.post(
  "/reset-password",
  ...publicAuthRateLimits,
  validate(resetPasswordSchema),
  controller.resetPassword,
);
module.exports = router;
