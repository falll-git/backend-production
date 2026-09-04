const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  loadMigrationEnvironment,
  readMigrationEnvironmentFile,
  resolveMigrationEnvironmentFile,
} = require("./production-preflight");

function withTemporaryDirectory(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ruwang-preflight-"));
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("preflight memuat pointer MIGRATION_DATABASE_URL_FILE dari env terpisah", () => {
  withTemporaryDirectory((root) => {
    const migrationEnv = path.join(root, "migration.env");
    const databaseSecret = path.join(root, "migration-url");
    fs.writeFileSync(databaseSecret, "postgresql://migration-user:secret@localhost/db\n");
    fs.writeFileSync(
      migrationEnv,
      `MIGRATION_DATABASE_URL_FILE=${databaseSecret}\n`,
    );

    const env = {};
    loadMigrationEnvironment(migrationEnv, env);

    assert.equal(env.MIGRATION_DATABASE_URL_FILE, databaseSecret);
    assert.equal(env.MIGRATION_DATABASE_URL, undefined);
    assert.deepEqual(readMigrationEnvironmentFile(migrationEnv), {
      MIGRATION_DATABASE_URL_FILE: databaseSecret,
    });
  });
});

test("preflight menolak environment migrasi relatif atau konflik", () => {
  withTemporaryDirectory((root) => {
    const migrationEnv = path.join(root, "migration.env");
    fs.writeFileSync(migrationEnv, "MIGRATION_DATABASE_URL_FILE=/tmp/migration-url\n");

    assert.throws(
      () => readMigrationEnvironmentFile("migration.env"),
      /absolute path/,
    );
    assert.throws(
      () =>
        loadMigrationEnvironment(migrationEnv, {
          MIGRATION_DATABASE_URL_FILE: "/different/path",
        }),
      /terisi berbeda/,
    );
  });
});

test("preflight otomatis mencari migration.env di shared deployment", () => {
  withTemporaryDirectory((root) => {
    const deployRoot = path.join(root, "deployment");
    const migrationEnv = path.join(deployRoot, "shared", "env", "migration.env");
    fs.mkdirSync(path.dirname(migrationEnv), { recursive: true });
    fs.writeFileSync(migrationEnv, "MIGRATION_DATABASE_URL_FILE=/tmp/migration-url\n");

    assert.equal(
      resolveMigrationEnvironmentFile({ }, { RUWANG_DEPLOY_ROOT: deployRoot }),
      migrationEnv,
    );
    assert.equal(
      resolveMigrationEnvironmentFile(
        { "migration-env-file": "/explicit/migration.env" },
        { RUWANG_DEPLOY_ROOT: deployRoot },
      ),
      "/explicit/migration.env",
    );
  });
});
