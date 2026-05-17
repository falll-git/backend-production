const service = require("./debtorReports.service");
const { successResponse } = require("../../utils/response");

function status(error, fallback = 400) {
  return error.statusCode || fallback;
}

exports.summary = async (req, res) => {
  try {
    return successResponse(res, await service.getSummary(req.query));
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.npf = async (req, res) => {
  try {
    return successResponse(res, await service.getNpf(req.query));
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.marketingActivity = async (req, res) => {
  try {
    return successResponse(res, await service.getMarketingActivity(req.query));
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};
