const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildRetentionDefinitions,
  parseBucketDays,
} = require("./retention-report");

test("retention report mengelompokkan log, notifikasi, import, dan soft-delete", () => {
  const definitions = buildRetentionDefinitions([
    { table_name: "system_activity_logs", column_name: "created_at" },
    { table_name: "notifications", column_name: "created_at" },
    { table_name: "notifications", column_name: "deleted_at" },
    { table_name: "debtor_import_jobs", column_name: "created_at" },
    { table_name: "debtor_import_jobs", column_name: "deleted_at" },
  ]);

  assert.deepEqual(
    definitions.map((item) => `${item.category}:${item.table}`),
    [
      "activity_log:system_activity_logs",
      "import_history:debtor_import_jobs",
      "notification:notifications",
      "soft_delete:debtor_import_jobs",
      "soft_delete:notifications",
    ],
  );
});

test("bucket retention dinormalisasi tanpa menjadi kebijakan penghapusan", () => {
  assert.deepEqual(parseBucketDays("365,30,90,30,invalid"), [30, 90, 365]);
});
