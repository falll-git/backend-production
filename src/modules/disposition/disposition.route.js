const express = require("express");
const router = express.Router();
const controller = require("./disposition.controller");
const validate = require("../../middlewares/validate.middleware");
const auth = require("../../middlewares/auth.middleware");
const {
  createDispositionSchema,
  updateDispositionSchema,
} = require("./disposition.validation");

router.get("/", auth, controller.getAll);
router.post("/", auth, validate(createDispositionSchema), controller.create);
router.get("/:id", auth, controller.getById);
router.put("/:id", auth, validate(updateDispositionSchema), controller.update);
router.delete("/:id", auth, controller.delete);

module.exports = router;
