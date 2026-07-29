const service = require("./clientErrors.service");

exports.report = (req, res) => {
  service.recordClientError(req.body, req.requestId || null);

  return res.status(202).json({
    status: true,
    success: true,
    message: "Laporan kendala diterima.",
    data: {
      event_id: req.body.event_id,
      request_id: req.requestId || null,
    },
  });
};
