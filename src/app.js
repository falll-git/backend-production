const { loadEnv } = require("./config/env");
loadEnv();

const express = require("express");
const cors = require("cors");
const requestId = require("./middlewares/request-id.middleware");
const securityHeaders = require("./middlewares/security-headers.middleware");
const authRoutes = require("./modules/auth/auth.route");
const roleRoutes = require("./modules/role/role.route");
const divisionRoutes = require("./modules/division/division.route");
const letterPriorityRoutes = require("./modules/letter-priority/letterPriority.route");
const documentTypeRoutes = require("./modules/document-type/documentType.route");
const storageRoutes = require("./modules/storage/storage.route");
const userRoutes = require("./modules/user/user.route");
const incomingMails = require("./modules/incoming-mail/incomingMail.route");
const menuRoutes = require("./modules/menus/menus.route");
const roleMenuRoutes = require("./modules/role-menus/roleMenus.route");
const digitalDocumentRoutes = require("./modules/digital-documents/digitalDocuments.route");
const digitalDocumentAccessRequestRoutes = require("./modules/digital-document-access-requests/digitalDocumentAccessRequests.route");
const digitalDocumentLoanRoutes = require("./modules/digital-document-loans/digitalDocumentLoans.route");
const digitalArchiveRoutes = require("./modules/digital-archives/digitalArchives.route");
const outgoingMailRoutes = require("./modules/outgoing-mails/outgoingMails.route");
const memorandumRoutes = require("./modules/memorandum/memorandum.route");
const correspondenceRoutes = require("./modules/correspondence/correspondence.route");
const watermarkSettingsRoutes = require("./modules/watermark-settings/watermarkSettings.route");
const storageUsageRoutes = require("./modules/storage-usage/storageUsage.route");
const branchRoutes = require("./modules/branches/branches.route");
const financingProductRoutes = require("./modules/financing-products/financingProducts.route");
const collectibilityLevelRoutes = require("./modules/collectibility-levels/collectibilityLevels.route");
const contractTypeRoutes = require("./modules/contract-types/contractTypes.route");
const thirdPartyRoutes = require("./modules/third-parties/thirdParties.route");
const documentChecklistRoutes = require("./modules/document-checklists/documentChecklists.route");
const numberingTemplateRoutes = require("./modules/numbering-templates/numberingTemplates.route");
const depositTypeRoutes = require("./modules/deposit-types/depositTypes.route");
const mailDeliveryMediaRoutes = require("./modules/mail-delivery-media/mailDeliveryMedia.route");
const collateralTypeRoutes = require("./modules/collateral-types/collateralTypes.route");
const restructuringTypeRoutes = require("./modules/restructuring-types/restructuringTypes.route");
const legalProcessTypeRoutes = require("./modules/legal-process-types/legalProcessTypes.route");
const debtorRoutes = require("./modules/debtors/debtors.route");
const debtorContractRoutes = require("./modules/debtor-contracts/debtorContracts.route");
const debtorImportRoutes = require("./modules/debtor-imports/debtorImports.route");
const debtorMarketingRoutes = require("./modules/debtor-marketing/debtorMarketing.route");
const debtorWarningLetterRoutes = require("./modules/debtor-warning-letters/debtorWarningLetters.route");
const debtorReportRoutes = require("./modules/debtor-reports/debtorReports.route");
const legalRoutes = require("./modules/legal/legal.route");
const notificationRoutes = require("./modules/notifications/notifications.route");
const secureFileAccess = require("./middlewares/secure-file-access.middleware");
const { PUBLIC_PREFIX, STORAGE_ROOT } = require("./utils/persuratan-files");
const {
  PUBLIC_PREFIX: DIGITAL_ARCHIVE_PUBLIC_PREFIX,
  STORAGE_ROOT: DIGITAL_ARCHIVE_STORAGE_ROOT,
} = require("./utils/digital-archive-files");
const {
  PUBLIC_PREFIX: WATERMARK_PUBLIC_PREFIX,
  STORAGE_ROOT: WATERMARK_STORAGE_ROOT,
} = require("./utils/watermark-files");
const {
  PUBLIC_PREFIX: WATERMARKED_PUBLIC_PREFIX,
  STORAGE_ROOT: WATERMARKED_STORAGE_ROOT,
} = require("./utils/watermarked-files");

