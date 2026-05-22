const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  cleanupUploadTempFileSync,
  isUploadTempPath,
} = require("./upload-temp-files");
const { buildPublicUrl } = require("./public-url");

const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(process.cwd(), "storage");
const STORAGE_ROOT = path.join(UPLOAD_ROOT, "persuratan");
const PUBLIC_PREFIX = "/api/persuratan-files";

function ensureDirectory(target) {
  fs.mkdirSync(target, { recursive: true });
}

function sanitizeFileNameBase(value) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function inferExtensionFromFileName(fileName) {
  if (typeof fileName !== "string" || !fileName.trim()) return null;

  const normalized = fileName.trim().toLowerCase();
  const parts = normalized.split(".");
  const extension = parts.at(-1);

  return extension && extension !== normalized ? extension : null;
}

function inferMimeTypeFromFileName(fileName) {
  if (typeof fileName !== "string" || !fileName.trim()) return null;

  const normalized = fileName.trim().toLowerCase();
  if (normalized.endsWith(".pdf")) return "application/pdf";
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalized.endsWith(".doc")) return "application/msword";
  if (normalized.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (normalized.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  if (normalized.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (normalized.endsWith(".xls")) return "application/vnd.ms-excel";
  if (normalized.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }

  return null;
}

const MIME_TO_EXTENSION = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

function inferMimeType({ fileName, mimeType }) {
  return mimeType || inferMimeTypeFromFileName(fileName);
}

function inferExtension({ fileName, mimeType }) {
  return (
    inferExtensionFromFileName(fileName) ||
    (mimeType ? MIME_TO_EXTENSION[mimeType] : null) ||
    "bin"
  );
}

function normalizeStoredPath(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  const trimmed = value.trim();
  if (trimmed.startsWith(PUBLIC_PREFIX)) return trimmed;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.pathname.startsWith(PUBLIC_PREFIX)) {
        return parsed.pathname;
      }
    } catch {}

    return trimmed;
  }

  return null;
}

function resolveStoredFilePath(storedPath) {
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

function isManagedStoredPath(storedPath) {
  return (
    typeof storedPath === "string" &&
    storedPath.startsWith(`${PUBLIC_PREFIX}/`)
  );
}

function deleteStoredFile(storedPath) {
  const resolvedPath = resolveStoredFilePath(storedPath);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) return;

  try {
    fs.unlinkSync(resolvedPath);
  } catch {}
}

function deleteReplacedStoredFile(previousPath, nextPath) {
  if (
    previousPath &&
    previousPath !== nextPath &&
    isManagedStoredPath(previousPath)
  ) {
    deleteStoredFile(previousPath);
  }
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

function getLocalFileSizeBytes(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) return null;

  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

function moveUploadedFile(sourcePath, absolutePath) {
  try {
    fs.renameSync(sourcePath, absolutePath);
  } catch (error) {
    if (error?.code !== "EXDEV") {
      throw error;
    }

    try {
      fs.copyFileSync(sourcePath, absolutePath);
    } finally {
      cleanupUploadTempFileSync(sourcePath);
    }
  }
}

function deriveDocumentFileName(storedPath, fallbackBaseName = "dokumen") {
  const safeFallback = sanitizeFileNameBase(fallbackBaseName) || "dokumen";

  if (typeof storedPath === "string" && storedPath.trim()) {
    const trimmed = storedPath.trim();

    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) {
      const normalized = trimmed.split("#")[0].split("?")[0];
      const fileName = normalized.split("/").filter(Boolean).pop();
      if (fileName) return decodeURIComponent(fileName);
    }

    if (!trimmed.includes("/") && !trimmed.includes("\\")) {
      return trimmed;
    }
  }

  return `${safeFallback}.bin`;
}

function buildFileUrl(req, storedPath) {
  return buildPublicUrl(req, storedPath);
}

