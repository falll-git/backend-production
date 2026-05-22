const multer = require("multer");
const {
  DOCUMENT_UPLOAD_MAX_SIZE_BYTES,
  DOCUMENT_UPLOAD_MAX_SIZE_LABEL,
} = require("../utils/upload-limits");
const {
  attachUploadTempCleanup,
  buildDiskUploadStorage,
} = require("../utils/upload-temp-files");

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
  storage: buildDiskUploadStorage(multer),
  limits: {
    fileSize: DOCUMENT_UPLOAD_MAX_SIZE_BYTES,
  },
  fileFilter(req, file, callback) {
    const extension = getFileExtension(file.originalname);
    const isMimeAllowed = ALLOWED_MIME_TYPES.has(
      (file.mimetype || "").toLowerCase(),
    );
    const isExtensionAllowed = ALLOWED_EXTENSIONS.has(extension);

    if (!isMimeAllowed && !isExtensionAllowed) {
      return callback(
        new multer.MulterError(
          "LIMIT_UNEXPECTED_FILE",
          "Format file harus PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, JPG, JPEG, atau PNG.",
        ),
      );
    }

    return callback(null, true);
  },
});

function uploadDigitalArchiveFile(fieldName = "file") {
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
            message:
              error.field || error.message || "File arsip digital tidak valid",
          });
        }

        return res.status(400).json({
          status: false,
          message: error.message || "Gagal memproses upload file arsip digital",
        });
      }

      if (req.file) {
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

module.exports = {
  uploadDigitalArchiveFile,
};
