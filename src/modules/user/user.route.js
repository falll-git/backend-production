const express = require("express");
const router = express.Router();
const controller = require("./user.controller");
const validate = require("../../middlewares/validate.middleware");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const { createUserSchema, updateUserSchema } = require("./user.validation");

const USER_MENU_URL = "/dashboard/users";

router.get("/", auth, authorize(USER_MENU_URL, "read"), controller.getAll);
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
