const express = require("express");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const controller = require("./debtorContracts.controller");
const {
  createDebtorContractSchema,
  updateDebtorContractSchema,
} = require("./debtorContracts.validation");

const router = express.Router();
const READ_URLS = [
  "/dashboard/informasi-debitur",
  "/dashboard/informasi-debitur/master-debitur",
  "/dashboard/informasi-debitur/laporan",
  "/dashboard/informasi-debitur/laporan/npf",
  "/dashboard/legal/laporan",
];
const WRITE_URL = "/dashboard/informasi-debitur/master-debitur";

router.get("/", auth, authorize(READ_URLS, "read"), controller.getAll);
router.post("/", auth, authorize(WRITE_URL, "create"), validate(createDebtorContractSchema), controller.create);
router.get("/:id", auth, authorize(READ_URLS, "read"), controller.getById);
router.put("/:id", auth, authorize(WRITE_URL, "update"), validate(updateDebtorContractSchema), controller.update);
router.delete("/:id", auth, authorize(WRITE_URL, "delete"), controller.delete);

module.exports = router;
