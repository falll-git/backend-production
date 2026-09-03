const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DATABASE_NAMES,
  FINAL_MIGRATION_COUNT,
  REQUIRED_ADMIN_DATABASE,
  UPGRADE_PATHS,
  assertSafeAdminDatabase,
  fixtureIds,
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
  assert.equal(FINAL_MIGRATION_COUNT, 130);
  assert.deepEqual(Object.keys(DATABASE_NAMES), [
    "reference",
    "demo",
    "arthamadani",
    "bogor",
    "riyal_risyadi",
  ]);
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
