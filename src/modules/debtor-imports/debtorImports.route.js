const express = require("express");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const {
  uploadDomainFile,
} = require("../../middlewares/domain-upload.middleware");
const {
  uploadSlikImportFiles,
} = require("../../middlewares/slik-import-upload.middleware");
const {
  normalizePersuratanMultipartBody,
} = require("../../middlewares/persuratan-upload.middleware");
const controller = require("./debtorImports.controller");
const {
  idebImportJobSchema,
  importJobSchema,
  resolveIdebSchema,
  slikImportJobSchema,
} = require("./debtorImports.validation");

const router = express.Router();
const READ_URLS = [
  "/dashboard/informasi-debitur/admin/upload-slik",
  "/dashboard/informasi-debitur/admin/monitoring-import",
  "/dashboard/informasi-debitur/admin/upload-ideb",
];

function uploadAndValidate(schema = importJobSchema) {
  return [
    uploadDomainFile("file"),
    normalizePersuratanMultipartBody({
      jsonFields: ["summary"],
      numberFields: ["total_rows"],
    }),
    validate(schema),
  ];
}

function uploadSlikAndValidate() {
  return [
    uploadSlikImportFiles("files", 20),
    normalizePersuratanMultipartBody({}),
    validate(slikImportJobSchema),
  ];
}

router.get("/", auth, authorize(READ_URLS, "read"), controller.getAll);
router.get(
  "/ideb/pending",
  auth,
  authorize("/dashboard/informasi-debitur/admin/monitoring-import", "read"),
  controller.getPendingIdeb,
);
router.get(
  "/ideb/:uploadId/resume-pdf",
  auth,
  authorize(READ_URLS, "read"),
  controller.getIdebResumePdf,
);
router.patch(
  "/ideb/:uploadId/resolve",
  auth,
  authorize("/dashboard/informasi-debitur/admin/upload-ideb", "create"),
  validate(resolveIdebSchema),
  controller.resolveIdeb,
);
router.post(
  "/master",
  auth,
  authorize("/dashboard/informasi-debitur/admin/upload-slik", "create"),
  controller.createDeprecated,
);
router.post(
  "/collectibility",
  auth,
  authorize("/dashboard/informasi-debitur/admin/upload-slik", "create"),
  controller.createDeprecated,
);
router.post(
  "/slik",
  auth,
  authorize("/dashboard/informasi-debitur/admin/upload-slik", "create"),
  ...uploadSlikAndValidate(),
  controller.createSlik,
);
router.post(
  "/ideb",
  auth,
  authorize("/dashboard/informasi-debitur/admin/upload-ideb", "create"),
  ...uploadAndValidate(idebImportJobSchema),
  controller.createIdeb,
);

module.exports = router;
