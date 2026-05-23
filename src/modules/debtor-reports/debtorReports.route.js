const express = require("express");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const controller = require("./debtorReports.controller");
const validation = require("./debtorReports.validation");

const router = express.Router();

router.get(
  "/summary",
  auth,
  authorize("/dashboard/informasi-debitur/laporan", "read"),
  validate(validation.summaryQuerySchema, { source: "query" }),
  controller.summary,
);
router.get(
  "/npf",
  auth,
  authorize("/dashboard/informasi-debitur/laporan/npf", "read"),
  validate(validation.npfQuerySchema, { source: "query" }),
  controller.npf,
);
router.get(
  "/marketing-activity",
  auth,
  authorize("/dashboard/informasi-debitur/laporan/aktivitas-marketing", "read"),
  validate(validation.marketingActivityQuerySchema, { source: "query" }),
  controller.marketingActivity,
);

module.exports = router;
