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
const REQUEST_TEMP_PATHS = Symbol("requestUploadTempPaths");
const ACTIVE_UPLOAD_TEMP_PATHS = new Set();

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

function normalizeUploadTempPath(filePath) {
  return isUploadTempPath(filePath) ? path.resolve(filePath) : null;
}

function markUploadTempPathActive(filePath) {
  const normalized = normalizeUploadTempPath(filePath);
  if (normalized) ACTIVE_UPLOAD_TEMP_PATHS.add(normalized);
  return normalized;
}

function releaseUploadTempPath(filePath) {
  const normalized = normalizeUploadTempPath(filePath);
  if (normalized) ACTIVE_UPLOAD_TEMP_PATHS.delete(normalized);
}

function getActiveUploadTempPaths() {
  return new Set(ACTIVE_UPLOAD_TEMP_PATHS);
}

function cleanupUploadTempFile(filePath) {
  if (!isUploadTempPath(filePath)) return;

  fs.rm(filePath, { force: true }, () => {
    releaseUploadTempPath(filePath);
  });
}

function cleanupUploadTempFileSync(filePath) {
  if (!isUploadTempPath(filePath)) return;

  try {
    fs.rmSync(filePath, { force: true });
  } catch {
  } finally {
    releaseUploadTempPath(filePath);
  }
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
  const storage = multer.diskStorage({
    destination(req, file, callback) {
      try {
        callback(null, ensureUploadTempDir());
      } catch (error) {
        callback(error);
      }
    },
    filename(req, file, callback) {
      const fileName = createUploadTempFileName(file.originalname);
      const tempPath = path.join(ensureUploadTempDir(), fileName);
      markUploadTempPathActive(tempPath);
      if (!req[REQUEST_TEMP_PATHS]) req[REQUEST_TEMP_PATHS] = new Set();
      req[REQUEST_TEMP_PATHS].add(tempPath);
      callback(null, fileName);
    },
  });
  const removeFile = storage._removeFile.bind(storage);
  storage._removeFile = (req, file, callback) => {
    removeFile(req, file, (error) => {
      releaseUploadTempPath(file?.path);
      callback(error);
    });
  };
  return storage;
}

module.exports = {
  UPLOAD_TEMP_DIR,
  attachUploadTempCleanup,
  buildDiskUploadStorage,
  cleanupUploadTempFileSync,
  ensureUploadTempDir,
  getActiveUploadTempPaths,
  isUploadTempPath,
  markUploadTempPathActive,
  releaseUploadTempPath,
};