function parseRequestFileInput(input) {
  if (!input) return null;

  if (typeof input === "string") {
    const storedPath = normalizeStoredPath(input);
    if (!storedPath) return null;

    return {
      storedPath,
      buffer: null,
      fileName: null,
      mimeType: inferMimeTypeFromFileName(storedPath),
      sizeBytes: getStoredFileSizeBytes(storedPath),
      isNewUpload: false,
    };
  }

  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const tempPath =
      input.temp_path || input.tempPath || input.local_path || input.localPath;

    if (typeof tempPath === "string" && isUploadTempPath(tempPath)) {
      return {
        storedPath: null,
        buffer: null,
        sourcePath: tempPath,
        fileName:
          input.file_name ||
          input.fileName ||
          input.name ||
          input.originalname ||
          input.filename ||
          null,
        mimeType:
          input.mime_type ||
          input.mimeType ||
          input.type ||
          input.mimetype ||
          null,
        sizeBytes:
          input.size_bytes ||
          input.sizeBytes ||
          input.size ||
          getLocalFileSizeBytes(tempPath),
        isNewUpload: true,
      };
    }

    if (Buffer.isBuffer(input.buffer)) {
      return {
        storedPath: null,
        buffer: input.buffer,
        sourcePath: null,
        fileName:
          input.file_name ||
          input.fileName ||
          input.name ||
          input.originalname ||
          input.filename ||
          null,
        mimeType:
          input.mime_type ||
          input.mimeType ||
          input.type ||
          input.mimetype ||
          null,
        sizeBytes:
          input.size_bytes ||
          input.sizeBytes ||
          input.size ||
          input.buffer.length,
        isNewUpload: true,
      };
    }

    const storedPath =
      normalizeStoredPath(input.url || input.path || input.file || null) ||
      null;

    if (storedPath) {
      return {
        storedPath,
        buffer: null,
        sourcePath: null,
        fileName: null,
        mimeType: inferMimeTypeFromFileName(storedPath),
        sizeBytes: getStoredFileSizeBytes(storedPath),
        isNewUpload: false,
      };
    }
  }

  return null;
}

function persistFile({
  entity,
  buffer,
  sourcePath,
  sizeBytes,
  fileName,
  mimeType,
  fallbackBaseName,
}) {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const targetDirectory = path.join(STORAGE_ROOT, entity, year, month);

  ensureDirectory(targetDirectory);

  const resolvedMimeType = inferMimeType({ fileName, mimeType });
  const extension = inferExtension({ fileName, mimeType: resolvedMimeType });
  const safeBaseName = sanitizeFileNameBase(fallbackBaseName) || entity;
  const storedFileName = `${Date.now()}-${crypto
    .randomBytes(8)
    .toString("hex")}-${safeBaseName}.${extension}`;
  const absolutePath = path.join(targetDirectory, storedFileName);

  if (sourcePath) {
    moveUploadedFile(sourcePath, absolutePath);
  } else {
    fs.writeFileSync(absolutePath, buffer);
  }

  const storedSizeBytes =
    sizeBytes ||
    (() => {
      try {
        return fs.statSync(absolutePath).size;
      } catch {
        return null;
      }
    })();

  return {
    storedPath: `${PUBLIC_PREFIX}/${entity}/${year}/${month}/${storedFileName}`,
    fileName:
      typeof fileName === "string" && fileName.trim()
        ? fileName.trim()
        : storedFileName,
    mimeType: resolvedMimeType,
    sizeBytes: storedSizeBytes,
  };
}

function persistPersuratanFile({
  entity,
  input,
  previousPath,
  fallbackBaseName,
}) {
  const parsed = parseRequestFileInput(input);
  if (!parsed) {
    return {
      storedPath: previousPath ?? null,
      fileName: previousPath
        ? deriveDocumentFileName(previousPath, fallbackBaseName)
        : null,
      mimeType: null,
      sizeBytes: getStoredFileSizeBytes(previousPath),
      isNewUpload: false,
    };
  }

  if (parsed.storedPath) {
    return {
      storedPath: parsed.storedPath,
      fileName: deriveDocumentFileName(parsed.storedPath, fallbackBaseName),
      mimeType: parsed.mimeType,
      sizeBytes: parsed.sizeBytes,
      isNewUpload: false,
    };
  }

  return {
    ...persistFile({
      entity,
      buffer: parsed.buffer,
      sourcePath: parsed.sourcePath,
      sizeBytes: parsed.sizeBytes,
      fileName: parsed.fileName,
      mimeType: parsed.mimeType,
      fallbackBaseName,
    }),
    isNewUpload: true,
  };
}

module.exports = {
  UPLOAD_ROOT,
  STORAGE_ROOT,
  PUBLIC_PREFIX,
  buildFileUrl,
  deleteReplacedStoredFile,
  deleteStoredFile,
  deriveDocumentFileName,
  getStoredFileSizeBytes,
  normalizeStoredPath,
  parseRequestFileInput,
  persistPersuratanFile,
};
