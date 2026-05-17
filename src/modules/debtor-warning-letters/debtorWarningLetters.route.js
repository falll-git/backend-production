const express = require("express");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const { uploadDomainFile } = require("../../middlewares/domain-upload.middleware");
const {
  normalizePersuratanMultipartBody,
} = require("../../middlewares/persuratan-upload.middleware");
const controller = require("./debtorWarningLetters.controller");
const {
  createWarningLetterSchema,
  updateWarningLetterSchema,
} = require("./debtorWarningLetters.validation");

const router = express.Router();
const MENU_URL = "/dashboard/informasi-debitur/marketing/langkah-penanganan";
const uploadBody = [uploadDomainFile("file"), normalizePersuratanMultipartBody({})];

router.get("/", auth, authorize(MENU_URL, "read"), controller.getAll);
router.post("/", auth, authorize(MENU_URL, "create"), ...uploadBody, validate(createWarningLetterSchema), controller.create);
router.get("/:id", auth, authorize(MENU_URL, "read"), controller.getById);
router.put("/:id", auth, authorize(MENU_URL, "update"), ...uploadBody, validate(updateWarningLetterSchema), controller.update);
router.delete("/:id", auth, authorize(MENU_URL, "delete"), controller.delete);

module.exports = router;
