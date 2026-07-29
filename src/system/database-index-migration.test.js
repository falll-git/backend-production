const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migrationPath = path.resolve(
  __dirname,
  "../../prisma/migrations/20260722220000_layer3_database_indexes/migration.sql",
);

test("migration hanya menambahkan foreign-key index yang didukung query aktual", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  const createIndexStatements = sql.match(/CREATE INDEX /g) || [];

  assert.equal(createIndexStatements.length, 16);
  assert.match(sql, /incoming_mail_dispositions.*receiver_id.*status/is);
  assert.match(sql, /memorandum_dispositions.*receiver_id.*status/is);
  assert.match(sql, /digital_document_loans.*handed_over_by/is);
  assert.match(sql, /debtor_external_records.*import_job_id/is);
  assert.doesNotMatch(sql, /digital_documents_updated_by/);
  assert.doesNotMatch(sql, /notifications_created_by/);
  assert.doesNotMatch(sql, /legal_print_histories_template_id/);
});
