const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Client } = require("pg");
const {
  CI_RUNTIME_ROLE,
  CI_SEPUTAR_JAMINAN_WORKER_ROLE,
  provisionCiRuntimeRole,
} = require("./provision-ci-runtime-role");

const ROOT_DIR = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT_DIR, "prisma", "migrations");
const SCHEMA_PATH = path.join(ROOT_DIR, "prisma", "schema.prisma");
const PRISMA_CLI = path.join(ROOT_DIR, "node_modules", "prisma", "build", "index.js");
const FINAL_MIGRATION_COUNT = 130;
const REQUIRED_ADMIN_DATABASE = "ruwang_migration_test_admin";

const UPGRADE_PATHS = Object.freeze([
  Object.freeze({ key: "demo", label: "Demo", baseline: 105 }),
  Object.freeze({ key: "arthamadani", label: "Arthamadani", baseline: 85 }),
  Object.freeze({ key: "bogor", label: "Bogor", baseline: 85 }),
  Object.freeze({ key: "riyal_risyadi", label: "Riyal Risyadi", baseline: 86 }),
]);

const DATABASE_NAMES = Object.freeze({
  reference: "ruwang_migration_test_stage3_reference",
  demo: "ruwang_migration_test_stage3_demo",
  arthamadani: "ruwang_migration_test_stage3_arthamadani",
  bogor: "ruwang_migration_test_stage3_bogor",
  riyal_risyadi: "ruwang_migration_test_stage3_riyal_risyadi",
});

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function assertSafeAdminDatabase(env = process.env) {
  if (String(env.MIGRATION_PATH_TEST_ALLOW || "").toLowerCase() !== "true") {
    throw new Error(
      "Migration path test ditolak: MIGRATION_PATH_TEST_ALLOW=true wajib diatur.",
    );
  }

  let databaseUrl;
  try {
    databaseUrl = new URL(String(env.MIGRATION_PATH_TEST_ADMIN_URL || ""));
  } catch {
    throw new Error("MIGRATION_PATH_TEST_ADMIN_URL tidak valid.");
  }

  const hostname = databaseUrl.hostname.toLowerCase();
  const isLoopback =
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.startsWith("127.");
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));

  if (!isLoopback || databaseName !== REQUIRED_ADMIN_DATABASE) {
    throw new Error(
      `Migration path test ditolak: host wajib loopback dan database wajib ${REQUIRED_ADMIN_DATABASE}.`,
    );
  }

  return { databaseUrl, databaseName, hostname };
}

