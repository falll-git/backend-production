const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");

const repository = require("./activityCentre.repository");
const service = require("./activityCentre.service");

function activity(overrides = {}) {
  return {
    id: "activity-1",
    actor_id: "user-1",
    actor: {
      id: "user-1",
      name: "Manager Audit",
      username: "manager",
      email: "manager@example.test",
      role: { id: "role-manager", name: "Manager" },
      division: { id: "division-1", name: "Manajemen" },
    },
    module: "INFORMASI_DEBITUR",
    action: "UPDATE",
    source: "MANUAL",
    entity_type: "DEBITUR",
    entity_id: "debtor-1",
    object_label: "CIF-001",
    title: "Ubah debitur",
    summary: "Detail yang hanya boleh tampil di modul asal",
    before_data: { status: "LAMA" },
    after_data: { status: "BARU" },
    request_path: "/api/debtors/debtor-1",
    response_status: 200,
    created_at: new Date("2026-07-20T08:30:00.000Z"),
    ...overrides,
  };
}

test("detail Pusat Log Aktivitas hanya mengembalikan konteks aman", async () => {
  const originalFindById = repository.findById;
  repository.findById = async () => activity();

  try {
    const result = await service.getById("activity-1");
    assert.equal(result.entity_label, "Debitur");
    assert.equal(result.source_label, "Input Manual");
    assert.equal(result.result_label, "Berhasil");
    assert.equal(result.context.kind, "CHANGE");
    assert.equal(
      result.context.target_path,
      "/dashboard/informasi-debitur",
    );
    assert.deepEqual(result.context.changed_fields, ["Status"]);
    assert.ok(
      result.context.fields.some(
        (field) => field.label === "Status Sebelum" && field.value === "Lama",
      ),
    );
    assert.ok(
      result.context.fields.some(
        (field) => field.label === "Status Sesudah" && field.value === "Baru",
      ),
    );
    assert.equal(Object.hasOwn(result, "before_data"), false);
    assert.equal(Object.hasOwn(result, "after_data"), false);
    assert.equal(Object.hasOwn(result, "metadata"), false);
    assert.equal(Object.hasOwn(result, "request_path"), false);
    assert.equal(Object.hasOwn(result, "user_agent"), false);
  } finally {
    repository.findById = originalFindById;
  }
});

test("detail impor menampilkan statistik aman tanpa path dan pesan internal", () => {
  const result = service.serializeDetail(
    activity({
      action: "IMPORT_COMPLETED_WITH_ERRORS",
      source: "SLIK_IMPORT",
      entity_type: "debtor_import_jobs",
      object_label: "Import SLIK A01 2026-07",
      before_data: null,
      after_data: {
        status: "COMPLETED_WITH_ERRORS",
        total_rows: 10,
        success_rows: 8,
        failed_rows: 2,
        file_path: "D:\\private\\raw.txt",
      },
      metadata: {
        file_names: ["D:\\private\\A01 Juli.txt"],
        total_size_bytes: 2048,
        error_message: "database internal gagal",
        stats: {
          debtors: 3,
          contracts: 4,
          collaterals: 2,
        },
      },
    }),
  );

  assert.equal(result.action_label, "Impor Selesai dengan Catatan");
  assert.equal(result.context.kind, "IMPORT");
  assert.equal(
    result.context.target_path,
    "/dashboard/informasi-debitur/admin/monitoring-import",
  );
  assert.ok(
    result.context.fields.some(
      (field) => field.label === "Nama File" && field.value === "A01 Juli.txt",
    ),
  );
  assert.ok(
    result.context.fields.some(
      (field) => field.label === "Baris Berhasil" && field.value === "8",
    ),
  );
  assert.ok(
    result.context.fields.some(
      (field) => field.label === "Agunan Terbentuk" && field.value === "2",
    ),
  );
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /D:\\\\private/i);
  assert.doesNotMatch(serialized, /database internal gagal/i);
  assert.doesNotMatch(serialized, /file_path/i);
});

test("detail export Pusat Log menyebut data yang benar-benar diexport", () => {
  const result = service.serializeDetail(
    activity({
      module: "SISTEM",
      action: "EXPORT",
      entity_type: "AKTIVITAS_SISTEM",
      object_label: null,
      request_path: "/api/activity-centre/export",
      before_data: null,
      after_data: null,
    }),
  );

  assert.equal(result.context.kind, "EXPORT");
  assert.ok(
    result.context.fields.some(
      (field) =>
        field.label === "Data yang Diexport" &&
        field.value === "Pusat Log Aktivitas",
    ),
  );
});

test("jenis dokumen pada modul Parameter memakai konteks Parameter", () => {
  const result = service.serializeDetail(
    activity({
      module: "PARAMETER",
      action: "CREATE",
      entity_type: "JENIS_DOKUMEN",
      object_label: "LEGAL",
      before_data: null,
      after_data: null,
    }),
  );

  assert.equal(result.context.kind, "PARAMETER");
  assert.equal(result.context.title, "Konteks Parameter");
  assert.ok(
    result.context.fields.some(
      (field) => field.label === "Parameter" && field.value === "Jenis Dokumen",
    ),
  );
});

test("export Pusat Log Aktivitas hanya berisi kolom audit ringkas", async () => {
  const originalFindAll = repository.findAll;
  repository.findAll = async () => [activity()];

  try {
    const result = await service.exportExcel({ sort: "newest" });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    const worksheet = workbook.getWorksheet("Pusat Log Aktivitas");

    assert.ok(worksheet);
    assert.deepEqual(worksheet.getRow(1).values.slice(1), [
      "No",
      "Tanggal & Waktu",
      "User",
      "Username",
      "Role",
      "Divisi",
      "Modul",
      "Aksi",
    ]);
    assert.match(result.filename, /^pusat-log-aktivitas-\d{8}T\d{4}\.xlsx$/);
  } finally {
    repository.findAll = originalFindAll;
  }
});
