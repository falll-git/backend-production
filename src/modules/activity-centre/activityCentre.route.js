const express = require("express");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const {
  exportRateLimit,
} = require("../../middlewares/rate-limit.middleware");
const controller = require("./activityCentre.controller");
const validation = require("./activityCentre.validation");

const router = express.Router();
const MENU_URL = "/dashboard/activity-centre";
const canRead = [auth, authorize(MENU_URL, "read")];

router.get(
  "/",
  ...canRead,
  validate(validation.listSchema, { source: "query" }),
  controller.list,
);
router.get(
  "/summary",
  ...canRead,
  validate(validation.exportSchema, { source: "query" }),
  controller.summary,
);
router.get("/options", ...canRead, controller.options);
router.get(
  "/export",
  ...canRead,
  exportRateLimit,
  validate(validation.exportSchema, { source: "query" }),
  controller.exportExcel,
);
router.get(
  "/:id",
  ...canRead,
  validate(validation.idSchema, { source: "params" }),
  controller.getById,
);

module.exports = router;
