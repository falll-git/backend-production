const service = require("./memorandum.service");
const { paginatedResponse, successResponse } = require("../../utils/response");

function resolveStatusCode(error, fallback = 400) {
  return error.statusCode || fallback;
}

exports.getAll = async (req, res) => {
  try {
    const result = await service.getMemorandums({
      req,
      query: req.query,
      userId: req.user.id,
    });

    if (result.meta) {
      return paginatedResponse(res, result.data, result.meta);
    }

    return successResponse(res, result.data);
  } catch (error) {
    return res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.getDispositionRecipients = async (req, res) => {
  try {
    const result = await service.getDispositionRecipients({
      query: req.query,
      currentUserId: req.user.id,
    });

    return successResponse(res, result);
  } catch (error) {
    return res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.getById = async (req, res) => {
  try {
    const result = await service.getMemorandumById({
      req,
      id: req.params.id,
      userId: req.user.id,
    });
    return successResponse(res, result);
  } catch (error) {
    return res.status(resolveStatusCode(error, 404)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.createWithDisposition = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const result = await service.createMemorandum({
      req,
      payload: req.body,
      userId,
    });
    return res.status(201).json({
      status: true,
      data: result,
      message:
        "Memorandum beserta disposisi awal ke penerima disposisi divisi berhasil dibuat",
    });
  } catch (error) {
    return res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.update = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const result = await service.updateMemorandum({
      req,
      id: req.params.id,
      payload: req.body,
      userId,
    });
    return res.status(200).json({
      status: true,
      message: "Memorandum berhasil diperbarui",
      data: result,
    });
  } catch (error) {
    return res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.delete = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    await service.deleteMemorandum(req.params.id, userId);
    return successResponse(res, null, "Memorandum berhasil dihapus");
  } catch (error) {
    return res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.redispose = async (req, res) => {
  try {
    const senderId = req.user ? req.user.id : null;
    const result = await service.redispose({
      id: req.params.id,
      payload: req.body,
      senderId,
    });
    return res.status(201).json({
      status: true,
      data: result,
      message: "Disposisi memorandum berhasil ditambahkan",
    });
  } catch (error) {
    return res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.complete = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const result = await service.completeMemorandum({
      req,
      memoId: req.params.id,
      userId,
    });
    return res.status(200).json({
      status: true,
      data: result,
      message: "Memorandum berhasil ditandai selesai",
    });
  } catch (error) {
    return res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.updateDispositionStatus = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const result = await service.updateDispositionStatus({
      req,
      memorandumId: req.params.id,
      dispositionId: req.params.dispositionId,
      status: req.body.status,
      userId,
    });
    return res.status(200).json({
      status: true,
      data: result,
      message: "Status disposisi memorandum berhasil diperbarui",
    });
  } catch (error) {
    return res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};
