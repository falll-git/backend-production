const service = require("./debtorReports.service");
const { successResponse } = require("../../utils/response");

function status(error, fallback = 400) {
  return error.statusCode || fallback;
}

exports.summary = async (req, res) => {
  try {
    return successResponse(
      res,
      await service.getSummary(req.query, req.user?.id),
    );
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.portfolio = async (req, res) => {
  try {
    return successResponse(res, await service.getPortfolio(req.query, req.user?.id));
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.facilities = async (req, res) => {
  try {
    return successResponse(res, await service.getFacilities(req.query, req.user?.id));
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.collaterals = async (req, res) => {
  try {
    return successResponse(res, await service.getCollaterals(req.query, req.user?.id));
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.completeness = async (req, res) => {
  try {
    return successResponse(res, await service.getCompleteness(req.query, req.user?.id));
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.npf = async (req, res) => {
  try {
    return successResponse(res, await service.getNpf(req.query, req.user?.id));
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.marketingActivity = async (req, res) => {
  try {
    return successResponse(
      res,
      await service.getMarketingActivity(req, req.query, req.user?.id),
    );
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};
