const fs = require("fs/promises");
const path = require("path");
const {
  UPLOAD_TEMP_DIR,
  getActiveUploadTempPaths,
  isUploadTempPath,
  releaseUploadTempPath,
} = require("../utils/upload-temp-files");

const DEFAULT_TEMP_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function readPositiveIntEnv(key, fallback) {
  const parsed = Number(process.env[key]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeProtectedPaths(paths) {
  return new Set(
    [...(paths || [])]
      .filter(isUploadTempPath)
      .map((filePath) => path.resolve(filePath)),
  );
}

function collectPathLikeStrings(value, store = []) {
  if (typeof value === "string") {
    store.push(value);
    return store;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPathLikeStrings(item, store);
    return store;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectPathLikeStrings(item, store);
  }
  return store;
}

async function getActiveImportTempPaths(prismaClient) {
  if (!prismaClient?.debtor_import_jobs) return new Set();

  const jobs = await prismaClient.debtor_import_jobs.findMany({
    where: {
      deleted_at: null,
      status: { in: ["PENDING", "PROCESSING"] },
    },
    select: {
      file_path: true,
      files: true,
    },
  });
  const candidates = [];
  for (const job of jobs) {
    collectPathLikeStrings(job.file_path, candidates);
    collectPathLikeStrings(job.files, candidates);
  }
  return normalizeProtectedPaths(candidates);
}

async function listTemporaryFiles(root = UPLOAD_TEMP_DIR) {
  const files = [];
  const pending = [path.resolve(root)];

  while (pending.length > 0) {
    const directory = pending.pop();
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolutePath);
      if (entry.isFile()) files.push(absolutePath);
    }
  }

  return files;
}

async function cleanupExpiredUploadTempFiles({
  dryRun = true,
  ttlMs = readPositiveIntEnv("UPLOAD_TEMP_TTL_MS", DEFAULT_TEMP_TTL_MS),
  now = Date.now(),
  protectedPaths = [],
  prismaClient = null,
  tempRoot = UPLOAD_TEMP_DIR,
} = {}) {
  const processActive = getActiveUploadTempPaths();
  const importActive = await getActiveImportTempPaths(prismaClient);
  const protectedSet = normalizeProtectedPaths([
    ...processActive,
    ...importActive,
    ...protectedPaths,
  ]);
  const files = await listTemporaryFiles(tempRoot);
  const report = {
    dry_run: Boolean(dryRun),
    ttl_ms: ttlMs,
    scanned: files.length,
    expired: 0,
    protected: 0,
    deleted: 0,
    failed: 0,
    candidates: [],
    failures: [],
  };

  for (const filePath of files) {
    const normalized = path.resolve(filePath);
    if (!isUploadTempPath(normalized)) continue;
    if (protectedSet.has(normalized)) {
      report.protected += 1;
      continue;
    }

    const stat = await fs.stat(normalized);
    if (now - stat.mtimeMs < ttlMs) continue;
    report.expired += 1;
    const relativePath = path.relative(path.resolve(tempRoot), normalized);
    report.candidates.push(relativePath);
    if (dryRun) continue;

    try {
      await fs.rm(normalized, { force: true });
      releaseUploadTempPath(normalized);
      report.deleted += 1;
    } catch (error) {
      report.failed += 1;
      report.failures.push({
        file: relativePath,
        code: error?.code || "UNKNOWN",
      });
    }
  }

  return report;
}

function startTemporaryFileCleanupScheduler({
  prismaClient,
  logger = console,
  intervalMs = readPositiveIntEnv(
    "UPLOAD_TEMP_CLEANUP_INTERVAL_MS",
    DEFAULT_CLEANUP_INTERVAL_MS,
  ),
} = {}) {
  let running = false;
  const run = async () => {
    if (running) return null;
    running = true;
    try {
      const report = await cleanupExpiredUploadTempFiles({
        dryRun: false,
        prismaClient,
      });
      if (report.deleted > 0 || report.failed > 0) {
        logger.info?.("[storage] temporary file cleanup", report);
      }
      return report;
    } catch (error) {
      logger.error?.("[storage] temporary file cleanup failed", error);
      return null;
    } finally {
      running = false;
    }
  };

  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return {
    run,
    stop() {
      clearInterval(timer);
    },
  };
}

module.exports = {
  DEFAULT_CLEANUP_INTERVAL_MS,
  DEFAULT_TEMP_TTL_MS,
  cleanupExpiredUploadTempFiles,
  collectPathLikeStrings,
  getActiveImportTempPaths,
  listTemporaryFiles,
  startTemporaryFileCleanupScheduler,
};
