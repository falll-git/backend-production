const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const path = require("node:path");

const {
  DATABASE_NAMES,
  FINAL_MIGRATION_COUNT,
  REQUIRED_ADMIN_DATABASE,
  UPGRADE_PATHS,
  assertSafeAdminDatabase,
  assertUntrackedMigrationFilesSafe,
  fixtureIds,
  listMigrations,
  snapshotDigest,
} = require("./verify-migration-upgrade-paths");

const safeEnv = {
  MIGRATION_PATH_TEST_ALLOW: "true",
  MIGRATION_PATH_TEST_ADMIN_URL:
    "postgresql://postgres:test@127.0.0.1:55434/ruwang_migration_test_admin?schema=public",
};

test("migration path runner mengunci empat baseline VPS yang diaudit", () => {
  assert.deepEqual(
    UPGRADE_PATHS.map(({ key, baseline }) => [key, baseline]),
    [
      ["demo", 105],
      ["arthamadani", 85],
      ["bogor", 85],
      ["riyal_risyadi", 86],
    ],
  );
  assert.equal(FINAL_MIGRATION_COUNT, 149);
  assert.deepEqual(Object.keys(DATABASE_NAMES), [
    "reference",
    "demo",
    "arthamadani",
    "bogor",
    "riyal_risyadi",
  ]);
});

test("migration count contract matches all current migration.sql files", () => {
  const migrations = listMigrations();
  assert.equal(migrations.length, 149);
  assert.equal(new Set(migrations).size, 149);
  assert.deepEqual(migrations, [...migrations].sort());
  assert.equal(migrations.at(-1), "20261020090000_fix_debtor_create_returning_rls");
});

function listWithReadOnlyFilesystem(count, hasSql = true) {
  const entries = Array.from({ length: count }, (_, index) => ({
    name: `migration_${String(index).padStart(3, "0")}`,
    isDirectory: () => true,
  }));
  return vm.runInNewContext(`(${listMigrations.toString()})()`, {
    assert,
    path,
    MIGRATIONS_DIR: "read-only-migration-fixture",
    FINAL_MIGRATION_COUNT,
    fs: { readdirSync: () => entries, existsSync: () => hasSql },
  }, { timeout: 1000 });
}

for (const count of [148, 150]) {
  test(`migration count contract rejects ${count} directories`, () => {
    assert.throws(() => listWithReadOnlyFilesystem(count), /tepat 149 migration/);
  });
}

test("migration count contract still rejects missing migration.sql", () => {
  assert.throws(() => listWithReadOnlyFilesystem(149, false), /migration.sql tidak ditemukan/);
});

test("migration path runner menerima hanya database admin disposable loopback", () => {
  const safe = assertSafeAdminDatabase(safeEnv);
  assert.equal(safe.hostname, "127.0.0.1");
  assert.equal(safe.databaseName, REQUIRED_ADMIN_DATABASE);
});

test("migration path runner menolak eksekusi tanpa opt-in eksplisit", () => {
  assert.throws(
    () => assertSafeAdminDatabase({ ...safeEnv, MIGRATION_PATH_TEST_ALLOW: "false" }),
    /MIGRATION_PATH_TEST_ALLOW=true/,
  );
});

test("migration path runner menolak host non-loopback dan database selain admin test", () => {
  assert.throws(
    () =>
      assertSafeAdminDatabase({
        ...safeEnv,
        MIGRATION_PATH_TEST_ADMIN_URL:
          "postgresql://postgres:test@database.internal:5432/ruwang_migration_test_admin",
      }),
    /host wajib loopback/,
  );
  assert.throws(
    () =>
      assertSafeAdminDatabase({
        ...safeEnv,
        MIGRATION_PATH_TEST_ADMIN_URL:
          "postgresql://postgres:test@127.0.0.1:5432/ruwang_arsip",
      }),
    /database wajib ruwang_migration_test_admin/,
  );
});

test("fixture ID dan digest bersifat deterministik", () => {
  assert.deepEqual(fixtureIds(2), fixtureIds(2));
  assert.notDeepEqual(fixtureIds(2), fixtureIds(3));
  assert.equal(snapshotDigest({ stable: true }), snapshotDigest({ stable: true }));
  assert.notEqual(snapshotDigest({ stable: true }), snapshotDigest({ stable: false }));
});

test("opt-in untracked hanya menerima migration baru dengan bentuk Prisma yang tepat", () => {
  const valid = "prisma/migrations/20260911100000_align_navigation/migration.sql";
  assert.doesNotThrow(() => assertUntrackedMigrationFilesSafe(valid, true));
  assert.throws(
    () => assertUntrackedMigrationFilesSafe(valid, false),
    /opt-in pra-commit/,
  );
  assert.throws(
    () => assertUntrackedMigrationFilesSafe("prisma/migrations/catatan.txt", true),
    /tidak diizinkan/,
  );
});
