const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_STORAGE_SEED,
  resolveStorageSeedConfig,
} = require("./storage-seed.config");

test("storage seed mempertahankan default lama ketika konfigurasi instance kosong", () => {
  assert.deepEqual(resolveStorageSeedConfig({}), DEFAULT_STORAGE_SEED);
  assert.deepEqual(
    resolveStorageSeedConfig({
      SEED_STORAGE_OFFICE_CODE: "   ",
      SEED_STORAGE_OFFICE_NAME: "   ",
    }),
    DEFAULT_STORAGE_SEED,
  );
});

test("storage seed memakai identitas kantor milik instance", () => {
  assert.deepEqual(
    resolveStorageSeedConfig({
      SEED_STORAGE_OFFICE_CODE: "  KPBTB  ",
      SEED_STORAGE_OFFICE_NAME: "  BPRS Bogor Tegar Beriman  ",
    }),
    {
      officeCode: "KPBTB",
      officeName: "BPRS Bogor Tegar Beriman",
    },
  );
});
