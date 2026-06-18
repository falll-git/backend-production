const express = require("express");
const auth = require("../../middlewares/auth.middleware");
const validate = require("../../middlewares/validate.middleware");
const controller = require("./notifications.controller");
const { listNotificationsQuerySchema } = require("./notifications.validation");

const router = express.Router();

router.get(
  "/",
  auth,
  validate(listNotificationsQuerySchema, { source: "query" }),
  controller.getAll,
);
router.get("/unread-count", auth, controller.getUnreadCount);
router.patch("/read-all", auth, controller.markAllRead);
router.delete("/clear-all", auth, controller.clearAll);
router.patch("/:id/read", auth, controller.markRead);
router.delete("/:id", auth, controller.clearOne);

module.exports = router;