function parseCorsOrigins() {
  const raw = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getBodyLimit(key, fallback) {
  const value = process.env[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

const app = express();
app.set("trust proxy", 1);
app.use(securityHeaders);
app.use(requestId);

const allowedCorsOrigins = parseCorsOrigins();
app.use(
  cors(
    allowedCorsOrigins.length > 0
      ? {
          origin(origin, callback) {
            if (!origin || allowedCorsOrigins.includes(origin)) {
              return callback(null, true);
            }

            const error = new Error("CORS origin not allowed");
            error.statusCode = 403;
            return callback(error);
          },
          credentials: true,
        }
      : undefined,
  ),
);
app.use(express.json({ limit: getBodyLimit("JSON_BODY_LIMIT", "1mb") }));
app.use(
  express.urlencoded({
    extended: true,
    limit: getBodyLimit("URLENCODED_BODY_LIMIT", "1mb"),
  }),
);

const staticStorageMounts = [
  {
    publicPrefix: PUBLIC_PREFIX,
    storageRoot: STORAGE_ROOT,
    secure: true,
  },
  {
    publicPrefix: DIGITAL_ARCHIVE_PUBLIC_PREFIX,
    storageRoot: DIGITAL_ARCHIVE_STORAGE_ROOT,
    secure: true,
  },
  {
    publicPrefix: WATERMARK_PUBLIC_PREFIX,
    storageRoot: WATERMARK_STORAGE_ROOT,
    secure: false,
  },
  {
    publicPrefix: WATERMARKED_PUBLIC_PREFIX,
    storageRoot: WATERMARKED_STORAGE_ROOT,
    secure: true,
  },
];

for (const mount of staticStorageMounts) {
  const middlewares = mount.secure
    ? [secureFileAccess(mount.publicPrefix), express.static(mount.storageRoot)]
    : [express.static(mount.storageRoot)];

  app.use(mount.publicPrefix, ...middlewares);
}

app.get("/api/", function (req, res) {
  res.json({
    status: true,
    message: "Ruang Arsip API aktif.",
    data: {
      service: "Ruang Arsip API",
      version: 1,
    },
  });
});
function healthCheck(req, res) {
  res.json({
    status: true,
    message: "OK",
    uptime: process.uptime(),
  });
}

app.get("/health", healthCheck);
app.get("/api/health", healthCheck);
app.use("/api/auth", authRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/divisions", divisionRoutes);
app.use("/api/letter-priorities", letterPriorityRoutes);
app.use("/api/document-types", documentTypeRoutes);
app.use("/api/storages", storageRoutes);
app.use("/api/users", userRoutes);
app.use("/api/incoming-mails", incomingMails);
app.use("/api/menus", menuRoutes);
app.use("/api/role-menus", roleMenuRoutes);
app.use("/api/digital-documents", digitalDocumentRoutes);
app.use(
  "/api/digital-document-access-requests",
  digitalDocumentAccessRequestRoutes,
);
app.use("/api/digital-document-loans", digitalDocumentLoanRoutes);
app.use("/api/digital-archives", digitalArchiveRoutes);
app.use("/api/outgoing-mails", outgoingMailRoutes);
app.use("/api/memorandums", memorandumRoutes);
app.use("/api/correspondence", correspondenceRoutes);
app.use("/api/watermark-settings", watermarkSettingsRoutes);
app.use("/api/storage-usage", storageUsageRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/financing-products", financingProductRoutes);
app.use("/api/collectibility-levels", collectibilityLevelRoutes);
app.use("/api/contract-types", contractTypeRoutes);
app.use("/api/third-parties", thirdPartyRoutes);
app.use("/api/document-checklists", documentChecklistRoutes);
app.use("/api/numbering-templates", numberingTemplateRoutes);
app.use("/api/deposit-types", depositTypeRoutes);
app.use("/api/mail-delivery-media", mailDeliveryMediaRoutes);
app.use("/api/collateral-types", collateralTypeRoutes);
app.use("/api/restructuring-types", restructuringTypeRoutes);
app.use("/api/legal-process-types", legalProcessTypeRoutes);
app.use("/api/debtors", debtorRoutes);
app.use("/api/debtor-contracts", debtorContractRoutes);
app.use("/api/debtor-imports", debtorImportRoutes);
app.use("/api/debtor-marketing", debtorMarketingRoutes);
app.use("/api/debtor-warning-letters", debtorWarningLetterRoutes);
app.use("/api/debtor-reports", debtorReportRoutes);
app.use("/api/legal", legalRoutes);
app.use("/api/notifications", notificationRoutes);

app.use((req, res) => {
  res.status(404).json({
    status: false,
    message: "Route not found",
  });
});

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;
  const requestId = req.requestId || null;

  if (statusCode >= 500) {
    console.error("Unhandled request error:", {
      requestId,
      method: req.method,
      path: req.originalUrl,
      error: err,
    });
  }

  res.status(statusCode).json({
    status: false,
    request_id: requestId,
    message: statusCode >= 500
      ? "Internal server error"
      : err.message || "Internal server error",
  });
});

module.exports = app;
