const multer = require("multer");
const {
  DOCUMENT_UPLOAD_MAX_SIZE_BYTES,
  DOCUMENT_UPLOAD_MAX_SIZE_LABEL,
} = require("../utils/upload-limits");
const {
  attachUploadTempCleanup,
  buildDiskUploadStorage,
  cleanupUploadTempFileSync,
} = require("../utils/upload-temp-files");
const {
  isUploadContentAllowed,
  isUploadMetadataAllowed,
} = require("../utils/upload-file-policy");

const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "jpg",
  "jpeg",
  "png",
]);

const upload = multer({
  storage: buildDiskUploadStorage(multer),
  limits: {
    fileSize: DOCUMENT_UPLOAD_MAX_SIZE_BYTES,
    files: 1,
    fields: 100,
    parts: 101,
    fieldNameSize: 100,
    fieldSize: 1024 * 1024,
  },
  fileFilter(req, file, callback) {
    if (
      !isUploadMetadataAllowed(file, {
        allowedExtensions: ALLOWED_EXTENSIONS,
      })
    ) {
      return callback(
        new multer.MulterError(
          "LIMIT_UNEXPECTED_FILE",
          "Format dokumen harus PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, JPG, JPEG, atau PNG.",
        ),
      );
    }

    return callback(null, true);
  },
});

function uploadPersuratanFile(fieldName = "file") {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (error) => {
      if (error) {
        if (error instanceof multer.MulterError) {
          if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({
              status: false,
              message: `Ukuran dokumen maksimal ${DOCUMENT_UPLOAD_MAX_SIZE_LABEL}.`,
            });
          }

          return res.status(400).json({
            status: false,
            message:
              error.field ||
              error.message ||
              "Dokumen yang diunggah tidak valid.",
          });
        }

        return res.status(400).json({
          status: false,
          message: error.message || "Dokumen tidak dapat diproses.",
        });
      }

      if (req.file) {
        if (!isUploadContentAllowed(req.file)) {
          cleanupUploadTempFileSync(req.file.path);
          return res.status(400).json({
            status: false,
            message:
              "Isi dokumen tidak sesuai dengan format atau ekstensi yang dipilih.",
          });
        }

        attachUploadTempCleanup(res, req.file.path);
        req.body.file = {
          temp_path: req.file.path,
          name: req.file.originalname,
          mime_type: req.file.mimetype,
          size_bytes: req.file.size,
        };
      }

      return next();
    });
  };
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;

  return value;
}

function normalizeNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed) return value;

  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? value : parsed;
}

function safeJsonParse(value) {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed) return value;

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normalizePersuratanMultipartBody(options = {}) {
  const { jsonFields = [], numberFields = [], booleanFields = [] } = options;

  return (req, res, next) => {
    if (!req.is("multipart/form-data")) {
      return next();
    }

    for (const field of jsonFields) {
      if (req.body[field] !== undefined) {
        req.body[field] = safeJsonParse(req.body[field]);
      }
    }

    for (const field of numberFields) {
      if (req.body[field] !== undefined) {
        req.body[field] = normalizeNumber(req.body[field]);
      }
    }

    for (const field of booleanFields) {
      if (req.body[field] !== undefined) {
        req.body[field] = normalizeBoolean(req.body[field]);
      }
    }

    return next();
  };
}

module.exports = {
  uploadPersuratanFile,
  normalizePersuratanMultipartBody,
};
