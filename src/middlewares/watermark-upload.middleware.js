const multer = require("multer");

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/svg+xml",
]);
const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "svg"]);

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
    const mimeType = String(file.mimetype || "").toLowerCase();

    if (
      !ALLOWED_MIME_TYPES.has(mimeType) ||
      !ALLOWED_EXTENSIONS.has(extension)
    ) {
      return callback(
        new multer.MulterError(
          "LIMIT_UNEXPECTED_FILE",
          "Format gambar watermark harus PNG, JPG, JPEG, atau SVG.",
        ),
      );
    }

    return callback(null, true);
  },
});

function uploadWatermarkImage(fieldName = "image") {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (error) => {
      if (error) {
        if (error instanceof multer.MulterError) {
          if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({
              status: false,
              message: "Ukuran gambar watermark maksimal 2MB.",
            });
          }

          return res.status(400).json({
            status: false,
            message:
              error.field ||
              error.message ||
              "Gambar watermark tidak valid.",
          });
        }

        return res.status(400).json({
          status: false,
          message: error.message || "Gagal memproses gambar watermark.",
        });
      }

      return next();
    });
  };
}

module.exports = {
  uploadWatermarkImage,
};
