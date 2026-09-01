const test = require("node:test");
const assert = require("node:assert/strict");

const { createApiV1Router } = require("../routes/api-v1.router");
const apiModules = require("../routes/api-modules");
const activityCentreRouter = require("../modules/activity-centre/activityCentre.route");
const app = require("../app");
const correspondenceRouter = require("../modules/correspondence/correspondence.route");
const debtorImportsRouter = require("../modules/debtor-imports/debtorImports.route");
const debtorIdebReportsRouter = require("../modules/debtor-ideb-reports/debtorIdebReports.route");
const debtorMarketingRouter = require("../modules/debtor-marketing/debtorMarketing.route");
const debtorReportsRouter = require("../modules/debtor-reports/debtorReports.route");
const debtorWarningLettersRouter = require("../modules/debtor-warning-letters/debtorWarningLetters.route");
const debtorsRouter = require("../modules/debtors/debtors.route");
const digitalDocumentsRouter = require("../modules/digital-documents/digitalDocuments.route");
const digitalArchivesRouter = require("../modules/digital-archives/digitalArchives.route");
const incomingMailRouter = require("../modules/incoming-mail/incomingMail.route");
const legalRouter = require("../modules/legal/legal.route");
const memorandumRouter = require("../modules/memorandum/memorandum.route");
const outgoingMailsRouter = require("../modules/outgoing-mails/outgoingMails.route");
const seputarJaminanRouter = require("../modules/seputar-jaminan/seputarJaminan.route");
const watermarkSettingsRouter = require("../modules/watermark-settings/watermarkSettings.route");
const clientErrorsRouter = require("../modules/client-errors/clientErrors.route");

function routeProfiles(router, method, path) {
  const layer = router.stack.find(
    (item) =>
      item.route?.path === path &&
      item.route?.methods?.[method.toLowerCase()] === true,
  );
  assert.ok(layer, `Route ${method.toUpperCase()} ${path} tidak ditemukan.`);
  return layer.route.stack
    .map((item) => item.handle?.rateLimitProfile)
    .filter(Boolean);
}

function assertProfiles(router, method, path, expectedProfiles) {
  const profiles = routeProfiles(router, method, path);
  for (const profile of expectedProfiles) {
    assert.ok(
      profiles.includes(profile),
      `${method.toUpperCase()} ${path} belum memiliki profile ${profile}.`,
    );
  }
}

test("router API menerapkan limiter umum setelah endpoint health", () => {
  const router = createApiV1Router();
  const generalLayerIndex = router.stack.findIndex(
    (layer) => layer.handle?.rateLimitProfile === "api-general",
  );
  const healthLayerIndex = router.stack.findIndex(
    (layer) => layer.route?.path === "/health",
  );
  const readyLayerIndex = router.stack.findIndex(
    (layer) => layer.route?.path === "/ready",
  );

  assert.ok(generalLayerIndex > healthLayerIndex);
  assert.ok(generalLayerIndex > readyLayerIndex);

  for (const apiModule of apiModules) {
    const moduleLayerIndex = router.stack.findIndex(
      (layer) => layer.handle === apiModule.router,
    );
    assert.ok(
      moduleLayerIndex > generalLayerIndex,
      `Module ${apiModule.path} wajib dipasang setelah limiter umum.`,
    );
  }
});

test("seluruh endpoint impor dan export eksplisit memiliki profile khusus", () => {
  assertProfiles(debtorsRouter, "post", "/collaterals/expiry-import", [
    "import",
    "upload",
  ]);
  assertProfiles(debtorsRouter, "get", "/collaterals/expiry-template", [
    "export",
  ]);
  assertProfiles(debtorImportsRouter, "post", "/slik", ["import", "upload"]);
  assertProfiles(debtorImportsRouter, "post", "/ideb", ["import", "upload"]);
  assertProfiles(debtorImportsRouter, "post", "/slik/:jobId/retry", [
    "import",
  ]);
  assertProfiles(debtorImportsRouter, "get", "/ideb/:uploadId/resume-pdf", [
    "export",
  ]);
  assertProfiles(activityCentreRouter, "get", "/export", ["export"]);
});

