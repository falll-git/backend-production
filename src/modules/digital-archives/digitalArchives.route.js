const express = require("express");

const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const controller = require("./digitalArchives.controller");

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
  controller.getStorageSummary,
);
router.get(
  "/storage/offices/:officeId/cabinets",
  auth,
  authorize(STORAGE_READ_URLS, "read"),
  controller.getOfficeCabinets,
);
router.get(
  "/storage/cabinets/:cabinetId/racks",
  auth,
  authorize(STORAGE_READ_URLS, "read"),
  controller.getCabinetRacks,
);
router.get(
  "/storage/racks/:rackId/documents",
  auth,
  authorize(STORAGE_READ_URLS, "read"),
  controller.getRackDocuments,
);
router.get(
  "/histories/storage",
  auth,
  authorize(STORAGE_HISTORY_URL, "read"),
  controller.getStorageHistories,
);
router.get(
  "/histories/access-requests",
  auth,
  authorize(ACCESS_HISTORY_URL, "read"),
  controller.getAccessRequestHistories,
);
router.get(
  "/histories/loans",
  auth,
  authorize(LOAN_HISTORY_URL, "read"),
  controller.getLoanHistories,
);
router.get(
  "/reports/summary",
  auth,
  authorize(DIGITAL_ARCHIVE_REPORT_URL, "read"),
  controller.getReportSummary,
);
router.get(
  "/reports/documents",
  auth,
  authorize(DIGITAL_ARCHIVE_REPORT_URL, "read"),
  controller.getDocumentReport,
);
router.get(
  "/reports/due-dates",
  auth,
  authorize(DIGITAL_ARCHIVE_REPORT_URL, "read"),
  controller.getDueDateReport,
);
router.get(
  "/reports/access-requests",
  auth,
  authorize(DIGITAL_ARCHIVE_REPORT_URL, "read"),
  controller.getAccessRequestReport,
);
router.get(
  "/reports/loans",
  auth,
  authorize([LOAN_REPORT_URL, DIGITAL_ARCHIVE_REPORT_URL], "read"),
  controller.getLoanReport,
);
module.exports = router;
