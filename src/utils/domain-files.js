const crypto = require("crypto");
const fs = require("fs");
const {
  buildFileUrl,
  deleteStoredFile,
  deriveDocumentFileName,
  persistDigitalArchiveFile,
} = require("./digital-archive-files");
const { appendFileAccessToken } = require("./file-access-token");
const { normalizeDownloadFileName } = require("./file-names");
const { normalizeUploadTempPath } = require("./upload-temp-files");

const NEW_UPLOAD = Symbol("domain-file-new-upload");

function getInputSize(input) {
  if (input && typeof input === "object") {
    if (Buffer.isBuffer(input.buffer)) return input.buffer.length;
    if (Number.isFinite(input.size_bytes)) return Number(input.size_bytes);
  }

  return null;
}

function getInputChecksum(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const hash = crypto.createHash("sha256");
  if (Buffer.isBuffer(input.buffer)) {
    return hash.update(input.buffer).digest("hex");
  }

  const tempPath = normalizeUploadTempPath(input.temp_path || input.tempPath);
  if (!tempPath) return null;

  let descriptor;
  try {
    descriptor = fs.openSync(tempPath, "r");
    const chunk = Buffer.alloc(64 * 1024);
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, chunk, 0, chunk.length, null);
      if (bytesRead > 0) hash.update(chunk.subarray(0, bytesRead));
    } while (bytesRead > 0);
    return hash.digest("hex");
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

function persistDomainFile({ entity, input, previousPath, fallbackBaseName }) {
  if (input === undefined) return null;

  const checksum = getInputChecksum(input);
  const stored = persistDigitalArchiveFile({
    entity,
    input,
    previousPath,
    fallbackBaseName,
  });

  if (!stored?.storedPath) return null;

  const fileMeta = {
    file_path: stored.storedPath,
    file_name:
      stored.fileName ||
      deriveDocumentFileName(stored.storedPath, fallbackBaseName),
    mime_type: stored.mimeType || input?.mime_type || input?.mimeType || null,
    size_bytes: getInputSize(input),
    checksum,
  };

  Object.defineProperty(fileMeta, NEW_UPLOAD, {
    value: stored.isNewUpload === true,
    enumerable: false,
  });

  return fileMeta;
}

function normalizeUploadFiles(payload, options = {}) {
  const {
    fileKey = "file",
    filesKey = "files",
  } = options;
  if (!payload || typeof payload !== "object") return [];

  const multi = Array.isArray(payload[filesKey])
    ? payload[filesKey].filter(Boolean)
    : [];
  if (multi.length > 0) return multi;

  return payload[fileKey] ? [payload[fileKey]] : [];
}

function persistDomainFiles({ entity, inputs, fallbackBaseName }) {
  if (!Array.isArray(inputs) || inputs.length === 0) return [];

  return inputs
    .map((input) =>
      persistDomainFile({
        entity,
        input,
        fallbackBaseName,
      }),
    )
    .filter(Boolean);
}

function cleanupPersistedDomainFiles(fileMetas) {
  if (!Array.isArray(fileMetas)) return;

  for (const fileMeta of fileMetas) {
    if (fileMeta?.[NEW_UPLOAD] === true) {
      deleteStoredFile(fileMeta.file_path);
    }
  }
}

async function withDomainFileRollback(operation) {
  if (typeof operation !== "function") {
    throw new TypeError("Operasi file domain wajib berupa fungsi.");
  }

  const persistedFileMetas = [];
  const persistFiles = (options) => {
    const fileMetas = persistDomainFiles(options);
    persistedFileMetas.push(...fileMetas);
    return fileMetas;
  };

  try {
    return await operation(persistFiles);
  } catch (error) {
    cleanupPersistedDomainFiles(persistedFileMetas);
    throw error;
  }
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
    name: normalizeDownloadFileName({
      fileName: record[`${prefix}file_name`],
      storedPath: path,
      fallbackBaseName,
    }),
    mime_type: record[`${prefix}mime_type`] || null,
    size_bytes: record[`${prefix}size_bytes`] || null,
    checksum: prefix ? null : record.checksum || null,
    url,
  };
}

function serializeStoredFile(req, record, options = {}) {
  if (!record) return null;
  const {
    module = "debtor_information",
    entityId = record?.id,
    fallbackBaseName = "dokumen",
    pathKey = "file_path",
    nameKey = "file_name",
    mimeKey = "mime_type",
    sizeKey = "size_bytes",
    checksumKey = "checksum",
  } = options;
  const path = record[pathKey];
  if (!path) return null;

  const url = appendFileAccessToken(req, buildFileUrl(req, path), {
    storedPath: path,
    module,
    entityId,
  });

  return {
    path,
    name: normalizeDownloadFileName({
      fileName: record[nameKey],
      storedPath: path,
      fallbackBaseName,
    }),
    mime_type: record[mimeKey] || null,
    size_bytes: record[sizeKey] || null,
    checksum: record[checksumKey] || null,
    url,
  };
}

function serializeFiles(req, record, options = {}) {
  const {
    relationKey = "files",
    module = "debtor_information",
    fallbackBaseName = "dokumen",
    includeLegacy = true,
    legacyPrefix = "",
  } = options;
  if (!record) return [];

  const items = Array.isArray(record[relationKey]) ? record[relationKey] : [];
  const serialized = items
    .map((item) =>
      serializeStoredFile(req, item, {
        module,
        entityId: item.id,
        fallbackBaseName,
      }),
    )
    .filter(Boolean);

  if (!includeLegacy) return serialized;

  const legacy = serializeFile(req, record, {
    module,
    entityId: record.id,
    prefix: legacyPrefix,
    fallbackBaseName,
  });
  if (!legacy) return serialized;
  if (serialized.some((item) => item.path === legacy.path)) return serialized;
  return [legacy, ...serialized];
}

module.exports = {
  applyFileMeta,
  cleanupPersistedDomainFiles,
  persistDomainFile,
  persistDomainFiles,
  normalizeUploadFiles,
  serializeFile,
  serializeFiles,
  serializeStoredFile,
  withDomainFileRollback,
};
