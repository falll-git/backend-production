const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CI_RUNTIME_ROLE,
  assertSafeCiMigrationDatabase,
  provisionCiRuntimeRole,
} = require("./provision-ci-runtime-role");

const safeEnv = {
  CI: "true",
  MIGRATION_DATABASE_URL:
    "postgresql://postgres:postgres@127.0.0.1:5432/ruwang_arsip_ci?schema=public",
};

test("provisioning role menerima database CI loopback", () => {
  const result = assertSafeCiMigrationDatabase(safeEnv);
  assert.equal(result.databaseName, "ruwang_arsip_ci");
  assert.equal(result.hostname, "127.0.0.1");
});

test("provisioning role menerima service PostgreSQL hanya di GitHub Actions", () => {
  const result = assertSafeCiMigrationDatabase({
    CI: "true",
    GITHUB_ACTIONS: "true",
    MIGRATION_DATABASE_URL:
      "postgresql://postgres:postgres@postgres:5432/ruwang_arsip_ci?schema=public",
  });
  assert.equal(result.hostname, "postgres");
});

test("provisioning role menolak proses di luar CI", () => {
  assert.throws(
    () => assertSafeCiMigrationDatabase({ ...safeEnv, CI: "false" }),
    /CI=true/,
  );
});

test("provisioning role menolak host non-CI dan nama database production", () => {
  assert.throws(
    () =>
      assertSafeCiMigrationDatabase({
        CI: "true",
        MIGRATION_DATABASE_URL:
          "postgresql://migration@example.internal:5432/ruwang_arsip",
      }),
    /database wajib loopback/,
  );
});

test("provisioning membuat role least-privilege secara idempotent", async () => {
  const calls = [];
  class FakeClient {
    constructor(options) {
      calls.push(["constructor", options]);
    }

    async connect() {
      calls.push(["connect"]);
    }

    async query(sql) {
      calls.push(["query", sql]);
    }

    async end() {
      calls.push(["end"]);
    }
  }

  const result = await provisionCiRuntimeRole(safeEnv, FakeClient);
  const sql = calls.find(([name]) => name === "query")[1];

  assert.equal(result.runtime_role, CI_RUNTIME_ROLE);
  assert.match(sql, /IF NOT EXISTS[\s\S]*?rolname = 'ruwang_arsip_app'/i);
  assert.match(sql, /CREATE ROLE ruwang_arsip_app[\s\S]*?NOLOGIN/i);
  assert.match(sql, /NOSUPERUSER/i);
  assert.match(sql, /NOBYPASSRLS/i);
  assert.match(sql, /NOCREATEDB/i);
  assert.match(sql, /NOCREATEROLE/i);
  assert.deepEqual(calls.at(-1), ["end"]);
});
