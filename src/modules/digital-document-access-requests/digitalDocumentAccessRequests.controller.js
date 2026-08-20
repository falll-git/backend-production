const service = require("./digitalDocumentAccessRequests.service");
const { paginatedResponse, successResponse } = require("../../utils/response");
const { logErrorOnce } = require("../../system/error-observability");

function sendError(res, error, fallbackStatus = 400) {
  if (error?.statusCode || error?.status) {
    return res.status(error.statusCode || error.status).json({
      status: false,
      success: false,
      message: error.message,
    });
  }

  logErrorOnce(error, {
    event: "digital_document_access_request_failed",
    message: "Digital document access request failed",
  });
  return res.status(Math.max(500, fallbackStatus)).json({
    status: false,
    success: false,
    message: "Gagal memproses pengajuan akses dokumen.",
  });
}

exports.getAll = async (req, res) => {
  try {
    const result = await service.getAll({
      req,
      query: req.query,
      userId: req.user?.id,
    });

    if (!result.meta) {
      return successResponse(res, result.data);
    }

    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return sendError(res, error);
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
    return sendError(res, error, 404);
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
    return sendError(res, error);
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
    return sendError(res, error);
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
    return sendError(res, error);
  }
};

exports.revoke = async (req, res) => {
  try {
    const result = await service.revoke({
      req,
      id: req.params.id,
      payload: req.body,
      userId: req.user?.id,
    });

    return successResponse(res, result, "Akses dokumen berhasil dicabut");
  } catch (error) {
    return sendError(res, error);
  }
};
