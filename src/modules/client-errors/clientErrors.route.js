const express = require("express");
const validate = require("../../middlewares/validate.middleware");
const {
  clientErrorReportRateLimit,
} = require("../../middlewares/rate-limit.middleware");
const controller = require("./clientErrors.controller");
const validation = require("./clientErrors.validation");

const router = express.Router();
const CLIENT_ERROR_REPORT_HEADER = "X-Client-Error-Report";

function requireReportRequest(req, res, next) {
  if (!req.is("application/json")) {
    return res.status(415).json({
      status: false,
      success: false,
      message: "Laporan kendala wajib menggunakan application/json.",
    });
  }

  if (req.get(CLIENT_ERROR_REPORT_HEADER) !== "1") {
    return res.status(400).json({
      status: false,
      success: false,
      message: "Penanda laporan kendala tidak valid.",
    });
  }

  return next();
}

router.post(
  "/",
  clientErrorReportRateLimit,
  requireReportRequest,
  validate(validation.reportSchema),
  controller.report,
);

module.exports = router;
module.exports.CLIENT_ERROR_REPORT_HEADER = CLIENT_ERROR_REPORT_HEADER;
module.exports.requireReportRequest = requireReportRequest;
