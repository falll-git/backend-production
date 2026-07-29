const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const {
  createMarketingActivitySchema,
  updateMarketingActivitySchema,
} = require("../modules/debtor-marketing/debtorMarketing.validation");
const {
  VISIT_LOCATION_AUDIT_FIELDS,
  VISIT_LOCATION_MAX_ACCURACY_M,
  resolveVisitLocation,
  serializeVisitLocation,
} = require("./debtor-marketing-location");

const DEBTOR_ID = "11111111-1111-4111-8111-111111111111";

function createPayload(overrides = {}) {
  return {
    debtor_id: DEBTOR_ID,
    visit_result: "Debitur telah ditemui.",
    ...overrides,
  };
}

function validationMessages(schema, payload) {
  const { error } = schema.validate(payload, { abortEarly: false });
  return (error?.details || []).map((detail) => detail.message);
}

test("Joi menerima batas koordinat dan menolak nilai di luar rentang", () => {
  for (const [latitude, longitude] of [
    [-90, -180],
    [0, 0],
    [90, 180],
  ]) {
    assert.deepEqual(
      validationMessages(
        createMarketingActivitySchema,
        createPayload({
          visit_latitude: latitude,
          visit_longitude: longitude,
          visit_location_accuracy_m: 10,
        }),
      ),
      [],
    );
  }

  assert.match(
    validationMessages(
      createMarketingActivitySchema,
      createPayload({
        visit_latitude: 90.000001,
        visit_longitude: 0,
        visit_location_accuracy_m: 10,
      }),
    ).join(" "),
    /-90 sampai 90/,
  );
  assert.match(
    validationMessages(
      createMarketingActivitySchema,
      createPayload({
        visit_latitude: 0,
        visit_longitude: -180.000001,
        visit_location_accuracy_m: 10,
      }),
    ).join(" "),
    /-180 sampai 180/,
  );
});

test("Joi mewajibkan pasangan koordinat dan akurasi maksimal 100 meter", () => {
  assert.match(
    validationMessages(
      createMarketingActivitySchema,
      createPayload({ visit_latitude: -6.2 }),
    ).join(" "),
    /wajib dikirim berpasangan/,
  );
  assert.match(
    validationMessages(updateMarketingActivitySchema, {
      visit_location_accuracy_m: 5,
    }).join(" "),
    /wajib dikirim bersama/,
  );
  assert.match(
    validationMessages(
      createMarketingActivitySchema,
      createPayload({
        visit_latitude: -6.2,
        visit_longitude: 106.8,
      }),
    ).join(" "),
    /wajib dikirim bersama/,
  );
  assert.match(
    validationMessages(
      createMarketingActivitySchema,
      createPayload({
        visit_latitude: -6.2,
        visit_longitude: 106.8,
        visit_location_accuracy_m: -0.1,
      }),
    ).join(" "),
    /tidak boleh bernilai negatif/,
  );
  assert.match(
    validationMessages(
      createMarketingActivitySchema,
      createPayload({
        visit_latitude: -6.2,
        visit_longitude: 106.8,
        visit_location_accuracy_m: 100.001,
      }),
    ).join(" "),
    /100 meter atau lebih baik/,
  );
});

test("Hasil Kunjungan baru wajib memiliki lokasi", () => {
  assert.throws(
    () =>
      resolveVisitLocation({
        kind: "VISIT_RESULT",
        payload: createPayload(),
        requireLocation: true,
      }),
    /Lokasi kunjungan wajib diambil/,
  );
});

test("Action Plan dan Langkah Penanganan tidak memerlukan lokasi", () => {
  assert.deepEqual(
    resolveVisitLocation({ kind: "ACTION_PLAN", payload: {} }),
    {},
  );
  assert.deepEqual(
    resolveVisitLocation({ kind: "HANDLING_STEP", payload: {} }),
    {},
  );
  assert.throws(
    () =>
      resolveVisitLocation({
        kind: "ACTION_PLAN",
        payload: { visit_latitude: -6.2, visit_longitude: 106.8 },
      }),
    /hanya dapat disimpan untuk Hasil Kunjungan/,
  );
});

test("update tanpa koordinat mempertahankan seluruh lokasi lama", () => {
  const recordedAt = new Date("2026-07-14T08:00:00.000Z");
  const current = {
    visit_latitude: "-6.200001",
    visit_longitude: "106.816667",
    visit_location_accuracy_m: "7.500",
    visit_location_recorded_at: recordedAt,
  };

  assert.deepEqual(
    resolveVisitLocation({
      kind: "VISIT_RESULT",
      payload: { notes: "Keterangan diperbarui." },
      current,
    }),
    current,
  );

  assert.deepEqual(
    resolveVisitLocation({
      kind: "VISIT_RESULT",
      payload: {
        visit_location_recorded_at: new Date("1999-01-01T00:00:00.000Z"),
      },
      current,
    }),
    current,
  );
});

test("ambil ulang lokasi mengganti koordinat, akurasi, dan timestamp backend", () => {
  const backendTimestamp = new Date("2026-07-15T09:30:00.123Z");
  const clientTimestamp = new Date("1999-01-01T00:00:00.000Z");

  const location = resolveVisitLocation({
    kind: "VISIT_RESULT",
    payload: {
      visit_latitude: -7.257472,
      visit_longitude: 112.75209,
      visit_location_accuracy_m: 4.25,
      visit_location_recorded_at: clientTimestamp,
    },
    current: {
      visit_latitude: -6.2,
      visit_longitude: 106.8,
      visit_location_accuracy_m: 12,
      visit_location_recorded_at: new Date("2026-07-14T08:00:00.000Z"),
    },
    now: () => backendTimestamp,
  });

  assert.deepEqual(location, {
    visit_latitude: -7.257472,
    visit_longitude: 112.75209,
    visit_location_accuracy_m: 4.25,
    visit_location_recorded_at: backendTimestamp,
  });
  assert.notEqual(location.visit_location_recorded_at, clientTimestamp);
});

