const express = require("express");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const controller = require("./debtorReports.controller");
const validation = require("./debtorReports.validation");

const router = express.Router();
const REPORT_URL = "/dashboard/informasi-debitur/laporan";
const NPF_REPORT_URL = "/dashboard/informasi-debitur/laporan/npf";
const MARKETING_REPORT_URL =
  "/dashboard/informasi-debitur/laporan/aktivitas-marketing";

router.get(
  "/summary",
  auth,
  authorize(REPORT_URL, "read"),
  validate(validation.summaryQuerySchema, { source: "query" }),
  controller.summary,
);
router.get(
  "/portfolio",
  auth,
  authorize(REPORT_URL, "read"),
  validate(validation.reportQuerySchema, { source: "query" }),
  controller.portfolio,
);
router.get(
  "/facilities",
  auth,
  authorize(REPORT_URL, "read"),
  validate(validation.reportQuerySchema, { source: "query" }),
  controller.facilities,
);
router.get(
  "/collaterals",
  auth,
  authorize(REPORT_URL, "read"),
  validate(validation.collateralReportQuerySchema, { source: "query" }),
  controller.collaterals,
);
router.get(
  "/completeness",
  auth,
  authorize(REPORT_URL, "read"),
  validate(validation.completenessReportQuerySchema, { source: "query" }),
  controller.completeness,
);
router.get(
  "/npf",
  auth,
  authorize([NPF_REPORT_URL, REPORT_URL], "read"),
  validate(validation.npfQuerySchema, { source: "query" }),
  controller.npf,
);
router.get(
  "/marketing-activity",
  auth,
  authorize(MARKETING_REPORT_URL, "read"),
  validate(validation.marketingActivityQuerySchema, { source: "query" }),
  controller.marketingActivity,
);

module.exports = router;
