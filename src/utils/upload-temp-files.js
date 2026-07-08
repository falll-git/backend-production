const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(process.cwd(), "storage");
const UPLOAD_TEMP_DIR = process.env.UPLOAD_TEMP_DIR
  ? path.resolve(process.env.UPLOAD_TEMP_DIR)
  : path.join(UPLOAD_ROOT, "tmp", "uploads");
const RESPONSE_TEMP_PATHS = Symbol("responseUploadTempPaths");

function ensureUploadTempDir() {
  fs.mkdirSync(UPLOAD_TEMP_DIR, { recursive: true });
  return UPLOAD_TEMP_DIR;
}

function getSafeExtension(fileName) {
  if (typeof fileName !== "string") return "";

  const extension = path.extname(fileName).toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (!extension || extension === ".") return "";

  return extension;
}

function createUploadTempFileName(fileName) {
  return `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${getSafeExtension(
    fileName,
  )}`;
}

function isUploadTempPath(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) return false;

  const resolvedTempDir = path.resolve(UPLOAD_TEMP_DIR);
  const resolvedFilePath = path.resolve(filePath);
  const tempDirWithSeparator = `${resolvedTempDir}${path.sep}`;

  return (
    resolvedFilePath !== resolvedTempDir &&
    resolvedFilePath.startsWith(tempDirWithSeparator)
  );
}

function cleanupUploadTempFile(filePath) {
  if (!isUploadTempPath(filePath)) return;

  fs.rm(filePath, { force: true }, () => {});
}

function cleanupUploadTempFileSync(filePath) {
  if (!isUploadTempPath(filePath)) return;

  try {
    fs.rmSync(filePath, { force: true });
  } catch {}
}

function attachUploadTempCleanup(res, filePaths) {
  if (!res) return;

  const paths = (Array.isArray(filePaths) ? filePaths : [filePaths]).filter(
    isUploadTempPath,
  );
  if (paths.length === 0) return;

  if (!res[RESPONSE_TEMP_PATHS]) {
    res[RESPONSE_TEMP_PATHS] = new Set();
    const cleanup = () => {
      const pendingPaths = [...res[RESPONSE_TEMP_PATHS]];
      res[RESPONSE_TEMP_PATHS].clear();
      for (const filePath of pendingPaths) {
        cleanupUploadTempFile(filePath);
      }
    };
    res.once("finish", cleanup);
    res.once("close", cleanup);
  }

  for (const filePath of paths) {
    res[RESPONSE_TEMP_PATHS].add(filePath);
  }
}

function buildDiskUploadStorage(multer) {
  return multer.diskStorage({
    destination(req, file, callback) {
      try {
        callback(null, ensureUploadTempDir());
      } catch (error) {
        callback(error);
      }
    },
    filename(req, file, callback) {
      callback(null, createUploadTempFileName(file.originalname));
    },
  });
}

module.exports = {
  UPLOAD_TEMP_DIR,
  attachUploadTempCleanup,
  buildDiskUploadStorage,
  cleanupUploadTempFileSync,
  ensureUploadTempDir,
  isUploadTempPath,
};
