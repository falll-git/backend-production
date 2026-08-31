const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const structuralSql = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../prisma/migrations/20260822110000_add_seputar_jaminan_module/migration.sql",
  ),
  "utf8",
);
const protectionSql = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../prisma/migrations/20260822111000_protect_seputar_jaminan_module/migration.sql",
  ),
  "utf8",
);
const taxonomySql = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../prisma/migrations/20260822112000_seed_seputar_jaminan_taxonomy_v1/migration.sql",
  ),
  "utf8",
);
const vocabularySql = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../prisma/migrations/20260822113000_lock_seputar_jaminan_attribute_vocabulary/migration.sql",
  ),
  "utf8",
);
const workerIdentityHardeningSql = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../prisma/migrations/20260823120000_harden_seputar_jaminan_worker_identity/migration.sql",
  ),
  "utf8",
);
const workflowIntegrationSource = fs.readFileSync(
  path.resolve(__dirname, "../integration/seputar-jaminan.workflow.test.js"),
  "utf8",
);

const sjTables = [
  "sj_integration_settings",
  "sj_public_profiles",
  "sj_public_profile_versions",
  "sj_whatsapp_contacts",
  "sj_whatsapp_contact_versions",
  "sj_publications",
  "sj_publication_versions",
  "sj_land_details",
  "sj_building_details",
  "sj_machine_details",
  "sj_vehicle_details",
  "sj_media_assets",
  "sj_publication_version_media",
  "sj_publication_reviews",
  "sj_sync_outbox",
  "sj_sync_attempts",
  "sj_reconciliation_runs",
  "sj_taxonomy_versions",
  "sj_taxonomy_items",
];

test("migration membuat seluruh tabel modul tanpa operasi destruktif", () => {
  for (const table of sjTables) {
    assert.match(structuralSql, new RegExp(`CREATE TABLE \\"${table}\\"`, "i"));
  }
  assert.doesNotMatch(structuralSql, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);
});

