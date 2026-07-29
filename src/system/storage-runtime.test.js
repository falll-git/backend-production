const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  evaluateStorageCapacity,
  validateStoragePathSafety,
} = require("./storage-runtime");

test("production menolak storage di dalam folder source dan menerima root terpisah", () => {
  const cwd = path.resolve("project", "backend");
  const unsafe = validateStoragePathSafety({
    cwd,
    uploadRoot: path.join(cwd, "uploads"),
    tempRoot: path.join(cwd, "uploads", "tmp"),
    nodeEnv: "production",
  });
  const safe = validateStoragePathSafety({
    cwd,
    uploadRoot: path.resolve("persistent", "uploads"),
    tempRoot: path.resolve("persistent", "uploads", "tmp"),
    nodeEnv: "production",
  });

  assert.equal(unsafe.safe, false);
  assert.match(unsafe.errors.join(" "), /di luar folder source/);
  assert.equal(safe.safe, true);
});

test("kapasitas dan inode dievaluasi terhadap threshold terkonfigurasi", () => {
  const result = evaluateStorageCapacity(
    {
      free_bytes: 900,
      total_bytes: 10_000,
      free_percent: 9,
      free_inodes: 50,
      total_inodes: 1_000,
    },
    {
      minimumFreeBytes: 1_000,
      minimumFreePercent: 10,
      minimumFreeInodes: 100,
    },
  );

  assert.equal(result.healthy, false);
  assert.deepEqual(result.failures, ["free_bytes", "free_percent", "free_inodes"]);
});
