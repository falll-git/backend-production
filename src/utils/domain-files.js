const crypto = require("crypto");
const {
  buildFileUrl,
  deriveDocumentFileName,
  persistDigitalArchiveFile,
} = require("./digital-archive-files");
const { appendFileAccessToken } = require("./file-access-token");

function getInputSize(input) {
  if (input && typeof input === "object") {
    if (Buffer.isBuffer(input.buffer)) return input.buffer.length;
    if (Number.isFinite(input.size_bytes)) return Number(input.size_bytes);
  }

  return null;
}

function getInputChecksum(input) {
  if (!input || typeof input !== "object" || !Buffer.isBuffer(input.buffer)) {
    return null;
  }

  return crypto.createHash("sha256").update(input.buffer).digest("hex");
}

function persistDomainFile({ entity, input, previousPath, fallbackBaseName }) {
  if (input === undefined) return null;

  const stored = persistDigitalArchiveFile({
    entity,
    input,
    previousPath,
    fallbackBaseName,
  });

  if (!stored?.storedPath) return null;

  return {
    file_path: stored.storedPath,
    file_name:
      stored.fileName ||
      deriveDocumentFileName(stored.storedPath, fallbackBaseName),
    mime_type: stored.mimeType || input?.mime_type || input?.mimeType || null,
    size_bytes: getInputSize(input),
    checksum: getInputChecksum(input),
  };
}

function applyFileMeta(data, fileMeta, prefix = "") {
  if (!fileMeta) return data;

  return {
    ...data,
    [`${prefix}file_path`]: fileMeta.file_path,
    [`${prefix}file_name`]: fileMeta.file_name,
    [`${prefix}mime_type`]: fileMeta.mime_type,
    [`${prefix}size_bytes`]: fileMeta.size_bytes,
    ...(prefix ? {} : { checksum: fileMeta.checksum }),
  };
}

function serializeFile(req, record, options = {}) {
  const {
    module = "debtor_information",
    entityId = record?.id,
    prefix = "",
    fallbackBaseName = "dokumen",
  } = options;
  if (!record) return null;

  const path = record[`${prefix}file_path`];
  if (!path) return null;

  const url = appendFileAccessToken(req, buildFileUrl(req, path), {
    storedPath: path,
    module,
    entityId,
  });

  return {
    path,
    name:
      record[`${prefix}file_name`] ||
      deriveDocumentFileName(path, fallbackBaseName),
    mime_type: record[`${prefix}mime_type`] || null,
    size_bytes: record[`${prefix}size_bytes`] || null,
    checksum: prefix ? null : record.checksum || null,
    url,
  };
}

module.exports = {
  applyFileMeta,
  persistDomainFile,
  serializeFile,
};
