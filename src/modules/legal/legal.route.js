const express = require("express");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const { AppError } = require("../../utils/errors");
const {
  uploadDomainFiles,
} = require("../../middlewares/domain-upload.middleware");
const {
  normalizePersuratanMultipartBody,
} = require("../../middlewares/persuratan-upload.middleware");
const controller = require("./legal.controller");
const validation = require("./legal.validation");

const router = express.Router();
const TEMPORARILY_DISABLED_FEATURE_MESSAGE =
  "Fitur legal ini dinonaktifkan sementara.";
const DEPOSIT_URLS = [
  "/dashboard/legal/titipan/asuransi",
  "/dashboard/legal/titipan/notaris",
  "/dashboard/legal/titipan/angsuran",
  "/dashboard/legal/titipan/lainnya",
];
const uploadBody = [
  uploadDomainFiles("files", 20),
  normalizePersuratanMultipartBody({
    jsonFields: ["payload_snapshot", "result_summary", "opening_transaction"],
    numberFields: [
      "version",
      "month",
      "year",
      "coverage_amount",
      "premium_amount",
      "appraisal_value",
      "claim_amount",
      "approved_amount",
      "disbursed_amount",
      "nominal",
      "paid_amount",
      "processed_amount",
      "remaining_amount",
      "amount",
    ],
    booleanFields: ["is_active"],
  }),
];

function blockTemporarily(_req, _res, next) {
  next(new AppError(TEMPORARILY_DISABLED_FEATURE_MESSAGE, 404));
}

router.get(
  "/templates",
  auth,
  blockTemporarily,
);
router.post(
  "/templates",
  auth,
  blockTemporarily,
);
router.put(
  "/templates/:id",
  auth,
  blockTemporarily,
);
router.delete(
  "/templates/:id",
  auth,
  blockTemporarily,
);

router.get(
  "/print-documents/context",
  auth,
  blockTemporarily,
);
router.get("/print-documents", auth, blockTemporarily);
router.post(
  "/print-documents",
  auth,
  blockTemporarily,
);

router.get(
  "/progress/notary",
  auth,
  authorize("/dashboard/legal/progress/notaris", "read"),
  controller.listNotaryProgress,
);
router.post(
  "/progress/notary",
  auth,
  authorize("/dashboard/legal/progress/notaris", "create"),
  ...uploadBody,
  validate(validation.notaryProgressSchema),
  controller.createNotaryProgress,
);
router.put(
  "/progress/notary/:id",
  auth,
  authorize("/dashboard/legal/progress/notaris", "update"),
  ...uploadBody,
  validate(validation.updateNotaryProgressSchema),
  controller.updateNotaryProgress,
);
router.delete(
  "/progress/notary/:id",
  auth,
  authorize("/dashboard/legal/progress/notaris", "delete"),
  controller.deleteNotaryProgress,
);

router.get(
  "/progress/insurance",
  auth,
  authorize("/dashboard/legal/progress/asuransi", "read"),
  controller.listInsuranceProgress,
);
router.post(
  "/progress/insurance",
  auth,
  authorize("/dashboard/legal/progress/asuransi", "create"),
  ...uploadBody,
  validate(validation.insuranceProgressSchema),
  controller.createInsuranceProgress,
);
router.put(
  "/progress/insurance/:id",
  auth,
  authorize("/dashboard/legal/progress/asuransi", "update"),
  ...uploadBody,
  validate(validation.updateInsuranceProgressSchema),
  controller.updateInsuranceProgress,
);
router.delete(
  "/progress/insurance/:id",
  auth,
  authorize("/dashboard/legal/progress/asuransi", "delete"),
  controller.deleteInsuranceProgress,
);

router.get(
  "/progress/kjpp",
  auth,
  authorize("/dashboard/legal/progress/kjpp", "read"),
  controller.listKjppProgress,
);
router.post(
  "/progress/kjpp",
  auth,
  authorize("/dashboard/legal/progress/kjpp", "create"),
  ...uploadBody,
  validate(validation.kjppProgressSchema),
  controller.createKjppProgress,
);
router.put(
  "/progress/kjpp/:id",
  auth,
  authorize("/dashboard/legal/progress/kjpp", "update"),
  ...uploadBody,
  validate(validation.updateKjppProgressSchema),
  controller.updateKjppProgress,
);
router.delete(
  "/progress/kjpp/:id",
  auth,
  authorize("/dashboard/legal/progress/kjpp", "delete"),
  controller.deleteKjppProgress,
);

router.get("/claims", auth, authorize("/dashboard/legal/progress/klaim", "read"), controller.listClaims);
router.post(
  "/claims",
  auth,
  authorize("/dashboard/legal/progress/klaim", "create"),
  ...uploadBody,
  validate(validation.claimSchema),
  controller.createClaim,
);
router.put(
  "/claims/:id",
  auth,
  authorize("/dashboard/legal/progress/klaim", "update"),
  ...uploadBody,
  validate(validation.updateClaimSchema),
  controller.updateClaim,
);
router.delete(
  "/claims/:id",
  auth,
  authorize("/dashboard/legal/progress/klaim", "delete"),
  controller.deleteClaim,
);

router.get("/deposits", auth, authorize(DEPOSIT_URLS, "read"), controller.listDeposits);
router.post(
  "/deposits",
  auth,
  authorize(DEPOSIT_URLS, "create"),
  ...uploadBody,
  validate(validation.depositSchema),
  controller.createDeposit,
);
router.put(
  "/deposits/:id",
  auth,
  authorize(DEPOSIT_URLS, "update"),
  validate(validation.updateDepositSchema),
  controller.updateDeposit,
);
router.delete(
  "/deposits/:id",
  auth,
  authorize(DEPOSIT_URLS, "delete"),
  controller.deleteDeposit,
);

router.get(
  "/deposit-transactions",
  auth,
  authorize(DEPOSIT_URLS, "read"),
  controller.listDepositTransactions,
);
router.post(
  "/deposit-transactions",
  auth,
  authorize(DEPOSIT_URLS, "create"),
  ...uploadBody,
  validate(validation.depositTransactionSchema),
  controller.createDepositTransaction,
);

router.get(
  "/reports/summary",
  auth,
  authorize("/dashboard/legal", "read"),
  controller.summaryReport,
);
router.get(
  "/reports/third-party-documents",
  auth,
  authorize("/dashboard/legal/laporan/pihak-ketiga/dokumen", "read"),
  controller.thirdPartyDocumentsReport,
);
router.get(
  "/reports/third-party-deposit-funds",
  auth,
  authorize("/dashboard/legal/laporan/pihak-ketiga/dana-titipan", "read"),
  controller.thirdPartyDepositFundsReport,
);

module.exports = router;
