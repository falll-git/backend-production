const fs = require("fs");
const path = require("path");
const {
  PUBLIC_PREFIX: DIGITAL_ARCHIVE_PUBLIC_PREFIX,
  STORAGE_ROOT: DIGITAL_ARCHIVE_STORAGE_ROOT,
} = require("./digital-archive-files");
const {
  PUBLIC_PREFIX: PERSURATAN_PUBLIC_PREFIX,
  STORAGE_ROOT: PERSURATAN_STORAGE_ROOT,
} = require("./persuratan-files");
const {
  PUBLIC_PREFIX: WATERMARKED_PUBLIC_PREFIX,
  STORAGE_ROOT: WATERMARKED_STORAGE_ROOT,
} = require("./watermarked-files");

const STORED_PATH_ROOTS = [
  [DIGITAL_ARCHIVE_PUBLIC_PREFIX, DIGITAL_ARCHIVE_STORAGE_ROOT],
  [PERSURATAN_PUBLIC_PREFIX, PERSURATAN_STORAGE_ROOT],
  [WATERMARKED_PUBLIC_PREFIX, WATERMARKED_STORAGE_ROOT],
];

function remoteHeadEnabled() {
  return String(process.env.STORAGE_USAGE_REMOTE_HEAD_ENABLED || "").toLowerCase() === "true";
}

function remoteHeadTimeoutMs() {
  const value = Number(process.env.STORAGE_USAGE_REMOTE_HEAD_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 3000;
}

function normalizeStoredPath(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).pathname;
    } catch {
      return null;
    }
  }

  return trimmed.startsWith("/") ? trimmed : null;
}

function resolveStoredFilePath(storedPath) {
  const normalizedPath = normalizeStoredPath(storedPath);
  if (!normalizedPath) return null;

  for (const [publicPrefix, storageRoot] of STORED_PATH_ROOTS) {
    if (!normalizedPath.startsWith(`${publicPrefix}/`)) continue;

    const relativePath = normalizedPath
      .replace(`${publicPrefix}/`, "")
      .split("/")
      .filter(Boolean);
    if (relativePath.length === 0) return null;

    const resolvedPath = path.resolve(storageRoot, ...relativePath);
    const rootWithSeparator = `${storageRoot}${path.sep}`;

    if (
      resolvedPath === storageRoot ||
      !resolvedPath.startsWith(rootWithSeparator)
    ) {
      return null;
    }

    return resolvedPath;
  }

  return null;
}

function getStoredFileSizeBytes(storedPath) {
  const resolvedPath = resolveStoredFilePath(storedPath);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) return null;

  try {
    const stat = fs.statSync(resolvedPath);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

async function getRemoteFileSizeBytes(storedPath) {
  if (!remoteHeadEnabled()) return null;
  if (typeof storedPath !== "string" || !/^https?:\/\//i.test(storedPath.trim())) return null;
  if (typeof fetch !== "function") return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remoteHeadTimeoutMs());

  try {
    const response = await fetch(storedPath.trim(), {
      method: "HEAD",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const contentLength = Number(response.headers.get("content-length"));
    return Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveStoredFileSizeBytes(storedPath) {
  const localSize = getStoredFileSizeBytes(storedPath);
  if (localSize && localSize > 0) return localSize;
  return getRemoteFileSizeBytes(storedPath);
}

module.exports = {
  getStoredFileSizeBytes,
  getRemoteFileSizeBytes,
  resolveStoredFileSizeBytes,
  resolveStoredFilePath,
};
