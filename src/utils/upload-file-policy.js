const fs = require("fs");
const { normalizeUploadTempPath } = require("./upload-temp-files");

const DOCUMENT_MIME_TYPES_BY_EXTENSION = {
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  xls: ["application/vnd.ms-excel"],
  xlsx: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  zip: ["application/zip", "application/x-zip-compressed"],
  txt: ["text/plain", "application/octet-stream"],
  csv: ["text/csv", "application/csv", "text/plain"],
  json: ["application/json", "text/json", "text/plain"],
  jpg: ["image/jpeg", "image/jpg"],
  jpeg: ["image/jpeg", "image/jpg"],
  png: ["image/png"],
};

const OFFICE_LEGACY_EXTENSIONS = new Set(["doc", "ppt", "xls"]);
const ZIP_EXTENSIONS = new Set(["docx", "pptx", "xlsx", "zip"]);
const TEXT_EXTENSIONS = new Set(["txt", "csv", "json"]);
const MAX_SIGNATURE_SAMPLE_BYTES = 64 * 1024;

function getFileExtension(fileName) {
  if (typeof fileName !== "string") return "";

  const normalized = fileName.trim().toLowerCase();
  const baseName = normalized.split(/[\\/]/).pop() || "";
  const separatorIndex = baseName.lastIndexOf(".");
  if (separatorIndex <= 0 || separatorIndex === baseName.length - 1) {
    return "";
  }

  const extension = baseName.slice(separatorIndex + 1);
  return /^[a-z0-9]{1,10}$/.test(extension) ? extension : "";
}

function normalizeMimeType(value) {
  return String(value || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function isUploadMetadataAllowed(
  file,
  {
    allowedExtensions,
    mimeTypesByExtension = DOCUMENT_MIME_TYPES_BY_EXTENSION,
  },
) {
  const extension = getFileExtension(file?.originalname);
  const mimeType = normalizeMimeType(file?.mimetype);
  const extensionSet =
    allowedExtensions instanceof Set
      ? allowedExtensions
      : new Set(allowedExtensions || []);
  const allowedMimeTypes = mimeTypesByExtension[extension] || [];

  return (
    extensionSet.has(extension) &&
    Boolean(mimeType) &&
    allowedMimeTypes.includes(mimeType)
  );
}

function readSignatureSample(file) {
  if (Buffer.isBuffer(file?.buffer)) {
    return file.buffer.subarray(0, MAX_SIGNATURE_SAMPLE_BYTES);
  }

  const filePath = normalizeUploadTempPath(file?.path);
  if (!filePath) return null;

  let descriptor;
  try {
    descriptor = fs.openSync(filePath, "r");
    const sample = Buffer.alloc(MAX_SIGNATURE_SAMPLE_BYTES);
    const bytesRead = fs.readSync(
      descriptor,
      sample,
      0,
      MAX_SIGNATURE_SAMPLE_BYTES,
      0,
    );
    return sample.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {}
    }
  }
}

function startsWithBytes(buffer, expected) {
  if (!Buffer.isBuffer(buffer) || buffer.length < expected.length) return false;
  return expected.every((value, index) => buffer[index] === value);
}

function isPdf(buffer) {
  const markerIndex = buffer
    .subarray(0, 32)
    .indexOf(Buffer.from("%PDF-", "ascii"));
  if (markerIndex < 0) return false;

  const prefix = buffer.subarray(0, markerIndex);
  const withoutBom = startsWithBytes(prefix, [0xef, 0xbb, 0xbf])
    ? prefix.subarray(3)
    : prefix;

  return [...withoutBom].every((value) =>
    [0x09, 0x0a, 0x0c, 0x0d, 0x20].includes(value),
  );
}

function isPng(buffer) {
  return startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function isJpeg(buffer) {
  return startsWithBytes(buffer, [0xff, 0xd8, 0xff]);
}

function isLegacyOffice(buffer) {
  return startsWithBytes(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

function isZip(buffer) {
  return (
    startsWithBytes(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWithBytes(buffer, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWithBytes(buffer, [0x50, 0x4b, 0x07, 0x08])
  );
}

function isPlausibleText(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  if (buffer.includes(0x00)) return false;

  let controlCharacters = 0;
  for (const value of buffer) {
    const isAllowedWhitespace =
      value === 0x09 || value === 0x0a || value === 0x0c || value === 0x0d;
    if (value < 0x20 && !isAllowedWhitespace) {
      controlCharacters += 1;
    }
  }

  return controlCharacters / buffer.length <= 0.01;
}

function isUploadContentAllowed(file) {
  const extension = getFileExtension(file?.originalname);
  const sample = readSignatureSample(file);
  if (!sample || sample.length === 0) return false;

  if (extension === "pdf") return isPdf(sample);
  if (extension === "png") return isPng(sample);
  if (extension === "jpg" || extension === "jpeg") return isJpeg(sample);
  if (OFFICE_LEGACY_EXTENSIONS.has(extension)) return isLegacyOffice(sample);
  if (ZIP_EXTENSIONS.has(extension)) return isZip(sample);
  if (TEXT_EXTENSIONS.has(extension)) return isPlausibleText(sample);

  return false;
}

module.exports = {
  DOCUMENT_MIME_TYPES_BY_EXTENSION,
  getFileExtension,
  isUploadContentAllowed,
  isUploadMetadataAllowed,
  normalizeMimeType,
};
