const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  MANDATORY_RLS_TABLES,
  RLS_TABLE_EXEMPTIONS,
} = require("./database-security");

const migrationNames = [
  "20260722233000_layer8_security_rls",
  "20260725132000_expand_rls_digital_documents",
  "20260725134000_align_digital_document_rls_scope",
  "20260725140000_align_digital_document_access_expiry_rls",
  "20260726100000_expand_digital_archive_rls",
  "20260726110000_expand_persuratan_rls",
  "20260726120000_expand_debtor_legal_rls",
  "20260726130000_protect_system_activity_logs",
  "20260726140000_harden_rls_helper_privileges",
  "20260726150000_require_contract_read_permission_rls",
];

const migrationSql = migrationNames
  .map((name) =>
    fs.readFileSync(
      path.resolve(__dirname, `../../prisma/migrations/${name}/migration.sql`),
      "utf8",
    ),
  )
  .join("\n");

test("seluruh tabel RLS minimum di-enable, force, dan memiliki policy", () => {
  for (const table of MANDATORY_RLS_TABLES) {
    assert.match(
      migrationSql,
      new RegExp(`ALTER\\s+TABLE\\s+(?:public\\.)?\\"?${table}\\"?\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i"),
      `${table} belum ENABLE RLS`,
    );
    assert.match(
      migrationSql,
      new RegExp(`ALTER\\s+TABLE\\s+(?:public\\.)?\\"?${table}\\"?\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i"),
      `${table} belum FORCE RLS`,
    );
    assert.match(
      migrationSql,
      new RegExp(`CREATE\\s+POLICY[\\s\\S]*?ON\\s+(?:public\\.)?\\"?${table}\\"?`, "i"),
      `${table} belum memiliki policy`,
    );
  }
});

test("klasifikasi tabel RLS tidak tumpang tindih dan selalu beralasan", () => {
  const mandatory = new Set(MANDATORY_RLS_TABLES);
  for (const [table, reason] of Object.entries(RLS_TABLE_EXEMPTIONS)) {
    assert.equal(mandatory.has(table), false, `${table} masuk dua klasifikasi`);
    assert.match(reason, /^[a-z][a-z_]+$/);
  }
});

test("scope URL debitur, legal, dan persuratan tetap sinkron dengan source", () => {
  for (const [sourceFile, constantName] of [
    ["../utils/debtor-access.js", "DEBTOR_DATA_SCOPE_URLS"],
    ["../utils/debtor-access.js", "LEGAL_DATA_SCOPE_URLS"],
    ["../utils/persuratan-access.js", "PERSURATAN_DATA_SCOPE_URLS"],
  ]) {
    const source = fs.readFileSync(path.resolve(__dirname, sourceFile), "utf8");
    const list = source.match(
      new RegExp(`const ${constantName} = \\[([\\s\\S]*?)\\];`),
    );
    assert.ok(list, `${constantName} tidak ditemukan`);
    const urls = [...list[1].matchAll(/["']([^"']+)["']/g)].map(
      (match) => match[1],
    );
    assert.ok(urls.length > 0, `${constantName} kosong`);
    for (const url of urls) {
      assert.ok(migrationSql.includes(`'${url}'`), `${url} belum ada di policy`);
    }
  }
});

test("helper rekursif memakai owner NOLOGIN terpisah dan search_path tetap", () => {
  const helperMigrations = migrationSql.match(
    /CREATE OR REPLACE FUNCTION public\.ruwang_arsip_can_[\s\S]*?(?=ALTER TABLE public\.digital_document_related_users)/i,
  )?.[0] || migrationSql;

  assert.match(migrationSql, /CREATE ROLE ruwang_arsip_policy\s+NOLOGIN[\s\S]*?BYPASSRLS/i);
  assert.match(migrationSql, /SECURITY DEFINER\s+SET search_path = pg_catalog, public/i);
  assert.match(migrationSql, /OWNER TO ruwang_arsip_policy/i);
  assert.match(migrationSql, /REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC/i);
  assert.doesNotMatch(helperMigrations, /\bEXECUTE\s+format\s*\(/i);
});

test("role policy tidak dapat login dan hanya mendapat akses baca tabel", () => {
  const provisioning = fs.readFileSync(
    path.resolve(__dirname, "../../ops/database/provision-layer8-roles.sql"),
    "utf8",
  );

  assert.match(provisioning, /ruwang_arsip_policy NOLOGIN/i);
  assert.match(provisioning, /GRANT SELECT ON ALL TABLES[\s\S]*?ruwang_arsip_policy/i);
  const applicationDmlGrant = provisioning.match(
    /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES[\s\S]*?;/i,
  )?.[0];
  assert.ok(applicationDmlGrant, "Grant DML aplikasi tidak ditemukan.");
  assert.doesNotMatch(applicationDmlGrant, /ruwang_arsip_policy/i);
});

test("verifier isolasi RLS menjadi bagian quality gate backend", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
  );
  assert.match(packageJson.scripts.quality, /database:rls-verify/);
});
