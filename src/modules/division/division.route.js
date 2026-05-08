const express = require("express");
const router = express.Router();
const controller = require("./division.controller");
const validate = require("../../middlewares/validate.middleware");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const {
  createDivisionSchema,
  updateDivisionSchema,
} = require("./division.validation");

const DIVISION_MENU_URL = "/dashboard/parameter/divisi";
const DIGITAL_DOCUMENT_INPUT_MENU_URL =
  "/dashboard/arsip-digital/input-dokumen";
const DIVISION_READ_MENU_URLS = [
  DIVISION_MENU_URL,
  DIGITAL_DOCUMENT_INPUT_MENU_URL,
];

router.get("/", auth, authorize(DIVISION_READ_MENU_URLS, "read"), controller.getAll);
router.post(
  "/",
  auth,
  authorize(DIVISION_MENU_URL, "create"),
  validate(createDivisionSchema),
  controller.create,
);
router.get("/:id", auth, authorize(DIVISION_READ_MENU_URLS, "read"), controller.getById);
router.put(
  "/:id",
  auth,
  authorize(DIVISION_MENU_URL, "update"),
  validate(updateDivisionSchema),
  controller.update,
);
router.delete(
  "/:id",
  auth,
  authorize(DIVISION_MENU_URL, "delete"),
  controller.delete,
);

module.exports = router;
