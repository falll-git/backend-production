const healthService = require("./health.service");
const { API_VERSION } = require("../utils/api-version");

function disableHealthCaching(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

exports.liveness = (req, res) => {
  disableHealthCaching(res);
  const uptime = process.uptime();
  return res.json({
    status: true,
    success: true,
    message: "OK",
    uptime,
    data: {
      service: "Ruang Arsip API",
      version: API_VERSION,
      state: "alive",
      uptime_seconds: uptime,
    },
  });
};

exports.readiness = async (req, res, next) => {
  disableHealthCaching(res);

  try {
    const result = await healthService.checkReadiness();
    return res.status(result.ready ? 200 : 503).json({
      status: result.ready,
      success: result.ready,
      message: result.ready ? "READY" : "NOT_READY",
      data: result,
    });
  } catch (error) {
    return next(error);
  }
};
