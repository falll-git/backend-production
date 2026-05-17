const express = require("express");
const router = express.Router();
const controller = require("./storageUsage.controller");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");

const STORAGE_USAGE_MENU_URL = "/dashboard/storage-usage";

router.get(
  "/summary",
  auth,
  authorize(STORAGE_USAGE_MENU_URL, "read"),
  controller.getSummary,
);

module.exports = router;
