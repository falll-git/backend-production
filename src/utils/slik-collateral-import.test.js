const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCollateralImportUpdateData,
  collateralImportKey,
  resolveCollateralImportCandidate,
} = require("./slik-collateral-import");

const manualDate = new Date("2030-06-30T00:00:00.000Z");
const manualUpdatedAt = new Date("2026-07-17T04:00:00.000Z");

function collateral(overrides = {}) {
  return {
    id: "collateral-1",
    collateral_number: "AG-001",
    facility_number: "FAC-001",
    debtor_id: "debtor-1",
    has_expiry_date: true,
    expiry_date: manualDate,
    expiry_note: "Berlaku sampai perpanjangan berikutnya",
    expiry_updated_by: "user-manual",
    expiry_updated_at: manualUpdatedAt,
    deleted_at: null,
    ...overrides,
  };
}

test("identitas impor A01 menggunakan nomor agunan dan nomor fasilitas", () => {
  assert.equal(collateralImportKey(" AG-001 ", " FAC-001 "), "AG-001::FAC-001");

  const result = resolveCollateralImportCandidate([collateral()], {
    collateralNumber: "AG-001",
    facilityNumber: "FAC-001",
    debtorId: "debtor-1",
  });

  assert.equal(result.match_type, "EXACT");
  assert.equal(result.collateral.id, "collateral-1");
});

test("impor ulang exact mempertahankan tanggal manual dan metadata pengubah", () => {
  const updateData = buildCollateralImportUpdateData(
    collateral(),
    {
      collateral_number: "AG-001",
      facility_number: "FAC-001",
      period_month: "2026-07",
      expiry_date: null,
    },
    "user-import",
  );

  assert.equal(updateData.expiry_date, manualDate);
  assert.equal(updateData.has_expiry_date, true);
  assert.equal(updateData.expiry_note, "Berlaku sampai perpanjangan berikutnya");
  assert.equal(updateData.expiry_updated_by, "user-manual");
  assert.equal(updateData.expiry_updated_at, manualUpdatedAt);
  assert.equal(updateData.updated_by, "user-import");
  assert.equal(updateData.period_month, "2026-07");
});

test("impor ulang mempertahankan status Tidak dan keterangannya", () => {
  const existing = collateral({
    has_expiry_date: false,
    expiry_date: null,
    expiry_note: "Tidak memiliki masa berlaku",
  });
  const updateData = buildCollateralImportUpdateData(
    existing,
    {
      collateral_number: "AG-001",
      facility_number: "FAC-001",
      period_month: "2026-08",
    },
    "user-import",
  );

  assert.equal(updateData.has_expiry_date, false);
  assert.equal(updateData.expiry_date, null);
  assert.equal(updateData.expiry_note, "Tidak memiliki masa berlaku");
  assert.equal(updateData.expiry_updated_by, "user-manual");
  assert.equal(updateData.expiry_updated_at, manualUpdatedAt);
});

test("nomor fasilitas berubah tetap memakai agunan unik milik debitur yang sama", () => {
  const result = resolveCollateralImportCandidate([collateral()], {
    collateralNumber: "AG-001",
    facilityNumber: "FAC-NEW",
    debtorId: "debtor-1",
  });
  const updated = {
    ...result.collateral,
    ...buildCollateralImportUpdateData(
      result.collateral,
      {
        collateral_number: "AG-001",
        facility_number: "FAC-NEW",
        period_month: "2026-08",
      },
      "user-import",
    ),
  };

  assert.equal(result.match_type, "FACILITY_CHANGED");
  assert.equal(updated.id, "collateral-1");
  assert.equal(updated.facility_number, "FAC-NEW");
  assert.equal(updated.expiry_date, manualDate);
  assert.equal(updated.has_expiry_date, true);
  assert.equal(updated.expiry_note, "Berlaku sampai perpanjangan berikutnya");
  assert.equal(updated.expiry_updated_by, "user-manual");
  assert.equal(updated.expiry_updated_at, manualUpdatedAt);
});

test("fallback perubahan fasilitas tidak menyeberang ke debitur lain", () => {
  const result = resolveCollateralImportCandidate(
    [collateral({ debtor_id: "debtor-other" })],
    {
      collateralNumber: "AG-001",
      facilityNumber: "FAC-NEW",
      debtorId: "debtor-1",
    },
  );

  assert.equal(result.match_type, "NONE");
  assert.equal(result.collateral, null);
});

test("kandidat ambigu tidak dipilih jika pemilik metadata manual tidak tunggal", () => {
  const result = resolveCollateralImportCandidate(
    [
      collateral({ id: "collateral-1", facility_number: "FAC-OLD-1" }),
      collateral({ id: "collateral-2", facility_number: "FAC-OLD-2" }),
    ],
    {
      collateralNumber: "AG-001",
      facilityNumber: "FAC-NEW",
      debtorId: "debtor-1",
    },
  );

  assert.equal(result.match_type, "AMBIGUOUS");
  assert.equal(result.collateral, null);
});

test("kandidat tunggal dengan tanggal manual dapat dipertahankan saat relasi fasilitas lebih dari satu", () => {
  const result = resolveCollateralImportCandidate(
    [
      collateral({ id: "manual-owner", facility_number: "FAC-OLD-1" }),
      collateral({
        id: "without-manual-data",
        facility_number: "FAC-OLD-2",
        has_expiry_date: false,
        expiry_date: null,
        expiry_note: null,
        expiry_updated_by: null,
        expiry_updated_at: null,
      }),
    ],
    {
      collateralNumber: "AG-001",
      facilityNumber: "FAC-NEW",
      debtorId: "debtor-1",
    },
  );

  assert.equal(result.match_type, "FACILITY_CHANGED_MANUAL_OWNER");
  assert.equal(result.collateral.id, "manual-owner");
});

test("agunan yang sudah direlasikan ulang tidak dipakai ulang untuk fasilitas berbeda", () => {
  const result = resolveCollateralImportCandidate([collateral()], {
    collateralNumber: "AG-001",
    facilityNumber: "FAC-NEW-2",
    debtorId: "debtor-1",
    excludedFallbackIds: new Set(["collateral-1"]),
  });

  assert.equal(result.match_type, "NONE");
  assert.equal(result.collateral, null);
});
