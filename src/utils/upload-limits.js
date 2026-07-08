const DOCUMENT_UPLOAD_MAX_SIZE_MB = 50;
const DOCUMENT_UPLOAD_MAX_SIZE_BYTES = DOCUMENT_UPLOAD_MAX_SIZE_MB * 1024 * 1024;
const DOCUMENT_UPLOAD_MAX_SIZE_LABEL = `${DOCUMENT_UPLOAD_MAX_SIZE_MB} MB`;
const DEFAULT_DOCUMENT_UPLOAD_MAX_TOTAL_SIZE_MB = 100;

function readPositiveIntEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function getDocumentUploadMaxTotalSizeMb() {
  return readPositiveIntEnv(
    "DOCUMENT_UPLOAD_MAX_TOTAL_SIZE_MB",
    DEFAULT_DOCUMENT_UPLOAD_MAX_TOTAL_SIZE_MB,
  );
}

function getDocumentUploadMaxTotalSizeBytes() {
  return getDocumentUploadMaxTotalSizeMb() * 1024 * 1024;
}

module.exports = {
  DEFAULT_DOCUMENT_UPLOAD_MAX_TOTAL_SIZE_MB,
  DOCUMENT_UPLOAD_MAX_SIZE_BYTES,
  DOCUMENT_UPLOAD_MAX_SIZE_LABEL,
  DOCUMENT_UPLOAD_MAX_SIZE_MB,
  getDocumentUploadMaxTotalSizeBytes,
  getDocumentUploadMaxTotalSizeMb,
};
