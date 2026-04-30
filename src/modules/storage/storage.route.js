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

const STORAGE_MENU_URLS = [
  "/dashboard/parameter/tempat-penyimpanan",
  "/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan",
];

router.get("/", auth, controller.getAll);
router.post(
  "/",
  auth,
  authorize(STORAGE_MENU_URLS, "create"),
  validate(createStorageSchema),
  controller.create,
);
router.get("/:id", auth, controller.getById);
router.put(
  "/:id",
  auth,
  authorize(STORAGE_MENU_URLS, "update"),
  validate(updateStorageSchema),
  controller.update,
);
router.delete(
  "/:id",
  auth,
  authorize(STORAGE_MENU_URLS, "delete"),
  controller.delete,
);

module.exports = router;