function listMigrations() {
  const migrations = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.equal(
    migrations.length,
    FINAL_MIGRATION_COUNT,
    `Ruwang harus memiliki tepat ${FINAL_MIGRATION_COUNT} migration.`,
  );
  for (const migration of migrations) {
    assert.ok(
      fs.existsSync(path.join(MIGRATIONS_DIR, migration, "migration.sql")),
      `migration.sql tidak ditemukan pada ${migration}.`,
    );
  }
  return migrations;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function migrationSourceManifest(migrations) {
  return migrations.map((name) => ({
    name,
    checksum: sha256File(path.join(MIGRATIONS_DIR, name, "migration.sql")),
  }));
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: ROOT_DIR,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`Git gagal saat memeriksa migration: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function assertMigrationSourceImmutable() {
  const trackedDiff = runGit([
    "diff",
    "--name-only",
    "HEAD",
    "--",
    "prisma/migrations",
  ]);
  const untracked = runGit([
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    "prisma/migrations",
  ]);
  assert.equal(trackedDiff, "", "Migration tracked berbeda dari HEAD.");
  assert.equal(untracked, "", "Terdapat migration untracked.");
}

function databaseUrlFor(adminUrl, databaseName, credentials = null) {
  const databaseUrl = new URL(adminUrl.toString());
  databaseUrl.pathname = `/${databaseName}`;
  databaseUrl.searchParams.set("schema", "public");
  if (credentials) {
    databaseUrl.username = credentials.username;
    databaseUrl.password = credentials.password;
  }
  return databaseUrl.toString();
}

function createMigrationBundle(migrations, count) {
  const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ruwang-stage3-migrations-"));
  const bundleMigrations = path.join(bundleRoot, "migrations");
  fs.mkdirSync(bundleMigrations, { recursive: true });
  fs.copyFileSync(
    path.join(MIGRATIONS_DIR, "migration_lock.toml"),
    path.join(bundleMigrations, "migration_lock.toml"),
  );
  copyMigrations(migrations, bundleMigrations, 0, count);

  const prismaConfigPath = path.join(bundleRoot, "prisma.config.ts");
  const prismaConfigModule = require.resolve("prisma/config");
  fs.writeFileSync(
    prismaConfigPath,
    [
      `const { defineConfig } = require(${JSON.stringify(prismaConfigModule)});`,
      "module.exports = defineConfig({",
      `  schema: ${JSON.stringify(SCHEMA_PATH)},`,
      `  migrations: { path: ${JSON.stringify(bundleMigrations)} },`,
      "  datasource: { url: process.env.MIGRATION_DATABASE_URL },",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
  return { bundleRoot, bundleMigrations, prismaConfigPath };
}

function copyMigrations(migrations, destination, fromIndex, toIndex) {
  for (const name of migrations.slice(fromIndex, toIndex)) {
    fs.cpSync(path.join(MIGRATIONS_DIR, name), path.join(destination, name), {
      recursive: true,
      errorOnExist: true,
    });
  }
}

function sanitizeOutput(value) {
  return String(value || "").replaceAll(/postgres(?:ql)?:\/\/[^\s]+/gi, "[DATABASE_URL_REDACTED]");
}

function runCommand(command, args, env, description) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    env: { ...process.env, ...env },
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `${description} gagal.\n${sanitizeOutput(result.stdout)}\n${sanitizeOutput(result.stderr)}`,
    );
  }
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function runPrisma(prismaConfigPath, databaseUrl, command) {
  return runCommand(
    process.execPath,
    [PRISMA_CLI, "migrate", command, "--config", prismaConfigPath],
    { DATABASE_URL: databaseUrl, MIGRATION_DATABASE_URL: databaseUrl },
    `prisma migrate ${command}`,
  );
}

async function migrationRows(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT migration_name, checksum, finished_at, rolled_back_at, logs
      FROM "_prisma_migrations"
      ORDER BY started_at, migration_name
    `);
    return result.rows;
  } finally {
    await client.end();
  }
}

async function assertAppliedMigrations(databaseUrl, expectedManifest) {
  const rows = await migrationRows(databaseUrl);
  assert.equal(rows.length, expectedManifest.length, "Jumlah migration database tidak sesuai.");
  assert.deepEqual(
    rows.map((row) => row.migration_name),
    expectedManifest.map((entry) => entry.name),
    "Urutan migration database tidak sesuai source.",
  );
  for (let index = 0; index < rows.length; index += 1) {
    assert.equal(rows[index].checksum, expectedManifest[index].checksum);
    assert.ok(rows[index].finished_at, `${rows[index].migration_name} belum selesai.`);
    assert.equal(rows[index].rolled_back_at, null);
    assert.equal(rows[index].logs, null);
  }
}

