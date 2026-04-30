const service = require("./digitalDocuments.service");
const { paginatedResponse, successResponse } = require("../../utils/response");

exports.getAll = async (req, res) => {
  try {
    const result = await service.getAll({
      req,
      query: req.query,
      userId: req.user?.id,
    });

    if (result.meta) {
      return paginatedResponse(res, result.data, result.meta);
    }

    return successResponse(res, result.data);
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};

exports.getById = async (req, res) => {
  try {
    const result = await service.getById({
      req,
      id: req.params.id,
      userId: req.user?.id,
    });

    return successResponse(res, result);
  } catch (error) {
    return res.status(error.statusCode || 404).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};

exports.getActivityLogs = async (req, res) => {
  try {
    const result = await service.getActivityLogs({
      id: req.params.id,
      query: req.query,
      userId: req.user?.id,
    });

    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};

exports.create = async (req, res) => {
  try {
    const result = await service.create({
      req,
      payload: req.body,
      userId: req.user?.id,
    });

    return res.status(201).json({
      status: true,
      success: true,
      message: "Dokumen digital berhasil dibuat",
      data: result,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};

exports.update = async (req, res) => {
  try {
    const result = await service.update({
      req,
      id: req.params.id,
      payload: req.body,
      userId: req.user?.id,
    });

    return res.status(200).json({
      status: true,
      success: true,
      message: "Dokumen digital berhasil diperbarui",
      data: result,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};

exports.delete = async (req, res) => {
  try {
    await service.delete({
      id: req.params.id,
      userId: req.user?.id,
    });

    return successResponse(res, null, "Dokumen digital berhasil dihapus");
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};
