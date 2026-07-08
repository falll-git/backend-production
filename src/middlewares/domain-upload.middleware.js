const multer = require("multer");
const {
  DOCUMENT_UPLOAD_MAX_SIZE_BYTES,
  DOCUMENT_UPLOAD_MAX_SIZE_LABEL,
  getDocumentUploadMaxTotalSizeBytes,
  getDocumentUploadMaxTotalSizeMb,
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

const DEFAULT_ALLOWED_EXTENSIONS = new Set([
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

function createUpload(allowedExtensions, maxFiles) {
  return multer({
    storage: buildDiskUploadStorage(multer),
    limits: {
      fileSize: DOCUMENT_UPLOAD_MAX_SIZE_BYTES,
      files: maxFiles,
      fields: 100,
      parts: maxFiles + 100,
      fieldNameSize: 100,
      fieldSize: 1024 * 1024,
    },
    fileFilter(req, file, callback) {
      if (
        !isUploadMetadataAllowed(file, {
          allowedExtensions,
        })
      ) {
        return callback(
          new multer.MulterError(
            "LIMIT_UNEXPECTED_FILE",
            "Format atau ekstensi file tidak didukung.",
          ),
        );
      }

      return callback(null, true);
    },
  });
}

function uploadDomainFile(fieldName = "file", options = {}) {
  const allowedExtensions = new Set(
    options.allowedExtensions || DEFAULT_ALLOWED_EXTENSIONS,
  );
  const upload = createUpload(allowedExtensions, 1);

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
        if (!isUploadContentAllowed(req.file)) {
          cleanupUploadTempFileSync(req.file.path);
          return res.status(400).json({
            status: false,
            message:
              "Isi file tidak sesuai dengan format atau ekstensi yang dipilih.",
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

function uploadDomainFiles(fieldName = "files", maxCount = 20, options = {}) {
  const allowedExtensions = new Set(
    options.allowedExtensions || DEFAULT_ALLOWED_EXTENSIONS,
  );
  const upload = createUpload(allowedExtensions, maxCount + 1);

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
      if (uploadedFiles.some((file) => !isUploadContentAllowed(file))) {
        for (const file of uploadedFiles) {
          cleanupUploadTempFileSync(file.path);
        }
        return res.status(400).json({
          status: false,
          message:
            "Salah satu isi file tidak sesuai dengan format atau ekstensi yang dipilih.",
        });
      }

      const totalSize = uploadedFiles.reduce(
        (sum, file) => sum + Number(file.size || 0),
        0,
      );
      if (totalSize > getDocumentUploadMaxTotalSizeBytes()) {
        for (const file of uploadedFiles) {
          cleanupUploadTempFileSync(file.path);
        }
        return res.status(413).json({
          status: false,
          message: `Total ukuran file maksimal ${getDocumentUploadMaxTotalSizeMb()} MB.`,
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
  uploadDomainFile,
  uploadDomainFiles,
};