function fixtureIds(pathIndex) {
  const prefix = `13${String(pathIndex).padStart(6, "0")}`;
  const id = (suffix) => `${prefix}-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
  return {
    role: id(1),
    division: id(2),
    user: id(3),
    debtor: id(4),
    product: id(5),
    contractType: id(6),
    contract: id(7),
    collateral: id(8),
    deposit: id(9),
    transaction: id(10),
    refreshToken: id(11),
  };
}

async function seedLegacyFixture(databaseUrl, pathDefinition, pathIndex) {
  const ids = fixtureIds(pathIndex);
  const slug = pathDefinition.key;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO roles (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())`,
      [ids.role, `Stage3 Legacy Role ${slug}`],
    );
    await client.query(
      `INSERT INTO divisions (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())`,
      [ids.division, `Stage3 Legacy Division ${slug}`],
    );
    await client.query(
      `INSERT INTO users
        (id, name, username, email, password, role_id, division_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [
        ids.user,
        `Stage3 Legacy User ${slug}`,
        `stage3_legacy_${slug}`,
        `stage3-legacy-${slug}@example.invalid`,
        "stage3-non-login-fixture",
        ids.role,
        ids.division,
      ],
    );
    await client.query(
      `INSERT INTO digital_debtors
        (id, debtor_number, name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', NOW(), NOW())`,
      [ids.debtor, `STAGE3-DEBTOR-${slug}`, `Stage3 Legacy Debtor ${slug}`],
    );
    await client.query(
      `INSERT INTO financing_products
        (id, code, name, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, true, NOW(), NOW())`,
      [ids.product, `STAGE3-PRODUCT-${slug}`, `Stage3 Product ${slug}`],
    );
    await client.query(
      `INSERT INTO contract_types
        (id, code, name, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, true, NOW(), NOW())`,
      [ids.contractType, `STAGE3-AKAD-${slug}`, `Stage3 Contract Type ${slug}`],
    );
    await client.query(
      `INSERT INTO debtor_contracts
        (id, no_kontrak, debtor_id, product_id, akad_type_id, tanggal_akad, tenor,
         status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, DATE '2026-01-02', 12, 'ACTIVE', NOW(), NOW())`,
      [ids.contract, `STAGE3-CONTRACT-${slug}`, ids.debtor, ids.product, ids.contractType],
    );
    await client.query(
      `INSERT INTO debtor_collaterals
        (id, debtor_id, contract_id, collateral_number, period_month, description,
         created_at, updated_at)
       VALUES ($1, $2, $3, $4, '202601', $5, NOW(), NOW())`,
      [
        ids.collateral,
        ids.debtor,
        ids.contract,
        `STAGE3-COLLATERAL-${slug}`,
        `Stage3 collateral ${slug}`,
      ],
    );
    await client.query(
      `INSERT INTO legal_deposits
        (id, type, contract_id, nominal, paid_amount, processed_amount,
         remaining_amount, status, notes, created_at, updated_at)
       VALUES ($1, 'NOTARY', $2, 1000000, 1000000, 0, 1000000,
         'PENDING', $3, NOW(), NOW())`,
      [ids.deposit, ids.contract, `Stage3 deposit ${slug}`],
    );
    await client.query(
      `INSERT INTO legal_deposit_transactions
        (id, deposit_id, transaction_date, action, amount, notes, created_at)
       VALUES ($1, $2, DATE '2026-01-03', 'TITIPAN', 1000000,
         'Migrasi saldo awal dana titipan legacy.', NOW())`,
      [ids.transaction, ids.deposit],
    );
    await client.query(
      `INSERT INTO refresh_tokens
        (id, user_id, token_hash, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '1 day', NOW(), NOW())`,
      [ids.refreshToken, ids.user, `stage3-legacy-token-${slug}`],
    );
    await client.query("COMMIT");
    return ids;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function readLegacyFixture(databaseUrl, ids, includeUpgradeFields) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const core = await client.query(
      `SELECT
         r.name AS role_name,
         dv.name AS division_name,
         u.name AS user_name,
         u.username,
         d.name AS debtor_name,
         p.code AS product_code,
         ct.code AS contract_type_code,
         c.no_kontrak,
         dc.collateral_number,
         dc.period_month,
         ld.nominal::text AS deposit_nominal,
         ldt.notes AS transaction_notes,
         rt.token_hash
       FROM roles r
       JOIN divisions dv ON dv.id = $2
       JOIN users u ON u.id = $3 AND u.role_id = r.id AND u.division_id = dv.id
       JOIN digital_debtors d ON d.id = $4
       JOIN financing_products p ON p.id = $5
       JOIN contract_types ct ON ct.id = $6
       JOIN debtor_contracts c
         ON c.id = $7 AND c.debtor_id = d.id AND c.product_id = p.id AND c.akad_type_id = ct.id
       JOIN debtor_collaterals dc
         ON dc.id = $8 AND dc.debtor_id = d.id AND dc.contract_id = c.id
       JOIN legal_deposits ld ON ld.id = $9 AND ld.contract_id = c.id
       JOIN legal_deposit_transactions ldt
         ON ldt.id = $10 AND ldt.deposit_id = ld.id
       JOIN refresh_tokens rt ON rt.id = $11 AND rt.user_id = u.id
       WHERE r.id = $1`,
      Object.values(ids),
    );
    assert.equal(core.rowCount, 1, "Fixture legacy tidak dapat dibaca utuh.");
    if (!includeUpgradeFields) return core.rows[0];

    const upgrade = await client.query(
      `SELECT
         dc.has_expiry_date,
         dc.expiry_date,
         ldt.source,
         rt.replaced_by_token_id
       FROM debtor_collaterals dc
       JOIN legal_deposit_transactions ldt ON ldt.id = $2
       JOIN refresh_tokens rt ON rt.id = $3
       WHERE dc.id = $1`,
      [ids.collateral, ids.transaction, ids.refreshToken],
    );
    assert.equal(upgrade.rowCount, 1);
    return { core: core.rows[0], upgrade: upgrade.rows[0] };
  } finally {
    await client.end();
  }
}

