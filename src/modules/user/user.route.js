const express = require("express");
const router = express.Router();
const controller = require("./user.controller");
const validate = require("../../middlewares/validate.middleware");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const {
  closeAccessSchema,
  createUserSchema,
  reactivateAccessSchema,
  updateUserSchema,
} = require("./user.validation");
const { DEBTOR_MENU_URLS } = require("../../utils/menu-access");

const USER_MENU_URL = "/dashboard/users";
const DIGITAL_DOCUMENT_INPUT_MENU_URL =
  "/dashboard/arsip-digital/input-dokumen";
const DIGITAL_DOCUMENT_LIST_MENU_URL =
  "/dashboard/arsip-digital/ruang-arsip/list-dokumen";
const USER_READ_MENU_URLS = [
  USER_MENU_URL,
  DIGITAL_DOCUMENT_INPUT_MENU_URL,
  DIGITAL_DOCUMENT_LIST_MENU_URL,
  ...DEBTOR_MENU_URLS,
];

router.get("/", auth, authorize(USER_READ_MENU_URLS, "read"), controller.getAll);
router.get("/me", auth, controller.getMe);
router.post(
  "/",
  auth,
  authorize(USER_MENU_URL, "create"),
  validate(createUserSchema),
  controller.create,
);
router.post(
  "/:id/send-invite",
  auth,
  authorize(USER_MENU_URL, "update"),
  controller.sendInvite,
);
router.post(
  "/:id/close-access",
  auth,
  authorize(USER_MENU_URL, "update"),
  validate(closeAccessSchema),
  controller.closeAccess,
);
router.post(
  "/:id/reactivate-access",
  auth,
  authorize(USER_MENU_URL, "update"),
  validate(reactivateAccessSchema),
  controller.reactivateAccess,
);
router.get("/:id", auth, authorize(USER_MENU_URL, "read"), controller.getById);
router.put(
  "/:id",
  auth,
  authorize(USER_MENU_URL, "update"),
  validate(updateUserSchema),
  controller.update,
);
router.delete("/:id", auth, authorize(USER_MENU_URL, "delete"), controller.delete);

module.exports = router;
