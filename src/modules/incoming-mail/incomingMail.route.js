const express = require("express");
const router = express.Router();
const controller = require("./incomingMail.controller");
const validate = require("../../middlewares/validate.middleware");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const {
  normalizePersuratanMultipartBody,
  uploadPersuratanFile,
} = require("../../middlewares/persuratan-upload.middleware");
const {
  createIncomingMailWithDispositionSchema,
  redisposeIncomingMailSchema,
  updateIncomingDispositionStatusSchema,
  updateIncomingMailSchema,
} = require("./incomingMail.validation");

const INCOMING_MAIL_MENU_URL = "/dashboard/manajemen-surat/kelola-surat/input-surat-masuk";

router.get("/", auth, authorize(INCOMING_MAIL_MENU_URL, "read"), controller.getAll);
router.post(
  "/with-disposition",
  auth,
  authorize(INCOMING_MAIL_MENU_URL, "create"),
  uploadPersuratanFile("file"),
  validate(createIncomingMailWithDispositionSchema),
  controller.createWithDispo,
);
router.get("/:id", auth, authorize(INCOMING_MAIL_MENU_URL, "read"), controller.getById);
router.post(
  "/:id/redispose",
  auth,
  authorize(INCOMING_MAIL_MENU_URL, "update"),
  validate(redisposeIncomingMailSchema),
  controller.redispose,
);
router.patch(
  "/:id/dispositions/:dispositionId/status",
  auth,
  authorize(INCOMING_MAIL_MENU_URL, "update"),
  validate(updateIncomingDispositionStatusSchema),
  controller.updateDispositionStatus,
);
router.patch(
  "/:id/complete",
  auth,
  authorize(INCOMING_MAIL_MENU_URL, "update"),
  controller.complete,
);
router.put(
  "/:id",
  auth,
  authorize(INCOMING_MAIL_MENU_URL, "update"),
  uploadPersuratanFile("file"),
  normalizePersuratanMultipartBody({
    numberFields: ["status"],
  }),
  validate(updateIncomingMailSchema),
  controller.update,
);
router.delete(
  "/:id",
  auth,
  authorize(INCOMING_MAIL_MENU_URL, "delete"),
  controller.delete,
);

module.exports = router;
