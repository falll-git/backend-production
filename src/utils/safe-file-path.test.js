const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  normalizeStorageEntity,
  resolvePathInsideRoot,
} = require("./safe-file-path");

test("path storage sah selalu berada di dalam root", () => {
  const root = path.resolve("storage-test-root");
  assert.equal(
    resolvePathInsideRoot(root, "legal", "claims", "2026", "07", "file.pdf"),
    path.join(root, "legal", "claims", "2026", "07", "file.pdf"),
  );
  assert.deepEqual(normalizeStorageEntity("legal/claims"), ["legal", "claims"]);
});

test("path traversal, absolute path, dan segmen ambigu ditolak", () => {
  const root = path.resolve("storage-test-root");
  for (const segments of [
    ["..", "secret"],
    [".", "secret"],
    ["legal/../../secret"],
    ["legal\\..\\secret"],
    ["legal", ""],
    ["C:\\Windows"],
  ]) {
    assert.equal(resolvePathInsideRoot(root, ...segments), null);
  }

  assert.equal(normalizeStorageEntity("../secret"), null);
  assert.equal(normalizeStorageEntity("legal//claims"), null);
  assert.equal(normalizeStorageEntity("legal\\claims"), null);
});
