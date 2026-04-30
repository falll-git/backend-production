const multer = require("multer");

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
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
          "Format file harus PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, atau PNG.",
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
              message: "Ukuran file maksimal 15MB",
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
        req.body.file = {
          buffer: req.file.buffer,
          name: req.file.originalname,
          mime_type: req.file.mimetype,
        };
      }

      return next();
    });
  };
}

module.exports = {
  uploadDigitalArchiveFile,
};
