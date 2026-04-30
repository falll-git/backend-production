const express = require("express");

const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const controller = require("./digitalDocumentLoans.controller");
const {
  approveLoanSchema,
  createLoanSchema,
  handoverLoanSchema,
  rejectLoanSchema,
  returnLoanSchema,
} = require("./digitalDocumentLoans.validation");

const router = express.Router();

const LOAN_READ_URLS = [
  "/dashboard/arsip-digital/peminjaman/request",
  "/dashboard/arsip-digital/peminjaman/accept",
  "/dashboard/arsip-digital/peminjaman/laporan",
  "/dashboard/arsip-digital/historis/peminjaman",
];
const LOAN_REQUEST_URL = "/dashboard/arsip-digital/peminjaman/request";
const LOAN_ACTION_URL = "/dashboard/arsip-digital/peminjaman/accept";

router.get("/", auth, authorize(LOAN_READ_URLS, "read"), controller.getAll);
router.post(
  "/",
  auth,
  authorize(LOAN_REQUEST_URL, "create"),
  validate(createLoanSchema),
  controller.create,
);
router.get("/:id", auth, authorize(LOAN_READ_URLS, "read"), controller.getById);
router.patch(
  "/:id/approve",
  auth,
  authorize(LOAN_ACTION_URL, "update"),
  validate(approveLoanSchema),
  controller.approve,
);
router.patch(
  "/:id/reject",
  auth,
  authorize(LOAN_ACTION_URL, "update"),
  validate(rejectLoanSchema),
  controller.reject,
);
router.patch(
  "/:id/handover",
  auth,
  authorize(LOAN_ACTION_URL, "update"),
  validate(handoverLoanSchema),
  controller.handover,
);
router.patch(
  "/:id/return",
  auth,
  authorize(LOAN_ACTION_URL, "update"),
  validate(returnLoanSchema),
  controller.returnLoan,
);

module.exports = router;
