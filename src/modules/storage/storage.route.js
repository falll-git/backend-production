const express = require("express");
const router = express.Router();
const controller = require("./storage.controller");
const validate = require("../../middlewares/validate.middleware");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const {
  createStorageSchema,
  updateStorageSchema,
} = require("./storage.validation");

const STORAGE_READ_MENU_URLS = [
  "/dashboard/parameter/tempat-penyimpanan",
  "/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan",
];
const STORAGE_WRITE_MENU_URL = "/dashboard/parameter/tempat-penyimpanan";

router.get("/", auth, authorize(STORAGE_READ_MENU_URLS, "read"), controller.getAll);
router.post(
  "/",
  auth,
  authorize(STORAGE_WRITE_MENU_URL, "create"),
  validate(createStorageSchema),
  controller.create,
);
router.get(
  "/:id",
  auth,
  authorize(STORAGE_READ_MENU_URLS, "read"),
  controller.getById,
);
router.put(
  "/:id",
  auth,
  authorize(STORAGE_WRITE_MENU_URL, "update"),
  validate(updateStorageSchema),
  controller.update,
);
router.delete(
  "/:id",
  auth,
  authorize(STORAGE_WRITE_MENU_URL, "delete"),
  controller.delete,
);

module.exports = router;