test("setiap tabel modul memakai FORCE RLS dan policy yang eksplisit", () => {
  for (const table of sjTables) {
    assert.match(
      protectionSql,
      new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY`, "i"),
    );
    assert.match(
      protectionSql,
      new RegExp(`CREATE POLICY[\\s\\S]*?ON public\\.${table}\\s`, "i"),
    );
  }
});

test("worker sinkronisasi wajib role terpisah tanpa bypass RLS", () => {
  const provisionSource = fs.readFileSync(
    path.resolve(__dirname, "../../scripts/provision-ci-runtime-role.js"),
    "utf8",
  );
  assert.match(
    provisionSource,
    /CI_SEPUTAR_JAMINAN_WORKER_ROLE\s*=\s*["']ruwang_sj_worker["']/i,
  );
  assert.match(
    provisionSource,
    /CREATE ROLE \$\{CI_SEPUTAR_JAMINAN_WORKER_ROLE\}[\s\S]*?NOLOGIN[\s\S]*?NOBYPASSRLS/i,
  );
  assert.doesNotMatch(protectionSql, /GRANT\s+ruwang_sj_worker\s+TO\s+ruwang_arsip_app/i);
  assert.doesNotMatch(protectionSql, /ruwang_sj_worker[\s\S]*?BYPASSRLS/i);
  assert.match(
    protectionSql,
    /pg_has_role\(session_user,\s*'ruwang_sj_worker',\s*'member'\)/i,
  );
  assert.doesNotMatch(
    protectionSql,
    /pg_has_role\(current_user,\s*'ruwang_sj_worker',\s*'member'\)/i,
  );
  assert.match(workerIdentityHardeningSql, /caller\.rolname\s*=\s*session_user/i);
  assert.match(workerIdentityHardeningSql, /NOT\s+caller\.rolsuper/i);
  assert.match(workerIdentityHardeningSql, /NOT\s+caller\.rolbypassrls/i);
  assert.match(
    workerIdentityHardeningSql,
    /pg_has_role\(caller\.rolname,\s*'ruwang_sj_worker',\s*'member'\)/i,
  );
});

test("cleanup workflow integration memakai koneksi owner yang terpisah", () => {
  assert.match(
    workflowIntegrationSource,
    /process\.env\.SJ_TEST_RUWANG_OWNER_DATABASE_URL/,
  );
  assert.match(
    workflowIntegrationSource,
    /ownerPrisma\.\$transaction\(async \(tx\) =>/,
  );
  assert.doesNotMatch(
    workflowIntegrationSource,
    /prisma\.\$transaction\(async \(tx\) => \{\s*await tx\.\$executeRawUnsafe\("SET LOCAL session_replication_role = replica"\)/,
  );
});

test("constraint object key media kompatibel dengan batas regex PostgreSQL", () => {
  assert.match(protectionSql, /char_length\(logical_object_key\) BETWEEN 1 AND 512/i);
  assert.doesNotMatch(protectionSql, /\{0,511\}/);
});

test("kontrak publikasi menolak field sensitif dan menjaga empat mata", () => {
  assert.match(protectionSql, /ruwang_arsip_sj_json_has_denied_key/i);
  assert.match(protectionSql, /NEW\.approved_by\s*=\s*NEW\.last_edited_by/i);
  assert.match(protectionSql, /NEW\.approved_by\s*=\s*NEW\.submitted_by/i);
  assert.match(protectionSql, /NEW\.verified_by\s*=\s*NEW\.created_by/i);
  assert.match(protectionSql, /INTERVAL '30 days'/i);
  assert.match(protectionSql, /media_count NOT BETWEEN 1 AND 10/i);
  assert.match(protectionSql, /cover_count <> 1/i);
});

test("outbox hanya menerima tujuh event V1", () => {
  const eventTypes = [
    "UPSERT_BPRS_PROFILE",
    "UPSERT_WHATSAPP_CONTACT",
    "REVOKE_WHATSAPP_CONTACT",
    "UPSERT_PUBLICATION_SNAPSHOT",
    "UNPUBLISH_PUBLICATION",
    "ARCHIVE_PUBLICATION",
    "REVOKE_MEDIA",
  ];
  for (const eventType of eventTypes) {
    assert.ok(protectionSql.includes(`'${eventType}'`));
  }
  const eventConstraint = protectionSql.match(
    /sj_outbox_event_type_v1 CHECK \(event_type IN \(([\s\S]*?)\)\)/i,
  );
  assert.ok(eventConstraint, "Constraint event V1 tidak ditemukan.");
  assert.equal((eventConstraint[1].match(/'[A-Z_]+'/g) || []).length, 7);
});

test("versi edit lokal dipisahkan dari versi event pusat", () => {
  assert.match(structuralSql, /"lock_version" INTEGER NOT NULL DEFAULT 0/i);
  assert.match(protectionSql, /sj_publications_lock_version_nonnegative/i);
  assert.match(protectionSql, /sj_profiles_lock_version_nonnegative/i);
  assert.match(protectionSql, /sj_contacts_lock_version_nonnegative/i);
});

test("taxonomy V1 berisi tepat 18 klasifikasi kontrak tanpa data contoh", () => {
  assert.match(taxonomySql, /134d0f3f3264e77d5611f167152a968eace852a27f9df63dc0f7b753f25558e8/i);
  assert.equal((taxonomySql.match(/'11000000-0000-4000-8000-[0-9]{12}'/g) || []).length, 18);
  for (const code of ["TANAH", "RUMAH", "PABRIK", "EXCAVATOR", "PERALATAN_MEDIS", "MOBIL", "BUS"]) {
    assert.ok(taxonomySql.includes(`'${code}'`));
  }
  assert.doesNotMatch(taxonomySql, /dummy|simulasi|contoh/i);
});

test("database mengunci vocabulary atribut publik Opsi A", () => {
  for (const code of [
    "SANGAT_BAIK",
    "PERLU_PERBAIKAN",
    "BERKONTUR",
    "RODA_DUA",
    "PERGUDANGAN",
    "OTOMATIS",
    "HIBRIDA",
  ]) {
    assert.ok(vocabularySql.includes(`'${code}'`));
  }
  assert.doesNotMatch(vocabularySql, /LAINNYA/);
  assert.doesNotMatch(vocabularySql, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);
});
