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
router.patch("/:id/read", auth, controller.markRead);
router.patch("/read-all", auth, controller.markAllRead);

module.exports = router;
