const { successResponse } = require("../../utils/response");
const service = require("./correspondence.service");

function resolveStatusCode(error, fallback = 400) {
  return error.statusCode || fallback;
}

exports.getReport = async (req, res) => {
  try {
    const result = await service.getReport({
      req,
      query: req.query,
      userId: req.user.id,
      requestUser: req.user,
    });

    return successResponse(res, result);
  } catch (error) {
    return res.status(resolveStatusCode(error, 400)).json({
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
      requestUser: req.user,
    });

    return successResponse(res, result);
  } catch (error) {
    return res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};
