const express = require("express");
const router = express.Router();
const controller = require("./menus.controller");
const validate = require("../../middlewares/validate.middleware");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const { createMenuSchema, updateMenuSchema } = require("./menus.validation");

const ROLE_MENU_URL = "/dashboard/parameter/role-menu";

router.get("/", auth, controller.getAll);
router.get(
  "/all",
  auth,
  authorize(ROLE_MENU_URL, "read"),
  controller.getAllForManagement,
);
router.post(
  "/",
  auth,
  authorize(ROLE_MENU_URL, "create"),
  validate(createMenuSchema, { abortEarly: false }),
  controller.create,
);
router.get("/:id", auth, controller.getById);
router.put(
  "/:id",
  auth,
  authorize(ROLE_MENU_URL, "update"),
  validate(updateMenuSchema, { abortEarly: false }),
  controller.update,
);
router.delete("/:id", auth, authorize(ROLE_MENU_URL, "delete"), controller.delete);

module.exports = router;
