const multer = require("multer");
const {
  isUploadContentAllowed,
  isUploadMetadataAllowed,
} = require("../utils/upload-file-policy");

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1,
    fields: 20,
    parts: 21,
    fieldNameSize: 100,
    fieldSize: 256 * 1024,
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
          "Format gambar watermark harus PNG, JPG, atau JPEG.",
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

      if (req.file && !isUploadContentAllowed(req.file)) {
        return res.status(400).json({
          status: false,
          message:
            "Isi gambar watermark tidak sesuai dengan format atau ekstensi yang dipilih.",
        });
      }

      return next();
    });
  };
}

module.exports = {
  uploadWatermarkImage,
};
