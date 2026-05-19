const express = require("express");

const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const controller = require("./digitalArchives.controller");
const validation = require("./digitalArchives.validation");

const router = express.Router();

const STORAGE_READ_URLS = [
  "/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan",
  "/dashboard/arsip-digital/ruang-arsip/list-dokumen",
];
const STORAGE_HISTORY_URL = "/dashboard/arsip-digital/historis/penyimpanan";
const ACCESS_HISTORY_URL = "/dashboard/arsip-digital/disposisi/historis";
const LOAN_HISTORY_URL = "/dashboard/arsip-digital/historis/peminjaman";
const LOAN_REPORT_URL = "/dashboard/arsip-digital/peminjaman/laporan";
const DIGITAL_ARCHIVE_REPORT_URL = "/dashboard/arsip-digital/laporan";

router.get(
  "/storage/offices",
  auth,
  authorize(STORAGE_READ_URLS, "read"),
  validate(validation.paginationQuerySchema, { source: "query" }),
  controller.getStorageSummary,
);
router.get(
  "/storage/offices/:officeId/cabinets",
  auth,
  authorize(STORAGE_READ_URLS, "read"),
  validate(validation.officeParamsSchema, { source: "params" }),
  controller.getOfficeCabinets,
);
router.get(
  "/storage/cabinets/:cabinetId/racks",
  auth,
  authorize(STORAGE_READ_URLS, "read"),
  validate(validation.cabinetParamsSchema, { source: "params" }),
  controller.getCabinetRacks,
);
router.get(
  "/storage/racks/:rackId/documents",
  auth,
  authorize(STORAGE_READ_URLS, "read"),
  validate(validation.rackParamsSchema, { source: "params" }),
  validate(validation.paginationQuerySchema, { source: "query" }),
  controller.getRackDocuments,
);
router.get(
  "/histories/storage",
  auth,
  authorize(STORAGE_HISTORY_URL, "read"),
  validate(validation.historyQuerySchema, { source: "query" }),
  controller.getStorageHistories,
);
router.get(
  "/histories/access-requests",
  auth,
  authorize(ACCESS_HISTORY_URL, "read"),
  validate(validation.historyQuerySchema, { source: "query" }),
  controller.getAccessRequestHistories,
);
router.get(
  "/histories/loans",
  auth,
  authorize(LOAN_HISTORY_URL, "read"),
  validate(validation.historyQuerySchema, { source: "query" }),
  controller.getLoanHistories,
);
router.get(
  "/reports/summary",
  auth,
  authorize(DIGITAL_ARCHIVE_REPORT_URL, "read"),
  validate(validation.reportQuerySchema, { source: "query" }),
  controller.getReportSummary,
);
router.get(
  "/reports/documents",
  auth,
  authorize(DIGITAL_ARCHIVE_REPORT_URL, "read"),
  validate(validation.reportQuerySchema, { source: "query" }),
  controller.getDocumentReport,
);
router.get(
  "/reports/due-dates",
  auth,
  authorize(DIGITAL_ARCHIVE_REPORT_URL, "read"),
  validate(validation.reportQuerySchema, { source: "query" }),
  controller.getDueDateReport,
);
router.get(
  "/reports/access-requests",
  auth,
  authorize(DIGITAL_ARCHIVE_REPORT_URL, "read"),
  validate(validation.reportQuerySchema, { source: "query" }),
  controller.getAccessRequestReport,
);
router.get(
  "/reports/loans",
  auth,
  authorize([LOAN_REPORT_URL, DIGITAL_ARCHIVE_REPORT_URL], "read"),
  validate(validation.reportQuerySchema, { source: "query" }),
  controller.getLoanReport,
);
module.exports = router;
