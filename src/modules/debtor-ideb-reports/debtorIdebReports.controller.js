const service = require("../debtor-imports/debtorImports.service");
const { paginatedResponse, successResponse } = require("../../utils/response");

function status(error, fallback = 400) {
  return error.statusCode || fallback;
}

exports.getAll = async (req, res) => {
  try {
    const result = await service.getIdebReports({ req, query: req.query });
    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.getById = async (req, res) => {
  try {
    return successResponse(
      res,
      await service.getIdebReportDetail({ req, uploadId: req.params.uploadId }),
    );
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};
