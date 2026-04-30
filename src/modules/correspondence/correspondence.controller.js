const { successResponse } = require("../../utils/response");
const service = require("./correspondence.service");

exports.getReport = async (req, res) => {
  try {
    const result = await service.getReport({
      req,
      query: req.query,
      userId: req.user.id,
    });

    return successResponse(res, result);
  } catch (error) {
    return res.status(400).json({
      status: false,
      message: error.message,
    });
  }
};

exports.getPrintableDocuments = async (req, res) => {
  try {
    const result = await service.getPrintableDocuments({
      req,
      query: req.query,
      userId: req.user.id,
    });

    return successResponse(res, result);
  } catch (error) {
    return res.status(400).json({
      status: false,
      message: error.message,
    });
  }
};
