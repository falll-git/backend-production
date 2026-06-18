const service = require("./notifications.service");
const { paginatedResponse, successResponse } = require("../../utils/response");

function status(error, fallback = 400) {
  return error.statusCode || error.status || fallback;
}

exports.getAll = async (req, res) => {
  try {
    const result = await service.getAll({
      query: req.query,
      userId: req.user?.id,
    });
    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return res.status(status(error)).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const data = await service.getUnreadCount({
      userId: req.user?.id,
    });
    return successResponse(res, data);
  } catch (error) {
    return res.status(status(error)).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};

exports.markRead = async (req, res) => {
  try {
    const data = await service.markRead({
      id: req.params.id,
      userId: req.user?.id,
    });
    return successResponse(res, data, "Notifikasi ditandai dibaca.");
  } catch (error) {
    return res.status(status(error)).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    const data = await service.markAllRead({
      userId: req.user?.id,
    });
    return successResponse(res, data, "Semua notifikasi ditandai dibaca.");
  } catch (error) {
    return res.status(status(error)).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};

exports.clearOne = async (req, res) => {
  try {
    const data = await service.clearOne({
      id: req.params.id,
      userId: req.user?.id,
    });
    return successResponse(res, data, "Notifikasi dihapus.");
  } catch (error) {
    return res.status(status(error)).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};

exports.clearAll = async (req, res) => {
  try {
    const data = await service.clearAll({
      userId: req.user?.id,
    });
    return successResponse(res, data, "Semua notifikasi dibersihkan.");
  } catch (error) {
    return res.status(status(error)).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};
