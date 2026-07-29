const fs = require("fs");
const path = require("path");

const PUBLIC_PREFIX = "/api/watermarked-files";
const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(process.cwd(), "storage");
const STORAGE_ROOT = path.join(UPLOAD_ROOT, "watermarked-files");

function resolveWatermarkedFilePath(storedPath) {
  if (
    typeof storedPath !== "string" ||
    !storedPath.startsWith(`${PUBLIC_PREFIX}/`)
  ) {
    return null;
  }
  const relative = storedPath
    .slice(PUBLIC_PREFIX.length + 1)
    .split("/")
    .filter(Boolean);
  if (relative.length === 0) return null;
  const resolved = path.resolve(STORAGE_ROOT, ...relative);
  const rootWithSeparator = `${path.resolve(STORAGE_ROOT)}${path.sep}`;
  return resolved.startsWith(rootWithSeparator) ? resolved : null;
}

function deleteWatermarkedFile(storedPath) {
  const resolved = resolveWatermarkedFilePath(storedPath);
  if (!resolved || !fs.existsSync(resolved)) return;
  try {
    fs.unlinkSync(resolved);
  } catch {}
}

module.exports = {
  PUBLIC_PREFIX,
  STORAGE_ROOT,
  deleteWatermarkedFile,
  resolveWatermarkedFilePath,
};
