const service = require("./digitalDocumentAccessRequests.service");
const { paginatedResponse, successResponse } = require("../../utils/response");

exports.getAll = async (req, res) => {
  try {
    const result = await service.getAll({
      req,
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
      message: "Pengajuan akses dokumen berhasil dibuat",
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

exports.approve = async (req, res) => {
  try {
    const result = await service.approve({
      req,
      id: req.params.id,
      payload: req.body,
      userId: req.user?.id,
    });

    return successResponse(res, result, "Pengajuan akses berhasil disetujui");
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};

exports.reject = async (req, res) => {
  try {
    const result = await service.reject({
      req,
      id: req.params.id,
      payload: req.body,
      userId: req.user?.id,
    });

    return successResponse(res, result, "Pengajuan akses berhasil ditolak");
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};
