const service = require("./debtorImports.service");
const { paginatedResponse, successResponse } = require("../../utils/response");

function status(error, fallback = 400) {
  return error.statusCode || fallback;
}

exports.getAll = async (req, res) => {
  try {
    const result = await service.getAll({ req, query: req.query });
    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.getPendingIdeb = async (req, res) => {
  try {
    const result = await service.getPendingIdeb({ req, query: req.query });
    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
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
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.getIdebResumePdf = async (req, res) => {
  try {
    const result = await service.getIdebResumePdf({
      uploadId: req.params.uploadId,
      userId: req.user?.id,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.fileName}"`,
    );
    res.setHeader("Content-Length", String(result.buffer.length));
    return res.send(result.buffer);
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
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
      return res.status(status(error)).json({ status: false, success: false, message: error.message });
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
