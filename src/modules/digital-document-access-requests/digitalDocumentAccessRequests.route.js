const express = require("express");

const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const controller = require("./digitalDocumentAccessRequests.controller");
const { REVOKE_FEATURE } = require("../../utils/menu-access");
const {
  approveAccessRequestSchema,
  createAccessRequestSchema,
  rejectAccessRequestSchema,
  revokeAccessRequestSchema,
} = require("./digitalDocumentAccessRequests.validation");

const router = express.Router();

const ACCESS_REQUEST_READ_URLS = [
  "/dashboard/arsip-digital/disposisi/pengajuan",
  "/dashboard/arsip-digital/disposisi/permintaan",
  "/dashboard/arsip-digital/disposisi/historis",
];
const ACCESS_REQUEST_CREATE_URL = "/dashboard/arsip-digital/disposisi/pengajuan";
const ACCESS_REQUEST_ACTION_URL = "/dashboard/arsip-digital/disposisi/permintaan";
const ACCESS_REQUEST_HISTORY_URL = "/dashboard/arsip-digital/disposisi/historis";

router.get("/", auth, authorize(ACCESS_REQUEST_READ_URLS, "read"), controller.getAll);
router.post(
  "/",
  auth,
  authorize(ACCESS_REQUEST_CREATE_URL, "create"),
  validate(createAccessRequestSchema),
  controller.create,
);
router.get("/:id", auth, authorize(ACCESS_REQUEST_READ_URLS, "read"), controller.getById);
router.patch(
  "/:id/approve",
  auth,
  authorize(ACCESS_REQUEST_ACTION_URL, "update"),
  validate(approveAccessRequestSchema),
  controller.approve,
);
router.patch(
  "/:id/reject",
  auth,
  authorize(ACCESS_REQUEST_ACTION_URL, "update"),
  validate(rejectAccessRequestSchema),
  controller.reject,
);
router.patch(
  "/:id/revoke",
  auth,
  authorize(ACCESS_REQUEST_HISTORY_URL, "update", { feature: REVOKE_FEATURE }),
  validate(revokeAccessRequestSchema),
  controller.revoke,
);

module.exports = router;
