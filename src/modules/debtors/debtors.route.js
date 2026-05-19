const express = require("express");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const { uploadDomainFile } = require("../../middlewares/domain-upload.middleware");
const {
  normalizePersuratanMultipartBody,
} = require("../../middlewares/persuratan-upload.middleware");
const controller = require("./debtors.controller");
const {
  createDebtorDocumentSchema,
  createDebtorSchema,
  updateDebtorSchema,
} = require("./debtors.validation");
const {
  createDebtorContractSchema,
} = require("../debtor-contracts/debtorContracts.validation");
const { DEBTOR_MENU_URLS, LEGAL_MENU_URLS } = require("../../utils/menu-access");

const router = express.Router();
const READ_URLS = [...DEBTOR_MENU_URLS, ...LEGAL_MENU_URLS];
const WRITE_URL = "/dashboard/informasi-debitur/master-debitur";

router.get("/", auth, authorize(READ_URLS, "read"), controller.getAll);
router.post("/", auth, authorize(WRITE_URL, "create"), validate(createDebtorSchema), controller.create);
router.get("/:id/workflow", auth, authorize(READ_URLS, "read"), controller.getWorkflow);
router.get("/:id/contracts", auth, authorize(READ_URLS, "read"), controller.getContracts);
router.post(
  "/:id/contracts",
  auth,
  authorize(WRITE_URL, "create"),
  validate(createDebtorContractSchema.fork(["debtor_id"], (schema) => schema.optional())),
  controller.createContract,
);
router.get("/:id/documents", auth, authorize(READ_URLS, "read"), controller.getDocuments);
router.post(
  "/:id/documents",
  auth,
  authorize(WRITE_URL, "create"),
  uploadDomainFile("file"),
  normalizePersuratanMultipartBody({}),
  validate(createDebtorDocumentSchema),
  controller.createDocument,
);
router.get("/:id", auth, authorize(READ_URLS, "read"), controller.getById);
router.put("/:id", auth, authorize(WRITE_URL, "update"), validate(updateDebtorSchema), controller.update);
router.delete("/:id", auth, authorize(WRITE_URL, "delete"), controller.delete);

module.exports = router;
