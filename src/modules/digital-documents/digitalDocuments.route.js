const express = require("express");

const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const {
  uploadDigitalArchiveFile,
} = require("../../middlewares/digital-archive-upload.middleware");
const {
  normalizePersuratanMultipartBody,
} = require("../../middlewares/persuratan-upload.middleware");
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
  "/dashboard/arsip-digital/peminjaman/request",
  "/dashboard/arsip-digital/laporan",
];
const DIGITAL_DOCUMENT_WRITE_URLS = [
  "/dashboard/arsip-digital/input-dokumen",
];
const DIGITAL_DOCUMENT_UPDATE_URLS = [
  "/dashboard/arsip-digital/ruang-arsip/list-dokumen",
];
const DIGITAL_DOCUMENT_REQUESTABLE_URL =
  "/dashboard/arsip-digital/disposisi/pengajuan";

router.get("/", auth, authorize(DIGITAL_DOCUMENT_READ_URLS, "read"), controller.getAll);
router.get(
  "/requestable",
  auth,
  authorize(DIGITAL_DOCUMENT_REQUESTABLE_URL, "read"),
  controller.getRequestable,
);
router.post(
  "/",
  auth,
  authorize(DIGITAL_DOCUMENT_WRITE_URLS, "create"),
  uploadDigitalArchiveFile("file"),
  normalizePersuratanMultipartBody({
    jsonFields: ["related_user_ids", "debtor"],
    booleanFields: ["is_restricted"],
  }),
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
  authorize(DIGITAL_DOCUMENT_UPDATE_URLS, "update"),
  uploadDigitalArchiveFile("file"),
  normalizePersuratanMultipartBody({
    jsonFields: ["related_user_ids", "debtor"],
    booleanFields: ["is_restricted"],
  }),
  validate(updateDigitalDocumentSchema),
  controller.update,
);
router.delete(
  "/:id",
  auth,
  authorize(DIGITAL_DOCUMENT_UPDATE_URLS, "delete"),
  controller.delete,
);

module.exports = router;
