const multer = require("multer");
const {
  attachUploadTempCleanup,
  buildDiskUploadStorage,
  cleanupUploadTempFileSync,
} = require("../utils/upload-temp-files");
const {
  isUploadContentAllowed,
  isUploadMetadataAllowed,
} = require("../utils/upload-file-policy");

const DEFAULT_MAX_FILE_SIZE_MB = 500;
const DEFAULT_MAX_TOTAL_SIZE_MB = 1000;
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

function createUpload() {
  return multer({
    storage: buildDiskUploadStorage(multer),
    limits: {
      fileSize: getMaxFileSizeBytes(),
      files: 21,
      fields: 50,
      parts: 71,
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
      if (uploadedFiles.some((file) => !isUploadContentAllowed(file))) {
        for (const file of uploadedFiles) {
          cleanupUploadTempFileSync(file.path);
        }
        return res.status(400).json({
          status: false,
          message: "Isi file Import SLIK tidak sesuai dengan format TXT.",
        });
      }

      const totalSize = uploadedFiles.reduce(
        (sum, file) => sum + Number(file.size || 0),
        0,
      );
      const maxTotalSizeMb = readPositiveIntEnv(
        "SLIK_IMPORT_MAX_TOTAL_SIZE_MB",
        DEFAULT_MAX_TOTAL_SIZE_MB,
      );
      if (totalSize > maxTotalSizeMb * 1024 * 1024) {
        for (const file of uploadedFiles) {
          cleanupUploadTempFileSync(file.path);
        }
        return res.status(413).json({
          status: false,
          message: `Total ukuran file Import SLIK maksimal ${maxTotalSizeMb} MB.`,
        });
      }

      if (uploadedFiles.length > 0) {
        attachUploadTempCleanup(
          res,
          uploadedFiles.map((file) => file.path),
        );
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
