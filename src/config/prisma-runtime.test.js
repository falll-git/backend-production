const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isWorkerRuntime,
  resolveRuntimeDatabase,
} = require("./prisma-runtime");

test("hanya proses worker yang memakai koneksi sistem terpisah", () => {
  assert.equal(isWorkerRuntime("api"), false);
  assert.equal(isWorkerRuntime("slik-import-worker"), true);
  assert.equal(isWorkerRuntime("watermark-worker"), true);

  assert.deepEqual(
    resolveRuntimeDatabase({
      RUNTIME_ROLE: "api",
      DATABASE_URL: "postgresql://app/database",
      DATABASE_SYSTEM_URL: "postgresql://system/database",
    }),
    {
      connectionString: "postgresql://app/database",
      usesSystemDatabase: false,
    },
  );
  assert.deepEqual(
    resolveRuntimeDatabase({
      RUNTIME_ROLE: "slik-import-worker",
      DATABASE_URL: "postgresql://app/database",
      DATABASE_SYSTEM_URL: "postgresql://system/database",
    }),
    {
      connectionString: "postgresql://system/database",
      usesSystemDatabase: true,
    },
  );
});

test("worker tetap memakai koneksi runtime jika URL sistem belum berbeda", () => {
  assert.deepEqual(
    resolveRuntimeDatabase({
      RUNTIME_ROLE: "watermark-worker",
      DATABASE_URL: "postgresql://same/database",
      DATABASE_SYSTEM_URL: "postgresql://same/database",
    }),
    {
      connectionString: "postgresql://same/database",
      usesSystemDatabase: false,
    },
  );
});
