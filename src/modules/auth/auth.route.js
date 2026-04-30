const express = require("express");
const router = express.Router();
const controller = require("./auth.controller");
const validate = require("../../middlewares/validate.middleware");
const auth = require("../../middlewares/auth.middleware");
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

router.post("/login", validate(authSchema), controller.login);
router.post("/refresh", validate(refreshTokenSchema), controller.refresh);
router.post(
  "/forgot-password",
  validate(forgotPasswordSchema),
  controller.forgotPassword,
);
router.post("/logout", auth, controller.logout);
router.post(
  "/change-password",
  auth,
  validate(changePasswordSchema),
  controller.changePassword,
);
router.post(
  "/set-password/verify",
  validate(verifySetPasswordSchema),
  controller.verifySetPasswordToken,
);
router.post(
  "/set-password",
  validate(setPasswordSchema),
  controller.setPassword,
);
router.post(
  "/reset-password/verify",
  validate(verifyResetPasswordSchema),
  controller.verifyResetPasswordToken,
);
router.post(
  "/reset-password",
  validate(resetPasswordSchema),
  controller.resetPassword,
);
module.exports = router;
