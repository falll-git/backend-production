const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  addMonthsClamped,
  buildCollateralMonitoring,
  latestAppraisal,
} = require("./collateral-monitoring");

test("monitoring memakai tanggal penilaian pelapor saat belum ada tinjauan expired", () => {
  const result = latestAppraisal({
    reporter_appraisal_date: "2026-01-15",
    independent_appraisal_date: "2026-03-20",
  });

  assert.equal(result.source, "REPORTER");
  assert.equal(result.date.toISOString(), "2026-01-15T00:00:00.000Z");
});

test("tinjauan expired terbaru memperbarui acuan tinjauan agunan", () => {
  const result = latestAppraisal({
    reporter_appraisal_date: "2019-12-31",
    expiry_updated_at: "2026-08-06T10:15:00.000Z",
  });

  assert.equal(result.source, "EXPIRY_UPDATE");
  assert.equal(result.date.toISOString(), "2026-08-06T00:00:00.000Z");

  const monitoring = buildCollateralMonitoring(
    {
      reporter_appraisal_date: "2019-12-31",
      expiry_updated_at: "2026-08-06T10:15:00.000Z",
      has_expiry_date: true,
      expiry_date: "2027-12-31",
    },
    new Date("2026-08-06T12:00:00.000Z"),
  );
  assert.equal(monitoring.appraisal_status, "CURRENT");
  assert.equal(monitoring.appraisal_status_label, "Aman");
  assert.equal(
    monitoring.next_appraisal_due_date.toISOString(),
    "2027-08-06T00:00:00.000Z",
  );
});

test("tanggal independen tidak menggantikan tanggal pelapor yang kosong", () => {
  const result = latestAppraisal({
    independent_appraisal_date: "2026-03-20",
  });

  assert.equal(result.source, null);
  assert.equal(result.date, null);
});

test("addMonthsClamped menjaga akhir bulan pada tahun non-kabisat", () => {
  assert.equal(
    addMonthsClamped("2024-02-29", 12).toISOString(),
    "2025-02-28T00:00:00.000Z",
  );
});

test("warning penilaian dimulai tepat dua bulan kalender sebelum kewajiban", () => {
  const record = { reporter_appraisal_date: "2025-08-31" };

  assert.equal(
    buildCollateralMonitoring(record, new Date("2026-06-29T12:00:00.000Z"))
      .appraisal_status,
    "CURRENT",
  );
  const warning = buildCollateralMonitoring(
    record,
    new Date("2026-06-30T12:00:00.000Z"),
  );
  assert.equal(warning.next_appraisal_due_date.toISOString(), "2026-08-31T00:00:00.000Z");
  assert.equal(warning.appraisal_warning_start_date.toISOString(), "2026-06-30T00:00:00.000Z");
  assert.equal(warning.appraisal_status, "DUE_SOON");
  assert.equal(warning.appraisal_status_label, "Segera Ditinjau Ulang");
});

test("penilaian menjadi merah tepat pada tanggal kewajiban", () => {
  const result = buildCollateralMonitoring(
    { reporter_appraisal_date: "2025-07-15" },
    new Date("2026-07-15T12:00:00.000Z"),
  );

  assert.equal(result.appraisal_status, "OVERDUE");
  assert.equal(result.appraisal_days_remaining, 0);
});

test("status expired tidak berlaku ditentukan oleh agunan itu sendiri", () => {
  const result = buildCollateralMonitoring(
    {
      has_expiry_date: false,
      expiry_date: "2026-07-14",
    },
    new Date("2026-07-15T12:00:00.000Z"),
  );

  assert.equal(result.has_expiry_date, false);
  assert.equal(result.expiry_date, null);
  assert.equal(result.expiry_status, "NOT_APPLICABLE");
  assert.equal(result.expiry_status_label, "Tidak Berlaku");
});

test("warning expired dimulai tepat tiga bulan kalender sebelumnya", () => {
  const record = {
    has_expiry_date: true,
    expiry_date: "2026-10-31",
  };

  assert.equal(
    buildCollateralMonitoring(record, new Date("2026-07-30T12:00:00.000Z"))
      .expiry_status,
    "CURRENT",
  );
  const warning = buildCollateralMonitoring(
    record,
    new Date("2026-07-31T12:00:00.000Z"),
  );
  assert.equal(warning.expiry_warning_start_date.toISOString(), "2026-07-31T00:00:00.000Z");
  assert.equal(warning.expiry_status, "DUE_SOON");
  assert.equal(warning.expiry_status_label, "Segera Berakhir");
});

test("expired menjadi merah tepat pada tanggal expired", () => {
  const result = buildCollateralMonitoring(
    {
      has_expiry_date: true,
      expiry_date: "2026-07-15",
    },
    new Date("2026-07-15T12:00:00.000Z"),
  );

  assert.equal(result.expiry_status, "EXPIRED");
  assert.equal(result.expiry_status_label, "Sudah Berakhir");
  assert.equal(result.expiry_days_remaining, 0);
});

test("migration korektif memindahkan kebijakan expired ke setiap agunan", () => {
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      "../../prisma/migrations/20260719100000_make_collateral_expiry_per_record/migration.sql",
    ),
    "utf8",
  );

  assert.match(sql, /ALTER TABLE "debtor_collaterals"/);
  assert.match(sql, /ADD COLUMN "has_expiry_date" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /ADD COLUMN "expiry_note" TEXT/);
  assert.match(sql, /WHERE "expiry_date" IS NOT NULL/);
  assert.match(sql, /DROP COLUMN IF EXISTS "has_expiry_date"/);
  assert.match(sql, /DROP COLUMN IF EXISTS "expiry_warning_days"/);
});
