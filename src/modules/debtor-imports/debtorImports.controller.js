const service = require("./debtorImports.service");
const { paginatedResponse, successResponse } = require("../../utils/response");
const {
  buildContentDisposition,
} = require("../../utils/file-names");
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
    event: "debtor_import_request_failed",
    message: "Debtor import request failed",
  });
  return res.status(Math.max(500, fallbackStatus)).json({
    status: false,
    success: false,
    message: "Gagal memproses impor data debitur.",
  });
}

exports.getAll = async (req, res) => {
  try {
    const result = await service.getAll({ req, query: req.query });
    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getPendingIdeb = async (req, res) => {
  try {
    const result = await service.getPendingIdeb({ req, query: req.query });
    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return sendError(res, error);
  }
};

exports.resolveIdeb = async (req, res) => {
  try {
    return successResponse(
      res,
      await service.resolveIdeb({
        req,
        uploadId: req.params.uploadId,
        payload: req.body,
        userId: req.user?.id,
      }),
      "Hasil IDEB berhasil dihubungkan.",
    );
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getIdebResumePdf = async (req, res) => {
  try {
    const result = await service.getIdebResumePdf({
      uploadId: req.params.uploadId,
      userId: req.user?.id,
      facilityFilter: req.query.facility_filter,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      buildContentDisposition(result.fileName, "attachment"),
    );
    res.setHeader("Content-Length", String(result.buffer.length));
    return res.send(result.buffer);
  } catch (error) {
    return sendError(res, error);
  }
};

exports.retrySlik = async (req, res) => {
  try {
    return successResponse(
      res,
      await service.retrySlikJob({
        req,
        jobId: req.params.jobId,
        userId: req.user?.id,
      }),
      "Job Import SLIK dijadwalkan ulang.",
    );
  } catch (error) {
    return sendError(res, error);
  }
};

function createHandler(type) {
  return async (req, res) => {
    try {
      const data = await service.createJob({
        req,
        type,
        payload: req.body,
        userId: req.user?.id,
      });
      return res.status(201).json({ status: true, success: true, message: "Job import berhasil dibuat.", data });
    } catch (error) {
      return sendError(res, error);
    }
  };
}

exports.createMaster = createHandler("MASTER");
exports.createCollectibility = createHandler("COLLECTIBILITY");
exports.createSlik = createHandler("SLIK");
exports.createIdeb = createHandler("IDEB");
exports.createDeprecated = async (_req, res) =>
  res.status(410).json({
    status: false,
    success: false,
    message:
      "Endpoint import ini sudah digabung ke Import SLIK. Gunakan /api/debtor-imports/slik.",
  });
