const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getMenuCapabilities,
  getMenuFeatures,
} = require("./menu-access");

const ROOT = "/dashboard/seputar-jaminan";

test("parent Seputar Jaminan tidak dapat diberi izin langsung", () => {
  assert.deepEqual(getMenuCapabilities(ROOT), []);
});

test("lima child Seputar Jaminan mempunyai capability terpisah", () => {
  assert.deepEqual(getMenuCapabilities(`${ROOT}/ringkasan`), ["read", "update"]);
  assert.deepEqual(getMenuCapabilities(`${ROOT}/profil`), ["create", "read", "update"]);
  assert.deepEqual(getMenuCapabilities(`${ROOT}/kontak`), ["create", "read", "update"]);
  assert.deepEqual(getMenuCapabilities(`${ROOT}/publikasi`), ["create", "read", "update"]);
  assert.deepEqual(getMenuCapabilities(`${ROOT}/pengajuan`), ["read", "update"]);
});

test("fitur keputusan lama hanya tersedia pada child Pengajuan", () => {
  assert.deepEqual(getMenuFeatures(ROOT), []);
  assert.deepEqual(getMenuFeatures(`${ROOT}/profil`), []);
  assert.ok(getMenuFeatures(`${ROOT}/pengajuan`).includes("sj_review"));
  assert.ok(getMenuFeatures(`${ROOT}/pengajuan`).includes("sj_publish"));
});
