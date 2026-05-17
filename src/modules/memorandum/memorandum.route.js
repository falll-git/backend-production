const express = require("express");
const router = express.Router();
const controller = require("./memorandum.controller");
const validate = require("../../middlewares/validate.middleware");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const { REDISPOSE_FEATURE } = require("../../utils/menu-access");
const {
  normalizePersuratanMultipartBody,
  uploadPersuratanFile,
} = require("../../middlewares/persuratan-upload.middleware");
const {
  createMemorandumSchema,
  updateMemorandumSchema,
  redisposeMemorandumSchema,
  updateMemorandumDispositionStatusSchema,
} = require("./memorandum.validation");

const MEMORANDUM_MENU_URL = "/dashboard/manajemen-surat/kelola-surat/input-memorandum";

router.get("/", auth, authorize(MEMORANDUM_MENU_URL, "read"), controller.getAll);
router.post(
  "/with-disposition",
  auth,
  authorize(MEMORANDUM_MENU_URL, "create"),
  uploadPersuratanFile("file"),
  normalizePersuratanMultipartBody({
    jsonFields: ["target_division_ids"],
  }),
  validate(createMemorandumSchema),
  controller.createWithDisposition,
);
router.get(
  "/disposition-recipients",
  auth,
  authorize(MEMORANDUM_MENU_URL, "update", { feature: REDISPOSE_FEATURE }),
  controller.getDispositionRecipients,
);
router.get("/:id", auth, authorize(MEMORANDUM_MENU_URL, "read"), controller.getById);
router.post(
  "/:id/redispose",
  auth,
  authorize(MEMORANDUM_MENU_URL, "update", { feature: REDISPOSE_FEATURE }),
  validate(redisposeMemorandumSchema),
  controller.redispose,
);
router.patch(
  "/:id/dispositions/:dispositionId/status",
  auth,
  authorize(MEMORANDUM_MENU_URL, "update"),
  validate(updateMemorandumDispositionStatusSchema),
  controller.updateDispositionStatus,
);
router.patch(
  "/:id/complete",
  auth,
  authorize(MEMORANDUM_MENU_URL, "update"),
  controller.complete,
);
router.put(
  "/:id",
  auth,
  authorize(MEMORANDUM_MENU_URL, "update"),
  uploadPersuratanFile("file"),
  normalizePersuratanMultipartBody({
    numberFields: ["status"],
  }),
  validate(updateMemorandumSchema),
  controller.update,
);
router.delete(
  "/:id",
  auth,
  authorize(MEMORANDUM_MENU_URL, "delete"),
  controller.delete,
);

module.exports = router;