test("seluruh endpoint parser file memiliki profile upload", () => {
  const routes = [
    [debtorsRouter, "post", "/:id/documents"],
    [debtorWarningLettersRouter, "post", "/"],
    [debtorWarningLettersRouter, "put", "/:id"],
    [debtorMarketingRouter, "post", "/:kind"],
    [debtorMarketingRouter, "put", "/:kind/:id"],
    [digitalDocumentsRouter, "post", "/"],
    [digitalDocumentsRouter, "put", "/:id"],
    [incomingMailRouter, "post", "/with-disposition"],
    [incomingMailRouter, "put", "/:id"],
    [outgoingMailsRouter, "post", "/"],
    [outgoingMailsRouter, "put", "/:id"],
    [memorandumRouter, "post", "/with-disposition"],
    [memorandumRouter, "put", "/:id"],
    [legalRouter, "post", "/progress/notary"],
    [legalRouter, "put", "/progress/notary/:id"],
    [legalRouter, "post", "/progress/insurance"],
    [legalRouter, "put", "/progress/insurance/:id"],
    [legalRouter, "post", "/progress/kjpp"],
    [legalRouter, "put", "/progress/kjpp/:id"],
    [legalRouter, "post", "/claims"],
    [legalRouter, "put", "/claims/:id"],
    [legalRouter, "post", "/deposits"],
    [legalRouter, "post", "/deposit-transactions"],
    [watermarkSettingsRouter, "post", "/image"],
  ];

  for (const [router, method, path] of routes) {
    assertProfiles(router, method, path, ["upload"]);
  }
});

test("endpoint Seputar Jaminan berbiaya tinggi memiliki limiter khusus", () => {
  assertProfiles(seputarJaminanRouter, "post", "/media", ["upload"]);
  assertProfiles(seputarJaminanRouter, "post", "/reconciliation", ["report"]);
});

test("operasi watermark massal memiliki profile operasi berat", () => {
  assertProfiles(watermarkSettingsRouter, "post", "/apply", [
    "expensive-operation",
  ]);
});

test("endpoint observability frontend memiliki limiter khusus", () => {
  assertProfiles(clientErrorsRouter, "post", "/", ["client-error-report"]);
});

test("setiap mount file privat membatasi percobaan akses dan download terotorisasi", () => {
  const stack = app.router?.stack || app._router?.stack || [];
  const profiles = stack
    .map((layer) => layer.handle?.rateLimitProfile)
    .filter(Boolean);

  assert.deepEqual(profiles, [
    "file-access",
    "download",
    "file-access",
    "download",
    "file-access",
    "download",
  ]);
});

test("seluruh endpoint laporan formal memiliki profile report", () => {
  const routes = [
    [correspondenceRouter, "get", "/report"],
    [debtorIdebReportsRouter, "get", "/"],
    [debtorIdebReportsRouter, "get", "/:uploadId"],
    [debtorReportsRouter, "get", "/summary"],
    [debtorReportsRouter, "get", "/portfolio"],
    [debtorReportsRouter, "get", "/facilities"],
    [debtorReportsRouter, "get", "/collaterals"],
    [debtorReportsRouter, "get", "/completeness"],
    [debtorReportsRouter, "get", "/npf"],
    [debtorReportsRouter, "get", "/marketing-activity"],
    [digitalArchivesRouter, "get", "/reports/summary"],
    [digitalArchivesRouter, "get", "/reports/documents"],
    [digitalArchivesRouter, "get", "/reports/due-dates"],
    [digitalArchivesRouter, "get", "/reports/access-requests"],
    [digitalArchivesRouter, "get", "/reports/loans"],
    [legalRouter, "get", "/reports/summary"],
    [legalRouter, "get", "/reports/third-party-documents"],
    [legalRouter, "get", "/reports/third-party-deposit-funds"],
    [legalRouter, "get", "/reports/activity-logs"],
  ];

  for (const [router, method, path] of routes) {
    assertProfiles(router, method, path, ["report"]);
  }
});
