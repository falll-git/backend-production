const express = require("express");
const router = express.Router();
const controller = require("./watermarkSettings.controller");
const validate = require("../../middlewares/validate.middleware");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const {
  uploadWatermarkImage,
} = require("../../middlewares/watermark-upload.middleware");
const {
  updateWatermarkSettingsSchema,
} = require("./watermarkSettings.validation");

const WATERMARK_SETTINGS_MENU_URL = "/dashboard/parameter/watermark-dokumen";

router.get(
  "/",
  auth,
  authorize(WATERMARK_SETTINGS_MENU_URL, "read"),
  controller.getSettings,
);
router.get(
  "/options",
  auth,
  authorize(WATERMARK_SETTINGS_MENU_URL, "read"),
  controller.getOptions,
);
router.put(
  "/",
  auth,
  authorize(WATERMARK_SETTINGS_MENU_URL, "update"),
  validate(updateWatermarkSettingsSchema),
  controller.updateSettings,
);
router.post(
  "/image",
  auth,
  authorize(WATERMARK_SETTINGS_MENU_URL, "update"),
  uploadWatermarkImage("image"),
  controller.updateImage,
);
router.delete(
  "/image",
  auth,
  authorize(WATERMARK_SETTINGS_MENU_URL, "update"),
  controller.deleteImage,
);
router.post(
  "/apply",
  auth,
  authorize(WATERMARK_SETTINGS_MENU_URL, "update"),
  controller.applyExistingFiles,
);
router.get(
  "/summary",
  auth,
  authorize(WATERMARK_SETTINGS_MENU_URL, "read"),
  controller.getQueueSummary,
);
module.exports = router;
