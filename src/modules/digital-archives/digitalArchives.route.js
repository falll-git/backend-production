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
const OVERDUE_URL = "/dashboard/arsip-digital/ruang-arsip/jatuh-tempo";

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
  "/reports/loans",
  auth,
  authorize(LOAN_REPORT_URL, "read"),
  controller.getLoanReport,
);
router.get(
  "/reports/overdue",
  auth,
  authorize(OVERDUE_URL, "read"),
  controller.getOverdueLoans,
);

module.exports = router;
