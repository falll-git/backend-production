const authRoutes = require("../modules/auth/auth.route");
const roleRoutes = require("../modules/role/role.route");
const divisionRoutes = require("../modules/division/division.route");
const letterPriorityRoutes = require("../modules/letter-priority/letterPriority.route");
const documentTypeRoutes = require("../modules/document-type/documentType.route");
const storageRoutes = require("../modules/storage/storage.route");
const userRoutes = require("../modules/user/user.route");
const incomingMailRoutes = require("../modules/incoming-mail/incomingMail.route");
const menuRoutes = require("../modules/menus/menus.route");
const roleMenuRoutes = require("../modules/role-menus/roleMenus.route");
const digitalDocumentRoutes = require("../modules/digital-documents/digitalDocuments.route");
const digitalDocumentAccessRequestRoutes = require("../modules/digital-document-access-requests/digitalDocumentAccessRequests.route");
const digitalDocumentLoanRoutes = require("../modules/digital-document-loans/digitalDocumentLoans.route");
const digitalArchiveRoutes = require("../modules/digital-archives/digitalArchives.route");
const outgoingMailRoutes = require("../modules/outgoing-mails/outgoingMails.route");
const memorandumRoutes = require("../modules/memorandum/memorandum.route");
const correspondenceRoutes = require("../modules/correspondence/correspondence.route");
const watermarkSettingsRoutes = require("../modules/watermark-settings/watermarkSettings.route");
const storageUsageRoutes = require("../modules/storage-usage/storageUsage.route");
const branchRoutes = require("../modules/branches/branches.route");
const financingProductRoutes = require("../modules/financing-products/financingProducts.route");
const contractTypeRoutes = require("../modules/contract-types/contractTypes.route");
const thirdPartyRoutes = require("../modules/third-parties/thirdParties.route");
const documentChecklistRoutes = require("../modules/document-checklists/documentChecklists.route");
const depositTypeRoutes = require("../modules/deposit-types/depositTypes.route");
const mailDeliveryMediaRoutes = require("../modules/mail-delivery-media/mailDeliveryMedia.route");
const collateralTypeRoutes = require("../modules/collateral-types/collateralTypes.route");
const legalProcessTypeRoutes = require("../modules/legal-process-types/legalProcessTypes.route");
const debtorRoutes = require("../modules/debtors/debtors.route");
const debtorContractRoutes = require("../modules/debtor-contracts/debtorContracts.route");
const debtorImportRoutes = require("../modules/debtor-imports/debtorImports.route");
const debtorIdebReportRoutes = require("../modules/debtor-ideb-reports/debtorIdebReports.route");
const debtorMarketingRoutes = require("../modules/debtor-marketing/debtorMarketing.route");
const debtorWarningLetterRoutes = require("../modules/debtor-warning-letters/debtorWarningLetters.route");
const debtorReportRoutes = require("../modules/debtor-reports/debtorReports.route");
const legalRoutes = require("../modules/legal/legal.route");
const notificationRoutes = require("../modules/notifications/notifications.route");
const activityCentreRoutes = require("../modules/activity-centre/activityCentre.route");
const clientErrorRoutes = require("../modules/client-errors/clientErrors.route");

const API_MODULES = Object.freeze([
  { path: "/auth", tag: "Authentication", router: authRoutes },
  { path: "/roles", tag: "Roles", router: roleRoutes },
  { path: "/divisions", tag: "Divisions", router: divisionRoutes },
  { path: "/letter-priorities", tag: "Letter priorities", router: letterPriorityRoutes },
  { path: "/document-types", tag: "Document types", router: documentTypeRoutes },
  { path: "/storages", tag: "Storages", router: storageRoutes },
  { path: "/users", tag: "Users", router: userRoutes },
  { path: "/incoming-mails", tag: "Incoming mails", router: incomingMailRoutes },
  { path: "/menus", tag: "Menus", router: menuRoutes },
  { path: "/role-menus", tag: "Role menus", router: roleMenuRoutes },
  { path: "/digital-documents", tag: "Digital documents", router: digitalDocumentRoutes },
  {
    path: "/digital-document-access-requests",
    tag: "Digital document access requests",
    router: digitalDocumentAccessRequestRoutes,
  },
  { path: "/digital-document-loans", tag: "Digital document loans", router: digitalDocumentLoanRoutes },
  { path: "/digital-archives", tag: "Digital archives", router: digitalArchiveRoutes },
  { path: "/outgoing-mails", tag: "Outgoing mails", router: outgoingMailRoutes },
  { path: "/memorandums", tag: "Memorandums", router: memorandumRoutes },
  { path: "/correspondence", tag: "Correspondence", router: correspondenceRoutes },
  { path: "/watermark-settings", tag: "Watermark settings", router: watermarkSettingsRoutes },
  { path: "/storage-usage", tag: "Storage usage", router: storageUsageRoutes },
  { path: "/branches", tag: "Branches", router: branchRoutes },
  { path: "/financing-products", tag: "Financing products", router: financingProductRoutes },
  { path: "/contract-types", tag: "Contract types", router: contractTypeRoutes },
  { path: "/third-parties", tag: "Third parties", router: thirdPartyRoutes },
  { path: "/document-checklists", tag: "Document checklists", router: documentChecklistRoutes },
  { path: "/deposit-types", tag: "Deposit types", router: depositTypeRoutes },
  { path: "/mail-delivery-media", tag: "Mail delivery media", router: mailDeliveryMediaRoutes },
  { path: "/collateral-types", tag: "Collateral types", router: collateralTypeRoutes },
  { path: "/legal-process-types", tag: "Legal process types", router: legalProcessTypeRoutes },
  { path: "/debtors", tag: "Debtors", router: debtorRoutes },
  { path: "/debtor-contracts", tag: "Debtor contracts", router: debtorContractRoutes },
  { path: "/debtor-imports", tag: "Debtor imports", router: debtorImportRoutes },
  { path: "/debtor-ideb-reports", tag: "Debtor iDeb reports", router: debtorIdebReportRoutes },
  { path: "/debtor-marketing", tag: "Debtor marketing", router: debtorMarketingRoutes },
  { path: "/debtor-warning-letters", tag: "Debtor warning letters", router: debtorWarningLetterRoutes },
  { path: "/debtor-reports", tag: "Debtor reports", router: debtorReportRoutes },
  { path: "/legal", tag: "Legal", router: legalRoutes },
  { path: "/notifications", tag: "Notifications", router: notificationRoutes },
  { path: "/activity-centre", tag: "Activity centre", router: activityCentreRoutes },
  { path: "/client-errors", tag: "Client error reporting", router: clientErrorRoutes },
]);

module.exports = API_MODULES;
