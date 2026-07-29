const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ruwang-temp-cleanup-"));
process.env.UPLOAD_DIR = root;
process.env.UPLOAD_TEMP_DIR = path.join(root, "tmp", "uploads");

const {
  markUploadTempPathActive,
  releaseUploadTempPath,
} = require("../utils/upload-temp-files");
const {
  cleanupExpiredUploadTempFiles,
} = require("./temporary-file-cleanup");

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function createTempFile(name, ageMs) {
  fs.mkdirSync(process.env.UPLOAD_TEMP_DIR, { recursive: true });
  const filePath = path.join(process.env.UPLOAD_TEMP_DIR, name);
  fs.writeFileSync(filePath, name);
  const modified = new Date(Date.now() - ageMs);
  fs.utimesSync(filePath, modified, modified);
  return filePath;
}

test("cleanup temporary file mendukung dry-run dan melindungi file aktif", async () => {
  const ttlMs = 60_000;
  const expired = createTempFile("expired.tmp", ttlMs * 2);
  const active = createTempFile("active.tmp", ttlMs * 2);
  const fresh = createTempFile("fresh.tmp", ttlMs / 2);
  markUploadTempPathActive(active);

  const dryRun = await cleanupExpiredUploadTempFiles({ dryRun: true, ttlMs });
  assert.equal(dryRun.expired, 1);
  assert.equal(dryRun.protected, 1);
  assert.equal(dryRun.deleted, 0);
  assert.equal(fs.existsSync(expired), true);

  const applied = await cleanupExpiredUploadTempFiles({ dryRun: false, ttlMs });
  assert.equal(applied.deleted, 1);
  assert.equal(fs.existsSync(expired), false);
  assert.equal(fs.existsSync(active), true);
  assert.equal(fs.existsSync(fresh), true);
  releaseUploadTempPath(active);
});
