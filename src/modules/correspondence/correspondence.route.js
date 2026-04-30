const express = require("express");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const controller = require("./correspondence.controller");

const router = express.Router();

router.get(
  "/report",
  auth,
  authorize("/dashboard/manajemen-surat/laporan", "read"),
  controller.getReport,
);
router.get(
  "/print-documents",
  auth,
  authorize("/dashboard/manajemen-surat/cetak-dokumen", "read"),
  controller.getPrintableDocuments,
);

module.exports = router;
