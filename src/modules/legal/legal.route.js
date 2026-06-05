const express = require("express");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const { uploadDomainFile } = require("../../middlewares/domain-upload.middleware");
const {
  normalizePersuratanMultipartBody,
} = require("../../middlewares/persuratan-upload.middleware");
const controller = require("./legal.controller");
const validation = require("./legal.validation");

const router = express.Router();
const PRINT_URLS = [
  "/dashboard/legal/cetak/akad",
  "/dashboard/legal/cetak/haftsheet",
  "/dashboard/legal/cetak/surat-peringatan",
  "/dashboard/legal/cetak/surat-pengantar",
  "/dashboard/legal/cetak/keterangan-lunas",
  "/dashboard/legal/cetak/surat-samsat",
  "/dashboard/legal/cetak/dokumen-lainnya",
];
const DEPOSIT_URLS = [
  "/dashboard/legal/titipan/asuransi",
  "/dashboard/legal/titipan/notaris",
  "/dashboard/legal/titipan/angsuran",
];
const uploadBody = [
  uploadDomainFile("file"),
  normalizePersuratanMultipartBody({
    jsonFields: ["payload_snapshot", "result_summary"],
    numberFields: [
      "version",
      "month",
      "year",
      "coverage_amount",
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

router.get(
  "/templates",
  auth,
  authorize("/dashboard/legal/template-dokumen", "read"),
  controller.listTemplates,
);
router.post(
  "/templates",
  auth,
  authorize("/dashboard/legal/template-dokumen", "create"),
  ...uploadBody,
  validate(validation.templateSchema),
  controller.createTemplate,
);
router.put(
  "/templates/:id",
  auth,
  authorize("/dashboard/legal/template-dokumen", "update"),
  ...uploadBody,
  validate(validation.updateTemplateSchema),
  controller.updateTemplate,
);
router.delete(
  "/templates/:id",
  auth,
  authorize("/dashboard/legal/template-dokumen", "delete"),
  controller.deleteTemplate,
);

router.get(
  "/print-documents/context",
  auth,
  authorize(PRINT_URLS, "read"),
  validate(validation.printDocumentContextQuerySchema, { source: "query" }),
  controller.printDocumentContext,
);
router.get("/print-documents", auth, authorize(PRINT_URLS, "read"), controller.listPrints);
router.post(
  "/print-documents",
  auth,
  authorize(PRINT_URLS, "create"),
  ...uploadBody,
  validate(validation.printDocumentSchema),
  controller.createPrint,
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
  validate(validation.depositTransactionSchema),
  controller.createDepositTransaction,
);

router.get(
  "/reports/summary",
  auth,
  authorize("/dashboard/legal/laporan", "read"),
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
