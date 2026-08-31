const multer = require("multer");
const { isUploadMetadataAllowed } = require("../utils/upload-file-policy");

const allowedExtensions = new Set(["jpg", "jpeg", "png", "webp"]);
const mimeTypesByExtension = {
  jpg: ["image/jpeg", "image/jpg"],
  jpeg: ["image/jpeg", "image/jpg"],
  png: ["image/png"],
  webp: ["image/webp"],
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 4, parts: 5 },
  fileFilter(req, file, callback) {
    if (!isUploadMetadataAllowed(file, { allowedExtensions, mimeTypesByExtension })) {
      return callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "image"));
    }
    return callback(null, true);
  },
});

function uploadPublicImage(req, res, next) {
  upload.single("image")(req, res, (error) => {
    if (!error) return next();
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 422;
    return res.status(status).json({
      status: false,
      message:
        error.code === "LIMIT_FILE_SIZE"
          ? "Ukuran gambar maksimal 10 MB."
          : "Gunakan satu gambar JPG, PNG, atau WebP yang valid.",
    });
  });
}

module.exports = { uploadPublicImage };
