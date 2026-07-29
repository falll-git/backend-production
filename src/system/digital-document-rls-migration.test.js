const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const baseMigrationPath = path.resolve(
  __dirname,
  "../../prisma/migrations/20260725132000_expand_rls_digital_documents/migration.sql",
);
const alignmentMigrationPath = path.resolve(
  __dirname,
  "../../prisma/migrations/20260725134000_align_digital_document_rls_scope/migration.sql",
);
const expiryMigrationPath = path.resolve(
  __dirname,
  "../../prisma/migrations/20260725140000_align_digital_document_access_expiry_rls/migration.sql",
);
const businessMigrationPath = path.resolve(
  __dirname,
  "../../prisma/migrations/20260726100000_expand_digital_archive_rls/migration.sql",
);
const accessSourcePath = path.resolve(
  __dirname,
  "../utils/digital-archive-access.js",
);

function digitalArchiveScopeUrls(source) {
  const list = source.match(
    /const DIGITAL_ARCHIVE_DATA_SCOPE_URLS = \[([\s\S]*?)\];/,
  );
  assert.ok(list, "Daftar scope arsip digital tidak ditemukan.");
  return [...list[1].matchAll(/["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
}

test("migration RLS dokumen memaksa policy untuk seluruh operasi", () => {
  const baseSql = fs.readFileSync(baseMigrationPath, "utf8");
  const alignmentSql = fs.readFileSync(alignmentMigrationPath, "utf8");
  const combinedSql = `${baseSql}\n${alignmentSql}`;

  assert.match(baseSql, /ALTER TABLE "digital_documents" ENABLE ROW LEVEL SECURITY/i);
  assert.match(baseSql, /ALTER TABLE "digital_documents" FORCE ROW LEVEL SECURITY/i);
  for (const operation of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    assert.match(combinedSql, new RegExp(`FOR\\s+${operation}`, "i"));
  }
  assert.doesNotMatch(combinedSql, /SECURITY\s+DEFINER/i);
});

test("policy RLS mengikuti seluruh URL scope dan dua penanda restricted aplikasi", () => {
  const alignmentSql = fs.readFileSync(alignmentMigrationPath, "utf8");
  const activeReadPolicySql = fs.readFileSync(expiryMigrationPath, "utf8");
  const accessSource = fs.readFileSync(accessSourcePath, "utf8");
  const scopeUrls = digitalArchiveScopeUrls(accessSource);

  assert.equal(scopeUrls.length, 13);
  for (const url of scopeUrls) {
    assert.ok(
      activeReadPolicySql.includes(`'${url}'`),
      `URL scope ${url} belum tercakup fungsi read RLS aktif.`,
    );
  }
  assert.match(activeReadPolicySql, /document_access_level\s*<>\s*'RESTRICT'/i);
  assert.match(activeReadPolicySql, /NOT\s+document_is_restricted/i);
  assert.match(alignmentSql, /NOT\s+"is_restricted"/i);
  assert.match(activeReadPolicySql, /'view_division'/i);
  assert.match(activeReadPolicySql, /'manage_all'/i);
});

test("access request RLS berlaku sampai tanggal expired berakhir", () => {
  const sql = fs.readFileSync(expiryMigrationPath, "utf8");

  assert.match(sql, /"expires_at"::date\s*>=\s*CURRENT_DATE/i);
  assert.doesNotMatch(sql, /"expires_at"\s*>=\s*CURRENT_TIMESTAMP/i);
});

test("alur requestable hanya dibuka oleh purpose terdaftar dan izin pengajuan", () => {
  const sql = fs.readFileSync(businessMigrationPath, "utf8");

  assert.match(sql, /app\.access_purpose/i);
  assert.match(sql, /digital_document_requestable/i);
  assert.match(sql, /arsip-digital\/disposisi\/pengajuan/i);
  assert.match(sql, /NOT\s+public\.ruwang_arsip_can_read_digital_document_core/i);
});
