const path = require("path");

const PUBLIC_PREFIX = "/api/watermarked-files";
const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(process.cwd(), "storage");
const STORAGE_ROOT = path.join(UPLOAD_ROOT, "watermarked-files");

module.exports = {
  PUBLIC_PREFIX,
  STORAGE_ROOT,
};
