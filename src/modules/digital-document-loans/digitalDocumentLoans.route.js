const express = require("express");

const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const controller = require("./digitalDocumentLoans.controller");
const {
  APPROVE_FEATURE,
  HANDOVER_FEATURE,
  REJECT_FEATURE,
  RETURN_FEATURE,
} = require("../../utils/menu-access");
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
  "/dashboard/arsip-digital/laporan",
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
  authorize(LOAN_ACTION_URL, "update", { feature: APPROVE_FEATURE }),
  validate(approveLoanSchema),
  controller.approve,
);
router.patch(
  "/:id/reject",
  auth,
  authorize(LOAN_ACTION_URL, "update", { feature: REJECT_FEATURE }),
  validate(rejectLoanSchema),
  controller.reject,
);
router.patch(
  "/:id/handover",
  auth,
  authorize(LOAN_ACTION_URL, "update", { feature: HANDOVER_FEATURE }),
  validate(handoverLoanSchema),
  controller.handover,
);
router.patch(
  "/:id/return",
  auth,
  authorize(LOAN_ACTION_URL, "update", { feature: RETURN_FEATURE }),
  validate(returnLoanSchema),
  controller.returnLoan,
);

module.exports = router;
