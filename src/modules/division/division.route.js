const express = require("express");
const router = express.Router();
const controller = require("./division.controller");
const validate = require("../../middlewares/validate.middleware");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const {
  createDivisionSchema,
  updateDivisionSchema,
} = require("./division.validation");

const DIVISION_MENU_URL = "/dashboard/parameter/divisi";

router.get("/", auth, controller.getAll);
router.post(
  "/",
  auth,
  authorize(DIVISION_MENU_URL, "create"),
  validate(createDivisionSchema),
  controller.create,
);
router.get("/:id", auth, controller.getById);
router.put(
  "/:id",
  auth,
  authorize(DIVISION_MENU_URL, "update"),
  validate(updateDivisionSchema),
  controller.update,
);
router.delete(
  "/:id",
  auth,
  authorize(DIVISION_MENU_URL, "delete"),
  controller.delete,
);

module.exports = router;
