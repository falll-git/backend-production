const express = require("express");
const router = express.Router();
const controller = require("./letterPriority.controller");
const validate = require("../../middlewares/validate.middleware");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const {
  createLetterPrioritySchema,
  updateLetterPrioritySchema,
} = require("./letterPriority.validation");

const LETTER_PRIORITY_MENU_URL = "/dashboard/parameter/prioritas-surat";

router.get("/", auth, authorize(LETTER_PRIORITY_MENU_URL, "read"), controller.getAll);
router.post(
  "/",
  auth,
  authorize(LETTER_PRIORITY_MENU_URL, "create"),
  validate(createLetterPrioritySchema),
  controller.create,
);
router.get("/:id", auth, authorize(LETTER_PRIORITY_MENU_URL, "read"), controller.getById);
router.put(
  "/:id",
  auth,
  authorize(LETTER_PRIORITY_MENU_URL, "update"),
  validate(updateLetterPrioritySchema),
  controller.update,
);
router.delete(
  "/:id",
  auth,
  authorize(LETTER_PRIORITY_MENU_URL, "delete"),
  controller.delete,
);

module.exports = router;
