const express = require("express");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const { uploadDomainFile } = require("../../middlewares/domain-upload.middleware");
const {
  normalizePersuratanMultipartBody,
} = require("../../middlewares/persuratan-upload.middleware");
const controller = require("./debtorImports.controller");
const { importJobSchema } = require("./debtorImports.validation");

const router = express.Router();
const READ_URLS = [
  "/dashboard/informasi-debitur/admin/import-debitur",
  "/dashboard/informasi-debitur/admin/import-kolektibilitas",
  "/dashboard/informasi-debitur/admin/upload-slik",
  "/dashboard/informasi-debitur/admin/upload-restrik",
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

router.get("/", auth, authorize(READ_URLS, "read"), controller.getAll);
router.post(
  "/master",
  auth,
  authorize("/dashboard/informasi-debitur/admin/import-debitur", "create"),
  ...uploadAndValidate(),
  controller.createMaster,
);
router.post(
  "/collectibility",
  auth,
  authorize("/dashboard/informasi-debitur/admin/import-kolektibilitas", "create"),
  ...uploadAndValidate(),
  controller.createCollectibility,
);
router.post(
  "/slik",
  auth,
  authorize("/dashboard/informasi-debitur/admin/upload-slik", "create"),
  ...uploadAndValidate(),
  controller.createSlik,
);
router.post(
  "/restrik",
  auth,
  authorize("/dashboard/informasi-debitur/admin/upload-restrik", "create"),
  ...uploadAndValidate(),
  controller.createRestrik,
);

module.exports = router;
