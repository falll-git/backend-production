const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isInternalLegalAuditSource,
  legalAuditEntityTypeFilter,
  legalAuditSourceFilter,
  normalizeLegalAuditEntityType,
  normalizeLegalAuditSource,
  sanitizeLegalAuditTitle,
} = require("./legal-audit-presentation");

test("identifier tabel legal legacy dinormalisasi menjadi kontrak bisnis", () => {
  assert.equal(
    normalizeLegalAuditEntityType("legal_deposit_transactions"),
    "LEGAL_DEPOSIT_TRANSACTION",
  );
  assert.equal(
    normalizeLegalAuditEntityType("legal_claims"),
    "LEGAL_CLAIM",
  );
  assert.deepEqual(legalAuditEntityTypeFilter("LEGAL_DEPOSIT_TRANSACTION"), {
    in: ["LEGAL_DEPOSIT_TRANSACTION", "legal_deposit_transactions"],
  });
});

test("marker seed dan fixture diperlakukan sebagai aktivitas sistem", () => {
  assert.equal(isInternalLegalAuditSource("REVIEW_SEED"), true);
  assert.equal(isInternalLegalAuditSource("fixture"), true);
  assert.equal(normalizeLegalAuditSource("REVIEW_SEED"), "SYSTEM");
  assert.equal(sanitizeLegalAuditTitle("Buat data untuk review", "REVIEW_SEED"), null);

  const systemFilter = legalAuditSourceFilter("SYSTEM");
  assert.equal(Array.isArray(systemFilter.OR), true);
  assert.equal(systemFilter.OR.length, 3);
});

test("sumber dan judul bisnis normal tidak diubah", () => {
  assert.equal(normalizeLegalAuditSource("MANUAL"), "MANUAL");
  assert.equal(sanitizeLegalAuditTitle("Ubah progress notaris", "MANUAL"), "Ubah progress notaris");
  assert.deepEqual(legalAuditSourceFilter("MANUAL"), { equals: "MANUAL" });
});
