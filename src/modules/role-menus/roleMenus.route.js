const express = require("express");
const router = express.Router();
const controller = require("./roleMenus.controller");
const validate = require("../../middlewares/validate.middleware");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const {
  createRoleMenuSchema,
  updateRoleMenuSchema,
} = require("./roleMenus.validation");

const ROLE_MENU_URL = "/dashboard/parameter/role-menu";

router.get("/", auth, controller.getAll);
router.post(
  "/",
  auth,
  authorize(ROLE_MENU_URL, "create"),
  validate(createRoleMenuSchema),
  controller.create,
);
router.get("/:id", auth, controller.getById);
router.put(
  "/:id",
  auth,
  authorize(ROLE_MENU_URL, "update"),
  validate(updateRoleMenuSchema),
  controller.update,
);
router.delete(
  "/:id",
  auth,
  authorize(ROLE_MENU_URL, "delete"),
  controller.delete,
);

module.exports = router;
