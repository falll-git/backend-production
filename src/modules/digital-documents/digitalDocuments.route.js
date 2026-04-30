const express = require("express");

const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const {
  uploadDigitalArchiveFile,
} = require("../../middlewares/digital-archive-upload.middleware");
const controller = require("./digitalDocuments.controller");
const {
  createDigitalDocumentSchema,
  updateDigitalDocumentSchema,
} = require("./digitalDocuments.validation");

const router = express.Router();

const DIGITAL_DOCUMENT_READ_URLS = [
  "/dashboard/arsip-digital/input-dokumen",
  "/dashboard/arsip-digital/ruang-arsip/list-dokumen",
  "/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan",
  "/dashboard/arsip-digital/ruang-arsip/jatuh-tempo",
];
const DIGITAL_DOCUMENT_WRITE_URLS = [
  "/dashboard/arsip-digital/input-dokumen",
  "/dashboard/arsip-digital/ruang-arsip/list-dokumen",
];

router.get("/", auth, authorize(DIGITAL_DOCUMENT_READ_URLS, "read"), controller.getAll);
router.post(
  "/",
  auth,
  authorize(DIGITAL_DOCUMENT_WRITE_URLS, "create"),
  uploadDigitalArchiveFile("file"),
  validate(createDigitalDocumentSchema),
  controller.create,
);
router.get("/:id", auth, authorize(DIGITAL_DOCUMENT_READ_URLS, "read"), controller.getById);
router.get(
  "/:id/activity-logs",
  auth,
  authorize(DIGITAL_DOCUMENT_READ_URLS, "read"),
  controller.getActivityLogs,
);
router.put(
  "/:id",
  auth,
  authorize(DIGITAL_DOCUMENT_WRITE_URLS, "update"),
  uploadDigitalArchiveFile("file"),
  validate(updateDigitalDocumentSchema),
  controller.update,
);
router.delete(
  "/:id",
  auth,
  authorize(DIGITAL_DOCUMENT_WRITE_URLS, "delete"),
  controller.delete,
);

module.exports = router;
