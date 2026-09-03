const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  validateBackendProductionEnvironment,
} = require("./production-contract");

function productionFixture(overrides = {}) {
  const target = "db.internal:5432/ruwang_demo?schema=public";
  return {
    DATABASE_URL: `postgresql://ruwang_arsip_app:runtime-pass@${target}`,
    DATABASE_SYSTEM_URL: `postgresql://ruwang_arsip_system:system-pass@${target}`,
    MIGRATION_DATABASE_URL: `postgresql://ruwang_arsip_migration:migration-pass@${target}`,
    SJ_WORKER_DATABASE_URL: `postgresql://ruwang_arsip_sj_worker:worker-pass@${target}`,
    DATABASE_RUNTIME_ROLE: "ruwang_arsip_app",
    DATABASE_SYSTEM_ROLE: "ruwang_arsip_system",
    RUWANG_DEPLOY_ROOT: path.resolve("D:/srv/ruwang/demoruwangarsip"),
    UPLOAD_DIR: path.resolve("D:/var/lib/ruwang-arsip/demoruwangarsip/uploads"),
    UPLOAD_TEMP_DIR: path.resolve("D:/var/lib/ruwang-arsip/demoruwangarsip/uploads/tmp"),
    SJ_MEDIA_STORAGE_PROVIDER: "FILESYSTEM",
    SJ_MEDIA_FILESYSTEM_ROOT: path.resolve(
      "D:/var/lib/ruwang-arsip/demoruwangarsip/seputar-jaminan-public",
    ),
    ...overrides,
  };
}

test("kontrak production menerima empat credential terpisah dan storage persistent", () => {
  const result = validateBackendProductionEnvironment(productionFixture(), {
    repositoryRoot: path.resolve("D:/srv/ruwang/demoruwangarsip/current/backend"),
    requireMigration: true,
  });
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("kontrak production menolak credential atau user database yang dipakai ulang", () => {
  const fixture = productionFixture();
  const result = validateBackendProductionEnvironment(
    productionFixture({ SJ_WORKER_DATABASE_URL: fixture.DATABASE_SYSTEM_URL }),
    { requireMigration: true },
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /credential database/i);
  assert.match(result.errors.join("\n"), /User database/i);
});

test("kontrak production menolak runtime superuser dan target database tertukar", () => {
  const result = validateBackendProductionEnvironment(
    productionFixture({
      DATABASE_URL:
        "postgresql://postgres:runtime-pass@db.internal:5432/ruwang_demo?schema=public",
      SJ_WORKER_DATABASE_URL:
        "postgresql://ruwang_arsip_sj_worker:worker-pass@db.internal:5432/bank_lain?schema=public",
      DATABASE_RUNTIME_ROLE: "postgres",
    }),
    { requireMigration: true },
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /database instalasi BPRS yang sama/);
  assert.match(result.errors.join("\n"), /superuser/);
});

test("kontrak production menolak role yang tidak sama dengan user URL", () => {
  const result = validateBackendProductionEnvironment(
    productionFixture({ DATABASE_RUNTIME_ROLE: "role_lain" }),
    { requireMigration: true },
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /DATABASE_RUNTIME_ROLE/);
});

test("kontrak production menolak storage di dalam release", () => {
  const deployRoot = path.resolve("D:/srv/ruwang/demoruwangarsip");
  const result = validateBackendProductionEnvironment(
    productionFixture({
      RUWANG_DEPLOY_ROOT: deployRoot,
      UPLOAD_DIR: path.join(deployRoot, "current", "backend", "uploads"),
    }),
    {
      repositoryRoot: path.join(deployRoot, "current", "backend"),
      requireMigration: true,
    },
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /UPLOAD_DIR wajib berada di luar/);
});

test("runtime tidak dipaksa membawa credential migration", () => {
  const fixture = productionFixture();
  delete fixture.MIGRATION_DATABASE_URL;
  const result = validateBackendProductionEnvironment(fixture, {
    requireMigration: false,
  });
  assert.equal(result.valid, true);
});

test("template production mendokumentasikan seluruh guard tanpa secret asli", () => {
  const repositoryRoot = path.resolve(__dirname, "..", "..");
  const envSource = fs.readFileSync(
    path.join(repositoryRoot, ".env.example"),
    "utf8",
  );
  const migrationSource = fs.readFileSync(
    path.join(
      repositoryRoot,
      "prisma",
      "migrations",
      "20260822110000_add_seputar_jaminan_module",
      "migration.sql",
    ),
    "utf8",
  );
  for (const expected of [
    "RUWANG_DEPLOY_ROOT=/srv/ruwang/<domain_slug>",
    "DATABASE_URL=postgresql://ruwang_arsip_app:",
    "DATABASE_SYSTEM_URL=postgresql://ruwang_arsip_system:",
    "MIGRATION_DATABASE_URL=postgresql://ruwang_arsip_migration:",
    "SJ_WORKER_DATABASE_URL=postgresql://ruwang_arsip_sj_worker:",
    "DB_REQUIRE_LEAST_PRIVILEGE=true",
    "DB_REQUIRE_RLS=true",
    "RATE_LIMIT_STORE=redis",
    "WORKER_HEARTBEAT_KEY_PREFIX=ruwang-arsip:<domain_slug>:worker-heartbeat",
    "SJ_MEDIA_STORAGE_PROVIDER=FILESYSTEM",
    "SJ_MEDIA_S3_ENDPOINT=",
    "SJ_INTEGRATION_PRIVATE_KEY=",
  ]) {
    assert.match(envSource, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const column of [
    "module_visible",
    "draft_enabled",
    "review_enabled",
    "sync_enabled",
    "publish_enabled",
    "filesystem_upload_enabled",
    "s3_upload_enabled",
  ]) {
    assert.match(
      migrationSource,
      new RegExp(`"${column}" BOOLEAN NOT NULL DEFAULT false`),
    );
  }
  assert.doesNotMatch(envSource, /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/);
  assert.doesNotMatch(envSource, /(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/);
});
