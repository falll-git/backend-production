const express = require("express");
const router = express.Router();
const controller = require("./documentType.controller");
const validate = require("../../middlewares/validate.middleware");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const {
  createDocumentTypeSchema,
  updateDocumentTypeSchema,
} = require("./documentType.validation");

const DOCUMENT_TYPE_MENU_URL = "/dashboard/parameter/jenis-dokumen";

router.get("/", auth, controller.getAll);
router.post(
  "/",
  auth,
  authorize(DOCUMENT_TYPE_MENU_URL, "create"),
  validate(createDocumentTypeSchema),
  controller.create,
);
router.get("/:id", auth, controller.getById);
router.put(
  "/:id",
  auth,
  authorize(DOCUMENT_TYPE_MENU_URL, "update"),
  validate(updateDocumentTypeSchema),
  controller.update,
);
router.delete(
  "/:id",
  auth,
  authorize(DOCUMENT_TYPE_MENU_URL, "delete"),
  controller.delete,
);

module.exports = router;
