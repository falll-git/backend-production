const fs = require("fs/promises");
const path = require("path");
const { constants: fsConstants } = require("fs");
const { UPLOAD_ROOT: DIGITAL_ARCHIVE_UPLOAD_ROOT } = require("../utils/digital-archive-files");
const { STORAGE_ROOT: DIGITAL_ARCHIVE_STORAGE_ROOT } = require("../utils/digital-archive-files");
const { STORAGE_ROOT: PERSURATAN_STORAGE_ROOT } = require("../utils/persuratan-files");
const { STORAGE_ROOT: WATERMARK_STORAGE_ROOT } = require("../utils/watermark-files");
const { STORAGE_ROOT: WATERMARKED_STORAGE_ROOT } = require("../utils/watermarked-files");
const { UPLOAD_TEMP_DIR } = require("../utils/upload-temp-files");

const UPLOAD_ROOT = path.resolve(DIGITAL_ARCHIVE_UPLOAD_ROOT);
const STORAGE_DIRECTORIES = [
  UPLOAD_ROOT,
  DIGITAL_ARCHIVE_STORAGE_ROOT,
  PERSURATAN_STORAGE_ROOT,
  WATERMARK_STORAGE_ROOT,
  WATERMARKED_STORAGE_ROOT,
  UPLOAD_TEMP_DIR,
];

function readNonNegativeNumber(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isPathInside(parentPath, candidatePath) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validateStoragePathSafety({
  uploadRoot = UPLOAD_ROOT,
  tempRoot = UPLOAD_TEMP_DIR,
  cwd = process.cwd(),
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  const errors = [];
  const resolvedUploadRoot = path.resolve(uploadRoot);
  const resolvedTempRoot = path.resolve(tempRoot);
  const filesystemRoot = path.parse(resolvedUploadRoot).root;

  if (resolvedUploadRoot === filesystemRoot) {
    errors.push("UPLOAD_DIR tidak boleh memakai root filesystem.");
  }
  if (resolvedTempRoot === path.parse(resolvedTempRoot).root) {
    errors.push("UPLOAD_TEMP_DIR tidak boleh memakai root filesystem.");
  }
  if (
    nodeEnv === "production" &&
    (isPathInside(cwd, resolvedUploadRoot) || isPathInside(resolvedUploadRoot, cwd))
  ) {
    errors.push("UPLOAD_DIR production wajib berada di luar folder source/deployment.");
  }
  if (
    nodeEnv === "production" &&
    (isPathInside(cwd, resolvedTempRoot) || isPathInside(resolvedTempRoot, cwd))
  ) {
    errors.push("UPLOAD_TEMP_DIR production wajib berada di luar folder source/deployment.");
  }

  return {
    safe: errors.length === 0,
    errors,
  };
}

function normalizeStatfsValue(value) {
  if (typeof value === "bigint") return value;
  if (Number.isFinite(value)) return BigInt(Math.trunc(value));
  return 0n;
}

function toSafeNumber(value) {
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(value > maximum ? maximum : value);
}

async function inspectStorageCapacity(uploadRoot = UPLOAD_ROOT) {
  const stats = await fs.statfs(uploadRoot, { bigint: true });
  const blockSize = normalizeStatfsValue(stats.bsize);
  const availableBlocks = normalizeStatfsValue(stats.bavail);
  const totalBlocks = normalizeStatfsValue(stats.blocks);
  const freeInodes = normalizeStatfsValue(stats.ffree);
  const totalInodes = normalizeStatfsValue(stats.files);
  const freeBytes = blockSize * availableBlocks;
  const totalBytes = blockSize * totalBlocks;
  const freePercent =
    totalBytes > 0n ? Number((freeBytes * 10000n) / totalBytes) / 100 : null;

  return {
    free_bytes: toSafeNumber(freeBytes),
    total_bytes: toSafeNumber(totalBytes),
    free_percent: freePercent,
    free_inodes: toSafeNumber(freeInodes),
    total_inodes: toSafeNumber(totalInodes),
  };
}

function evaluateStorageCapacity(capacity, {
  minimumFreeBytes = readNonNegativeNumber("STORAGE_MIN_FREE_BYTES", 0),
  minimumFreePercent = readNonNegativeNumber("STORAGE_MIN_FREE_PERCENT", 0),
  minimumFreeInodes = readNonNegativeNumber("STORAGE_MIN_FREE_INODES", 0),
} = {}) {
  const failures = [];
  if (capacity.free_bytes < minimumFreeBytes) failures.push("free_bytes");
  if (
    capacity.free_percent !== null &&
    capacity.free_percent < minimumFreePercent
  ) {
    failures.push("free_percent");
  }
  if (capacity.free_inodes < minimumFreeInodes) failures.push("free_inodes");

  return {
    healthy: failures.length === 0,
    failures,
    thresholds: {
      minimum_free_bytes: minimumFreeBytes,
      minimum_free_percent: minimumFreePercent,
      minimum_free_inodes: minimumFreeInodes,
    },
  };
}

async function ensureStorageReady({ checkCapacity = true } = {}) {
  const safety = validateStoragePathSafety();
  if (!safety.safe) {
    throw new Error(`Konfigurasi storage tidak aman: ${safety.errors.join(" ")}`);
  }

  for (const directory of STORAGE_DIRECTORIES) {
    await fs.mkdir(directory, { recursive: true });
    await fs.access(directory, fsConstants.R_OK | fsConstants.W_OK);
  }

  const capacity = await inspectStorageCapacity();
  const evaluation = evaluateStorageCapacity(capacity);
  if (checkCapacity && !evaluation.healthy) {
    throw new Error(
      `Kapasitas storage melewati batas aman: ${evaluation.failures.join(", ")}.`,
    );
  }

  return {
    status: evaluation.healthy ? "up" : "low_capacity",
    writable: true,
    capacity,
    thresholds: evaluation.thresholds,
  };
}

module.exports = {
  STORAGE_DIRECTORIES,
  UPLOAD_ROOT,
  ensureStorageReady,
  evaluateStorageCapacity,
  inspectStorageCapacity,
  isPathInside,
  validateStoragePathSafety,
};
