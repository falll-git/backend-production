const express = require("express");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const controller = require("./debtorIdebReports.controller");

const router = express.Router();
const REPORT_URL = "/dashboard/informasi-debitur/laporan-ideb";

router.get("/", auth, authorize(REPORT_URL, "read"), controller.getAll);
router.get("/:uploadId", auth, authorize(REPORT_URL, "read"), controller.getById);

module.exports = router;
