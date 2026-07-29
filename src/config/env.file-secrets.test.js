const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { hydrateFileBackedEnv } = require("./env");

test("file-backed secret diambil tanpa mencetak nilainya", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ruwang-arsip-secret-"));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const secretFile = path.join(directory, "jwt-secret");
  fs.writeFileSync(secretFile, "nilai-rahasia-dari-file\n", "utf8");
  const env = {
    NODE_ENV: "test",
    JWT_SECRET_FILE: secretFile,
  };

  hydrateFileBackedEnv(env);
  assert.equal(env.JWT_SECRET, "nilai-rahasia-dari-file");
});

test("nilai langsung dan file untuk secret yang sama ditolak", () => {
  assert.throws(
    () =>
      hydrateFileBackedEnv({
        JWT_SECRET: "nilai-langsung",
        JWT_SECRET_FILE: "ignored",
      }),
    /tidak boleh diisi bersamaan/,
  );
});
