const path = require("path");

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeFileNameBase(value, fallback = "dokumen") {
  const sanitized = compactWhitespace(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);

  return sanitized || fallback;
}

function getFileNameFromPath(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  const normalized = value.trim().split("#")[0].split("?")[0];
  const candidate = normalized.split(/[\\/]/).filter(Boolean).pop();
  if (!candidate) return null;

  try {
    return decodeURIComponent(candidate);
  } catch {
    return candidate;
  }
}

function getFileExtension(value) {
  const candidate = getFileNameFromPath(value) || String(value || "");
  const extension = path.extname(candidate).toLowerCase().replace(/^\./, "");
  return /^[a-z0-9]{1,8}$/.test(extension) ? extension : "";
}

function stripFileExtension(value) {
  const text = compactWhitespace(value);
  if (!text) return "";
  const extension = path.extname(text);
  return extension ? text.slice(0, -extension.length) : text;
}

function hasFileExtension(value) {
  return Boolean(getFileExtension(value));
}

function looksLikeStorageFileName(value) {
  const text = compactWhitespace(value);
  if (!text) return true;
  if (/^https?:\/\//i.test(text)) return true;
  if (text.startsWith("/api/")) return true;
  if (/[\\/]/.test(text)) return true;

  const base = stripFileExtension(getFileNameFromPath(text) || text);
  return /^\d{10,}-[a-f0-9]{12,}-.+/i.test(base);
}

function normalizeDownloadFileName(input = {}) {
  const {
    fileName,
    storedPath,
    fallbackBaseName = "dokumen",
    defaultExtension = "bin",
  } = input;
  const rawName = compactWhitespace(fileName);
  const extension =
    getFileExtension(rawName) ||
    getFileExtension(storedPath) ||
    String(defaultExtension || "bin").replace(/^\./, "").toLowerCase();

  if (rawName && !looksLikeStorageFileName(rawName)) {
    const safeBase = sanitizeFileNameBase(stripFileExtension(rawName));
    return `${safeBase}.${extension}`;
  }

  const fallbackCandidate =
    looksLikeStorageFileName(fallbackBaseName) || !compactWhitespace(fallbackBaseName)
      ? "dokumen"
      : fallbackBaseName;
  const safeFallback = sanitizeFileNameBase(stripFileExtension(fallbackCandidate));
  return `${safeFallback}.${extension || "bin"}`;
}

function buildContentDisposition(fileName, disposition = "inline") {
  const normalizedName = normalizeDownloadFileName({ fileName });
  const fallbackName = normalizedName
    .replace(/["\\]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_");

  return `${disposition}; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(
    normalizedName,
  )}`;
}

function formatDateForFile(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function compactDateForFile(value, fallback = "tanggal") {
  const dateFromObject = formatDateForFile(value);
  if (dateFromObject) return dateFromObject;

  const text = compactWhitespace(value);
  if (!text) return fallback;

  const digits = text.replace(/[^\d]/g, "");
  if (digits.length >= 8) return digits.slice(0, 8);

  return sanitizeFileNameBase(text, fallback);
}

module.exports = {
  buildContentDisposition,
  compactDateForFile,
  getFileExtension,
  getFileNameFromPath,
  looksLikeStorageFileName,
  normalizeDownloadFileName,
  sanitizeFileNameBase,
  stripFileExtension,
};