test("backend menolak koordinat tanpa akurasi dan akurasi di atas batas", () => {
  assert.equal(VISIT_LOCATION_MAX_ACCURACY_M, 100);
  assert.throws(
    () =>
      resolveVisitLocation({
        kind: "VISIT_RESULT",
        payload: {
          visit_latitude: -8.1335,
          visit_longitude: 113.2248,
        },
        requireLocation: true,
      }),
    /Akurasi lokasi wajib dikirim/,
  );
  assert.throws(
    () =>
      resolveVisitLocation({
        kind: "VISIT_RESULT",
        payload: {
          visit_latitude: -8.1335,
          visit_longitude: 113.2248,
          visit_location_accuracy_m: 100.001,
        },
        requireLocation: true,
      }),
    /100 meter atau lebih baik/,
  );
});

test("akurasi saja tidak dapat mengubah bukti lokasi", () => {
  assert.throws(
    () =>
      resolveVisitLocation({
        kind: "VISIT_RESULT",
        payload: { visit_location_accuracy_m: 2 },
        current: {
          visit_latitude: -6.2,
          visit_longitude: 106.8,
          visit_location_accuracy_m: 10,
          visit_location_recorded_at: new Date(),
        },
      }),
    /hanya dapat dikirim bersama koordinat/,
  );
});

test("serializer mengubah Decimal menjadi angka dan aman untuk data legacy", () => {
  const recordedAt = new Date("2026-07-15T09:30:00.123Z");
  assert.deepEqual(
    serializeVisitLocation({
      visit_latitude: { toString: () => "-6.200001" },
      visit_longitude: { toString: () => "106.816667" },
      visit_location_accuracy_m: { toString: () => "7.500" },
      visit_location_recorded_at: recordedAt,
    }),
    {
      visit_latitude: -6.200001,
      visit_longitude: 106.816667,
      visit_location_accuracy_m: 7.5,
      visit_location_recorded_at: recordedAt,
    },
  );

  assert.deepEqual(serializeVisitLocation({}), {
    visit_latitude: null,
    visit_longitude: null,
    visit_location_accuracy_m: null,
    visit_location_recorded_at: null,
  });
});

test("audit dan seluruh serializer aktivitas memakai kontrak lokasi yang sama", () => {
  assert.deepEqual(VISIT_LOCATION_AUDIT_FIELDS, [
    "visit_latitude",
    "visit_longitude",
    "visit_location_accuracy_m",
    "visit_location_recorded_at",
  ]);

  const backendRoot = resolve(__dirname, "..", "..");
  const marketingSource = readFileSync(
    resolve(
      backendRoot,
      "src/modules/debtor-marketing/debtorMarketing.service.js",
    ),
    "utf8",
  );
  const debtorsSource = readFileSync(
    resolve(backendRoot, "src/modules/debtors/debtors.service.js"),
    "utf8",
  );
  const reportSource = readFileSync(
    resolve(
      backendRoot,
      "src/modules/debtor-reports/debtorReports.service.js",
    ),
    "utf8",
  );
  const reportRepositorySource = readFileSync(
    resolve(
      backendRoot,
      "src/modules/debtor-reports/debtorReports.repository.js",
    ),
    "utf8",
  );

  assert.match(marketingSource, /\.\.\.VISIT_LOCATION_AUDIT_FIELDS/);
  assert.equal(
    (marketingSource.match(/\.\.\.resolveVisitLocation\(\{/g) || []).length,
    2,
  );
  assert.match(
    marketingSource,
    /requireLocation:\s*kind === "VISIT_RESULT"/,
  );
  assert.match(marketingSource, /\.\.\.serializeVisitLocation\(item\)/);
  assert.equal(
    (debtorsSource.match(/\.\.\.serializeVisitLocation\(item\)/g) || [])
      .length,
    2,
  );
  assert.match(reportSource, /\.\.\.serializeVisitLocation\(item\)/);
  assert.match(reportSource, /files:\s*serializeFiles\(req, item/);
  assert.match(
    reportRepositorySource,
    /findRecentMarketingActivities[\s\S]*?files:\s*true/,
  );
  assert.match(
    debtorsSource,
    /buildMarketingTimeline[\s\S]*?file:\s*item\.file,[\s\S]*?files:\s*item\.files/,
  );
});

test("migration geotag nullable dan tidak melakukan backfill data lama", () => {
  const migration = readFileSync(
    resolve(
      __dirname,
      "../../prisma/migrations/20260715100000_add_visit_geotagging/migration.sql",
    ),
    "utf8",
  );
  const addColumnsStatement = migration.match(
    /ALTER TABLE "debtor_marketing_activities"[\s\S]*?;/,
  )?.[0];

  assert.doesNotMatch(migration, /\bUPDATE\b/i);
  assert.doesNotMatch(migration, /\bDEFAULT\b/i);
  assert.ok(addColumnsStatement);
  assert.doesNotMatch(addColumnsStatement, /\bNOT NULL\b/i);
  assert.match(migration, /dma_visit_coordinate_pair_chk/);
  assert.match(migration, /dma_visit_location_kind_chk/);
});
