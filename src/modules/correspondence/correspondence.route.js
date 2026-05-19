const express = require("express");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const controller = require("./correspondence.controller");
const validation = require("./correspondence.validation");

const router = express.Router();

router.get(
  "/report",
  auth,
  authorize("/dashboard/manajemen-surat/laporan", "read"),
  validate(validation.reportQuerySchema, { source: "query" }),
  controller.getReport,
);
router.get(
  "/print-documents",
  auth,
  authorize("/dashboard/manajemen-surat/cetak-dokumen", "read"),
  validate(validation.printableDocumentsQuerySchema, { source: "query" }),
  controller.getPrintableDocuments,
);

module.exports = router;
