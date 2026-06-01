const multer = require("multer");
const {
  DOCUMENT_UPLOAD_MAX_SIZE_BYTES,
  DOCUMENT_UPLOAD_MAX_SIZE_LABEL,
} = require("../utils/upload-limits");

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
  "text/plain",
  "text/csv",
  "application/csv",
  "application/json",
  "text/json",
  "image/png",
  "image/jpeg",
  "image/jpg",
]);
const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "zip",
  "txt",
  "csv",
  "json",
  "jpg",
  "jpeg",
  "png",
]);

function getFileExtension(fileName) {
  if (typeof fileName !== "string") return "";

  const trimmed = fileName.trim().toLowerCase();
  if (!trimmed.includes(".")) return "";

  return trimmed.split(".").pop() || "";
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: DOCUMENT_UPLOAD_MAX_SIZE_BYTES,
  },
  fileFilter(req, file, callback) {
    const extension = getFileExtension(file.originalname);
    const mimeType = (file.mimetype || "").toLowerCase();
    const isMimeAllowed = ALLOWED_MIME_TYPES.has(mimeType);
    const isExtensionAllowed = ALLOWED_EXTENSIONS.has(extension);

    if (!isMimeAllowed && !isExtensionAllowed) {
      return callback(
        new multer.MulterError(
          "LIMIT_UNEXPECTED_FILE",
          "Format file harus PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, TXT, CSV, JSON, JPG, JPEG, atau PNG.",
        ),
      );
    }

    return callback(null, true);
  },
});

function uploadDomainFile(fieldName = "file") {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (error) => {
      if (error) {
        if (error instanceof multer.MulterError) {
          if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({
              status: false,
              message: `Ukuran file maksimal ${DOCUMENT_UPLOAD_MAX_SIZE_LABEL}.`,
            });
          }

          return res.status(400).json({
            status: false,
            message: error.field || error.message || "File tidak valid.",
          });
        }

        return res.status(400).json({
          status: false,
          message: error.message || "Gagal memproses upload file.",
        });
      }

      if (req.file) {
        req.body.file = {
          buffer: req.file.buffer,
          name: req.file.originalname,
          mime_type: req.file.mimetype,
          size_bytes: req.file.size,
        };
      }

      return next();
    });
  };
}

function uploadDomainFiles(fieldName = "files", maxCount = 20) {
  return (req, res, next) => {
    const fields =
      fieldName === "file"
        ? [{ name: "file", maxCount }]
        : [
            { name: fieldName, maxCount },
            { name: "file", maxCount: 1 },
          ];

    upload.fields(fields)(req, res, (error) => {
      if (error) {
        if (error instanceof multer.MulterError) {
          if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({
              status: false,
              message: `Ukuran file maksimal ${DOCUMENT_UPLOAD_MAX_SIZE_LABEL}.`,
            });
          }

          return res.status(400).json({
            status: false,
            message: error.field || error.message || "File tidak valid.",
          });
        }

        return res.status(400).json({
          status: false,
          message: error.message || "Gagal memproses upload file.",
        });
      }

      const uploadedFiles = Object.values(req.files || {}).flat();
      if (uploadedFiles.length > 0) {
        req.body.files = uploadedFiles.map((file) => ({
          buffer: file.buffer,
          name: file.originalname,
          mime_type: file.mimetype,
          size_bytes: file.size,
        }));
      }

      return next();
    });
  };
}

module.exports = {
  uploadDomainFile,
  uploadDomainFiles,
};
