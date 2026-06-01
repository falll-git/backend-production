const multer = require("multer");
const { buildDiskUploadStorage } = require("../utils/upload-temp-files");

const DEFAULT_MAX_FILE_SIZE_MB = 500;
const ALLOWED_MIME_TYPES = new Set([
  "application/octet-stream",
  "text/plain",
]);
const ALLOWED_EXTENSIONS = new Set(["txt"]);

function readPositiveIntEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function getMaxFileSizeBytes() {
  return (
    readPositiveIntEnv("SLIK_IMPORT_MAX_FILE_SIZE_MB", DEFAULT_MAX_FILE_SIZE_MB) *
    1024 *
    1024
  );
}

function getFileExtension(fileName) {
  if (typeof fileName !== "string") return "";
  const trimmed = fileName.trim().toLowerCase();
  if (!trimmed.includes(".")) return "";
  return trimmed.split(".").pop() || "";
}

function createUpload() {
  return multer({
    storage: buildDiskUploadStorage(multer),
    limits: {
      fileSize: getMaxFileSizeBytes(),
    },
    fileFilter(req, file, callback) {
      const extension = getFileExtension(file.originalname);
      const mimeType = (file.mimetype || "").toLowerCase();
      const isMimeAllowed = !mimeType || ALLOWED_MIME_TYPES.has(mimeType);
      const isExtensionAllowed = ALLOWED_EXTENSIONS.has(extension);

      if (!isMimeAllowed || !isExtensionAllowed) {
        return callback(
          new multer.MulterError(
            "LIMIT_UNEXPECTED_FILE",
            "Import SLIK hanya menerima file TXT.",
          ),
        );
      }

      return callback(null, true);
    },
  });
}

function uploadSlikImportFiles(fieldName = "files", maxCount = 20) {
  return (req, res, next) => {
    const fields =
      fieldName === "file"
        ? [{ name: "file", maxCount }]
        : [
            { name: fieldName, maxCount },
            { name: "file", maxCount: 1 },
          ];

    createUpload().fields(fields)(req, res, (error) => {
      if (error) {
        if (error instanceof multer.MulterError) {
          if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({
              status: false,
              message: `Ukuran file Import SLIK maksimal ${readPositiveIntEnv(
                "SLIK_IMPORT_MAX_FILE_SIZE_MB",
                DEFAULT_MAX_FILE_SIZE_MB,
              )} MB.`,
            });
          }

          return res.status(400).json({
            status: false,
            message: error.field || error.message || "File SLIK tidak valid.",
          });
        }

        return res.status(400).json({
          status: false,
          message: error.message || "Gagal memproses upload SLIK.",
        });
      }

      const uploadedFiles = Object.values(req.files || {}).flat();
      if (uploadedFiles.length > 0) {
        req.body.files = uploadedFiles.map((file) => ({
          temp_path: file.path,
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
  uploadSlikImportFiles,
};
