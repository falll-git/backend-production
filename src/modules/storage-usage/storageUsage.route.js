const express = require("express");
const router = express.Router();
const controller = require("./storageUsage.controller");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const validation = require("./storageUsage.validation");

const STORAGE_USAGE_MENU_URL = "/dashboard/storage-usage";

router.get(
  "/summary",
  auth,
  authorize(STORAGE_USAGE_MENU_URL, "read"),
  validate(validation.summaryQuerySchema, { source: "query" }),
  controller.getSummary,
);

module.exports = router;