async function schemaSnapshot(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const queries = {
      columns: `
        SELECT n.nspname AS schema_name, c.relname AS table_name, a.attnum,
          a.attname AS column_name,
          pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
          a.attnotnull AS not_null,
          COALESCE(pg_get_expr(ad.adbin, ad.adrelid), '') AS default_expression,
          a.attidentity, a.attgenerated
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY c.relname, a.attnum`,
      constraints: `
        SELECT c.relname AS table_name, con.conname AS constraint_name,
          con.contype AS constraint_type,
          pg_get_constraintdef(con.oid, true) AS definition
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
        ORDER BY c.relname, con.conname`,
      indexes: `
        SELECT tablename AS table_name, indexname AS index_name, indexdef AS definition
        FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY tablename, indexname`,
      rls: `
        SELECT c.relname AS table_name, c.relrowsecurity AS enabled,
          c.relforcerowsecurity AS forced
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        ORDER BY c.relname`,
      policies: `
        SELECT tablename AS table_name, policyname AS policy_name,
          permissive, roles::text AS roles, cmd, COALESCE(qual, '') AS using_expression,
          COALESCE(with_check, '') AS check_expression
        FROM pg_policies
        WHERE schemaname = 'public'
        ORDER BY tablename, policyname`,
      enums: `
        SELECT t.typname AS enum_name, e.enumsortorder, e.enumlabel
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
        ORDER BY t.typname, e.enumsortorder`,
    };
    const snapshot = {};
    for (const [key, sql] of Object.entries(queries)) {
      snapshot[key] = (await client.query(sql)).rows;
    }
    return snapshot;
  } finally {
    await client.end();
  }
}

function snapshotDigest(snapshot) {
  return crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

async function assertExpectedDatabaseObjects(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const indexes = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY($1::text[])
      ORDER BY indexname
    `, [["legal_deposit_transactions_source_idx", "refresh_tokens_replaced_by_token_id_idx"]]);
    assert.deepEqual(indexes.rows.map((row) => row.indexname), [
      "legal_deposit_transactions_source_idx",
      "refresh_tokens_replaced_by_token_id_idx",
    ]);

    const constraints = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
    `);
    assert.ok(constraints.rows[0].count > 0, "Constraint final tidak ditemukan.");

    const rls = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relrowsecurity AND c.relforcerowsecurity
    `);
    assert.ok(rls.rows[0].count > 0, "Tidak ada tabel FORCE ROW LEVEL SECURITY.");
  } finally {
    await client.end();
  }
}

function parsePassedJson(output, description) {
  for (const line of String(output).split(/\r?\n/).reverse()) {
    try {
      const value = JSON.parse(line);
      if (value && value.status === "passed") return value;
    } catch {
      // Bukan baris JSON hasil; lanjutkan mencari baris hasil berikutnya.
    }
  }
  throw new Error(`${description} tidak menghasilkan bukti JSON status=passed.`);
}

function runSeedAndRls(databaseUrl) {
  const sharedEnv = {
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    MIGRATION_DATABASE_URL: databaseUrl,
    RLS_VERIFY_DATABASE_URL: databaseUrl,
  };
  runCommand(process.execPath, [path.join(ROOT_DIR, "prisma", "seed-system.js")], sharedEnv, "Seed system");
  const rlsOutput = runCommand(
    process.execPath,
    [path.join(ROOT_DIR, "scripts", "verify-rls-isolation.js")],
    sharedEnv,
    "Verifikasi RLS",
  );
  const evidence = parsePassedJson(rlsOutput, "Verifikasi RLS");
  assert.equal(evidence.rollback, true, "Verifikasi RLS tidak melakukan rollback.");
  assert.ok(evidence.tables_verified.length > 0, "Tidak ada tabel RLS yang diverifikasi.");
  return evidence.tables_verified.length;
}

async function createLeastPrivilegeLogin(adminClient, roleName, password) {
  const existing = await adminClient.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [roleName]);
  assert.equal(existing.rowCount, 0, `Role disposable ${roleName} sudah ada.`);
  await adminClient.query(
    `CREATE ROLE ${quoteIdentifier(roleName)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
  );
  await adminClient.query(`GRANT ${quoteIdentifier(CI_RUNTIME_ROLE)} TO ${quoteIdentifier(roleName)}`);
}

