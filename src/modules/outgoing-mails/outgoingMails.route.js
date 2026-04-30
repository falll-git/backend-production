const express = require("express");
const router = express.Router();
const controller = require("./outgoingMails.controller");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const {
  normalizePersuratanMultipartBody,
  uploadPersuratanFile,
} = require("../../middlewares/persuratan-upload.middleware");
const {
  createOutgoingMailSchema,
  updateOutgoingMailSchema,
} = require("./outgoingMails.validation");

const OUTGOING_MAIL_MENU_URL = "/dashboard/manajemen-surat/kelola-surat/input-surat-keluar";

router.get("/", auth, authorize(OUTGOING_MAIL_MENU_URL, "read"), controller.getAll);
router.post(
  "/",
  auth,
  authorize(OUTGOING_MAIL_MENU_URL, "create"),
  uploadPersuratanFile("file"),
  validate(createOutgoingMailSchema),
  controller.create,
);
router.get("/:id", auth, authorize(OUTGOING_MAIL_MENU_URL, "read"), controller.getById);
router.put(
  "/:id",
  auth,
  authorize(OUTGOING_MAIL_MENU_URL, "update"),
  uploadPersuratanFile("file"),
  normalizePersuratanMultipartBody({
    numberFields: ["status"],
  }),
  validate(updateOutgoingMailSchema),
  controller.update,
);
router.delete(
  "/:id",
  auth,
  authorize(OUTGOING_MAIL_MENU_URL, "delete"),
  controller.delete,
);

module.exports = router;
