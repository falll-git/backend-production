const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { buildPublicUrl } = require("./public-url");

const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(process.cwd(), "storage");
const STORAGE_ROOT = path.join(UPLOAD_ROOT, "watermarks");
const PUBLIC_PREFIX = "/api/watermark-assets";

const MIME_TO_EXTENSION = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/svg+xml": "svg",
};

function ensureDirectory(target) {
  fs.mkdirSync(target, { recursive: true });
}

function sanitizeFileNameBase(value) {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function inferExtension(file) {
  const mimeType = String(file?.mimetype || "").toLowerCase();
  if (MIME_TO_EXTENSION[mimeType]) return MIME_TO_EXTENSION[mimeType];

  const fileName = String(file?.originalname || "").toLowerCase();
  const extension = fileName.includes(".") ? fileName.split(".").pop() : "";
  return ["png", "jpg", "jpeg", "svg"].includes(extension)
    ? extension.replace("jpeg", "jpg")
    : "png";
}

function buildWatermarkAssetUrl(req, storedPath) {
  return buildPublicUrl(req, storedPath);
}

function resolveWatermarkAssetPath(storedPath) {
  if (
    typeof storedPath !== "string" ||
    !storedPath.startsWith(`${PUBLIC_PREFIX}/`)
  ) {
    return null;
  }

  const relativePath = storedPath
    .replace(`${PUBLIC_PREFIX}/`, "")
    .split("/")
    .filter(Boolean);

  if (relativePath.length === 0) return null;

  const resolvedPath = path.resolve(STORAGE_ROOT, ...relativePath);
  const rootWithSeparator = `${STORAGE_ROOT}${path.sep}`;

  if (resolvedPath !== STORAGE_ROOT && !resolvedPath.startsWith(rootWithSeparator)) {
    return null;
  }

  return resolvedPath;
}

function deleteWatermarkAsset(storedPath) {
  const resolvedPath = resolveWatermarkAssetPath(storedPath);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) return;

  try {
    fs.unlinkSync(resolvedPath);
  } catch {}
}

function persistWatermarkImage(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) return null;

  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const targetDirectory = path.join(STORAGE_ROOT, year, month);
  ensureDirectory(targetDirectory);

  const originalBaseName =
    sanitizeFileNameBase(path.parse(file.originalname || "").name) ||
    "watermark";
  const extension = inferExtension(file);
  const storedFileName = `${Date.now()}-${crypto
    .randomBytes(8)
    .toString("hex")}-${originalBaseName}.${extension}`;
  const absolutePath = path.join(targetDirectory, storedFileName);

  fs.writeFileSync(absolutePath, file.buffer);

  return {
    storedPath: `${PUBLIC_PREFIX}/${year}/${month}/${storedFileName}`,
    fileName: file.originalname || storedFileName,
    mimeType: file.mimetype || null,
    sizeBytes: file.size || file.buffer.length,
  };
}

module.exports = {
  PUBLIC_PREFIX,
  STORAGE_ROOT,
  buildWatermarkAssetUrl,
  deleteWatermarkAsset,
  persistWatermarkImage,
  resolveWatermarkAssetPath,
};