async function verifyLeastPrivilegeLogin(adminUrl, databaseName, roleName, password) {
  const client = new Client({
    connectionString: databaseUrlFor(adminUrl, databaseName, {
      username: roleName,
      password,
    }),
  });
  await client.connect();
  try {
    const login = await client.query(`
      SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
      FROM pg_roles WHERE rolname = current_user
    `);
    assert.deepEqual(login.rows[0], {
      rolcanlogin: true,
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
    await client.query(`SET ROLE ${quoteIdentifier(CI_RUNTIME_ROLE)}`);
    const runtimeRole = await client.query(`
      SELECT current_user, rolcanlogin, rolsuper, rolbypassrls
      FROM pg_roles WHERE rolname = current_user
    `);
    assert.deepEqual(runtimeRole.rows[0], {
      current_user: CI_RUNTIME_ROLE,
      rolcanlogin: false,
      rolsuper: false,
      rolbypassrls: false,
    });
    const invisible = await client.query("SELECT COUNT(*)::int AS count FROM sj_publications");
    assert.equal(invisible.rows[0].count, 0, "Role tanpa scope melihat publikasi.");
  } finally {
    await client.end();
  }
}

async function assertClusterRoleSafety(adminClient) {
  const result = await adminClient.query(
    `SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
     FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname`,
    [[CI_RUNTIME_ROLE, CI_SEPUTAR_JAMINAN_WORKER_ROLE]],
  );
  assert.equal(result.rowCount, 2);
  for (const role of result.rows) {
    assert.equal(role.rolcanlogin, false);
    assert.equal(role.rolsuper, false);
    assert.equal(role.rolbypassrls, false);
    assert.equal(role.rolcreatedb, false);
    assert.equal(role.rolcreaterole, false);
  }
}

async function createDatabase(adminClient, databaseName) {
  const existing = await adminClient.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
  assert.equal(existing.rowCount, 0, `Database disposable ${databaseName} sudah ada; runner menolak menimpanya.`);
  await adminClient.query(`CREATE DATABASE ${quoteIdentifier(databaseName)} TEMPLATE template0 ENCODING 'UTF8'`);
}

async function dropDatabase(adminClient, databaseName) {
  await adminClient.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [databaseName],
  );
  await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
}

async function run() {
  const safe = assertSafeAdminDatabase();
  const migrations = listMigrations();
  assertMigrationSourceImmutable();
  const initialManifest = migrationSourceManifest(migrations);
  const manifestDigest = snapshotDigest(initialManifest);
  const adminClient = new Client({ connectionString: safe.databaseUrl.toString() });
  const createdDatabases = [];
  const createdRoles = [];
  const tempDirectories = [];

  await adminClient.connect();
  try {
    const identity = await adminClient.query(
      "SELECT current_database() AS database_name, rolsuper FROM pg_roles WHERE rolname = current_user",
    );
    assert.equal(identity.rows[0].database_name, REQUIRED_ADMIN_DATABASE);
    assert.equal(identity.rows[0].rolsuper, true, "Runner memerlukan superuser disposable untuk CREATE DATABASE/ROLE.");

    await provisionCiRuntimeRole({
      CI: "true",
      MIGRATION_DATABASE_URL: safe.databaseUrl.toString(),
    });
    await assertClusterRoleSafety(adminClient);

    const referenceName = DATABASE_NAMES.reference;
    await createDatabase(adminClient, referenceName);
    createdDatabases.push(referenceName);
    const referenceUrl = databaseUrlFor(safe.databaseUrl, referenceName);
    const referenceBundle = createMigrationBundle(migrations, FINAL_MIGRATION_COUNT);
    tempDirectories.push(referenceBundle.bundleRoot);
    runPrisma(referenceBundle.prismaConfigPath, referenceUrl, "deploy");
    const referenceStatus = runPrisma(referenceBundle.prismaConfigPath, referenceUrl, "status");
    assert.match(referenceStatus, /Database schema is up to date/i);
    await assertAppliedMigrations(referenceUrl, initialManifest);
    await assertExpectedDatabaseObjects(referenceUrl);
    const referenceSnapshot = await schemaSnapshot(referenceUrl);
    const referenceSchemaDigest = snapshotDigest(referenceSnapshot);

    const results = [];
    for (let index = 0; index < UPGRADE_PATHS.length; index += 1) {
      const definition = UPGRADE_PATHS[index];
      const databaseName = DATABASE_NAMES[definition.key];
      await createDatabase(adminClient, databaseName);
      createdDatabases.push(databaseName);
      const databaseUrl = databaseUrlFor(safe.databaseUrl, databaseName);
      const bundle = createMigrationBundle(migrations, definition.baseline);
      tempDirectories.push(bundle.bundleRoot);

      runPrisma(bundle.prismaConfigPath, databaseUrl, "deploy");
      await assertAppliedMigrations(databaseUrl, initialManifest.slice(0, definition.baseline));
      const ids = await seedLegacyFixture(databaseUrl, definition, index + 1);
      const legacyBefore = await readLegacyFixture(databaseUrl, ids, false);

      copyMigrations(
        migrations,
        bundle.bundleMigrations,
        definition.baseline,
        FINAL_MIGRATION_COUNT,
      );
      runPrisma(bundle.prismaConfigPath, databaseUrl, "deploy");
      const status = runPrisma(bundle.prismaConfigPath, databaseUrl, "status");
      assert.match(status, /Database schema is up to date/i);
      await assertAppliedMigrations(databaseUrl, initialManifest);

      const legacyAfter = await readLegacyFixture(databaseUrl, ids, true);
      assert.deepEqual(legacyAfter.core, legacyBefore, "Data legacy berubah setelah upgrade.");
      assert.equal(legacyAfter.upgrade.has_expiry_date, false);
      assert.equal(legacyAfter.upgrade.expiry_date, null);
      assert.equal(legacyAfter.upgrade.source, "LEGACY_MIGRATION");
      assert.equal(legacyAfter.upgrade.replaced_by_token_id, null);

      await assertExpectedDatabaseObjects(databaseUrl);
      const upgradedSnapshot = await schemaSnapshot(databaseUrl);
      assert.deepEqual(
        upgradedSnapshot,
        referenceSnapshot,
        `${definition.label}: schema final berbeda dari instalasi bersih 1-${FINAL_MIGRATION_COUNT}.`,
      );

      const verifiedRlsTables = runSeedAndRls(databaseUrl);
      const loginRole = `ruwang_stage3_${definition.key}_login`;
      const loginPassword = crypto.randomBytes(24).toString("hex");
      createdRoles.push(loginRole);
      await createLeastPrivilegeLogin(adminClient, loginRole, loginPassword);
      await verifyLeastPrivilegeLogin(safe.databaseUrl, databaseName, loginRole, loginPassword);

      runPrisma(bundle.prismaConfigPath, databaseUrl, "deploy");
      const repeatedStatus = runPrisma(bundle.prismaConfigPath, databaseUrl, "status");
      assert.match(repeatedStatus, /Database schema is up to date/i);
      await assertAppliedMigrations(databaseUrl, initialManifest);
      const legacyRepeated = await readLegacyFixture(databaseUrl, ids, true);
      assert.deepEqual(legacyRepeated, legacyAfter, "Data legacy berubah pada pengulangan deploy.");

      results.push({
        path: definition.label,
        baseline_migrations: definition.baseline,
        applied_migrations: FINAL_MIGRATION_COUNT - definition.baseline,
        final_migrations: FINAL_MIGRATION_COUNT,
        migration_status: "clean",
        legacy_data: "preserved",
        schema_matches_fresh_install: true,
        least_privilege_login: "passed",
        rls_cross_scope: "denied",
        rls_tables_verified: verifiedRlsTables,
        idempotent_redeploy: "passed",
      });
    }

    assert.equal(
      snapshotDigest(migrationSourceManifest(migrations)),
      manifestDigest,
      "Migration source berubah selama pengujian.",
    );
    assertMigrationSourceImmutable();

    process.stdout.write(
      `${JSON.stringify(
        {
          status: "passed",
          migration_source: "unchanged_from_HEAD",
          migration_manifest_sha256: manifestDigest,
          reference_schema_sha256: referenceSchemaDigest,
          paths: results,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    for (const databaseName of createdDatabases.reverse()) {
      await dropDatabase(adminClient, databaseName).catch(() => {});
    }
    for (const roleName of createdRoles.reverse()) {
      await adminClient.query(`DROP ROLE IF EXISTS ${quoteIdentifier(roleName)}`).catch(() => {});
    }
    await adminClient.end().catch(() => {});
    for (const tempDirectory of tempDirectories) {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(
      JSON.stringify({
        status: "failed",
        reason: error instanceof Error ? sanitizeOutput(error.message) : "unknown_error",
      }),
    );
    process.exitCode = 1;
  });
}

module.exports = {
  DATABASE_NAMES,
  FINAL_MIGRATION_COUNT,
  REQUIRED_ADMIN_DATABASE,
  UPGRADE_PATHS,
  assertSafeAdminDatabase,
  fixtureIds,
  snapshotDigest,
};
