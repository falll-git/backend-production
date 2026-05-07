const express = require("express");
const router = express.Router();
const controller = require("./role.controller");
const validate = require("../../middlewares/validate.middleware");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const { createRoleSchema, updateRoleSchema } = require("./role.validation");

const ROLE_MENU_URL = "/dashboard/parameter/role";

router.get("/", auth, authorize(ROLE_MENU_URL, "read"), controller.getAll);
router.post(
  "/",
  auth,
  authorize(ROLE_MENU_URL, "create"),
  validate(createRoleSchema),
  controller.create,
);
router.get("/:id", auth, authorize(ROLE_MENU_URL, "read"), controller.getById);
router.put(
  "/:id",
  auth,
  authorize(ROLE_MENU_URL, "update"),
  validate(updateRoleSchema),
  controller.update,
);
router.delete("/:id", auth, authorize(ROLE_MENU_URL, "delete"), controller.delete);

module.exports = router;
