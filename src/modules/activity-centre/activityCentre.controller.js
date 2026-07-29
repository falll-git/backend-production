const service = require("./activityCentre.service");
const { paginatedResponse, successResponse } = require("../../utils/response");
const { logErrorOnce } = require("../../system/error-observability");

function sendError(res, error) {
  const statusCode = error.statusCode || error.status || 500;
  if (statusCode >= 500) {
    logErrorOnce(error, {
      event: "activity_centre_request_failed",
      message: "Pusat Log Aktivitas request failed",
    });
  }
  return res.status(statusCode).json({
    status: false,
    success: false,
    message: statusCode >= 500 ? "Gagal memproses log aktivitas." : error.message,
  });
}

exports.list = async (req, res) => {
  try {
    const result = await service.list(req.query);
    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getById = async (req, res) => {
  try {
    return successResponse(res, await service.getById(req.params.id));
  } catch (error) {
    return sendError(res, error);
  }
};

exports.summary = async (req, res) => {
  try {
    return successResponse(res, await service.summary(req.query));
  } catch (error) {
    return sendError(res, error);
  }
};

exports.options = async (req, res) => {
  try {
    return successResponse(res, await service.options());
  } catch (error) {
    return sendError(res, error);
  }
};

exports.exportExcel = async (req, res) => {
  try {
    const result = await service.exportExcel(req.query);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`,
    );
    return res.send(result.buffer);
  } catch (error) {
    return sendError(res, error);
  }
};
