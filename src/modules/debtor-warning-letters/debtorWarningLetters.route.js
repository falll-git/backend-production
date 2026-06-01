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
const READ_MENU_URLS = [
  "/dashboard/informasi-debitur",
  "/dashboard/informasi-debitur/master-debitur",
];
const MANAGE_MENU_URL = "/dashboard/informasi-debitur/master-debitur";
const uploadBody = [uploadDomainFile("file"), normalizePersuratanMultipartBody({})];

router.get("/", auth, authorize(READ_MENU_URLS, "read"), controller.getAll);
router.post("/", auth, authorize(MANAGE_MENU_URL, "create"), ...uploadBody, validate(createWarningLetterSchema), controller.create);
router.get("/:id", auth, authorize(READ_MENU_URLS, "read"), controller.getById);
router.put("/:id", auth, authorize(MANAGE_MENU_URL, "update"), ...uploadBody, validate(updateWarningLetterSchema), controller.update);
router.delete("/:id", auth, authorize(MANAGE_MENU_URL, "delete"), controller.delete);

module.exports = router;
