const express = require("express");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const { uploadDomainFile } = require("../../middlewares/domain-upload.middleware");
const {
  normalizePersuratanMultipartBody,
} = require("../../middlewares/persuratan-upload.middleware");
const controller = require("./debtorMarketing.controller");
const {
  createMarketingActivitySchema,
  updateMarketingActivitySchema,
} = require("./debtorMarketing.validation");

const router = express.Router();
const MENU_BY_KIND = {
  "action-plans": "/dashboard/informasi-debitur/marketing/action-plan",
  "visit-results": "/dashboard/informasi-debitur/marketing/hasil-kunjungan",
  "handling-steps": "/dashboard/informasi-debitur/marketing/langkah-penanganan",
};

function authorizeKind(capability) {
  return (req, res, next) => {
    const menuUrl = MENU_BY_KIND[req.params.kind];
    if (!menuUrl) {
      return res.status(404).json({ status: false, message: "Route tidak ditemukan." });
    }
    return authorize(menuUrl, capability)(req, res, next);
  };
}

const uploadBody = [
  uploadDomainFile("file"),
  normalizePersuratanMultipartBody({}),
];

router.get("/:kind", auth, authorizeKind("read"), controller.getAll);
router.post(
  "/:kind",
  auth,
  authorizeKind("create"),
  ...uploadBody,
  validate(createMarketingActivitySchema),
  controller.create,
);
router.get("/:kind/:id", auth, authorizeKind("read"), controller.getById);
router.put(
  "/:kind/:id",
  auth,
  authorizeKind("update"),
  ...uploadBody,
  validate(updateMarketingActivitySchema),
  controller.update,
);
router.delete("/:kind/:id", auth, authorizeKind("delete"), controller.delete);

module.exports = router;
