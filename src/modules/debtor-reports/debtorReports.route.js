const express = require("express");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const { REPORT_ALL_FEATURE } = require("../../utils/menu-access");
const controller = require("./debtorReports.controller");

const router = express.Router();

router.get(
  "/summary",
  auth,
  authorize("/dashboard/informasi-debitur/laporan", "read", {
    feature: REPORT_ALL_FEATURE,
  }),
  controller.summary,
);
router.get(
  "/npf",
  auth,
  authorize("/dashboard/informasi-debitur/laporan/npf", "read", {
    feature: REPORT_ALL_FEATURE,
  }),
  controller.npf,
);
router.get(
  "/marketing-activity",
  auth,
  authorize("/dashboard/informasi-debitur/laporan/aktivitas-marketing", "read", {
    feature: REPORT_ALL_FEATURE,
  }),
  controller.marketingActivity,
);

module.exports = router;
