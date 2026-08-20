const service = require("./incomingMail.service");
const { paginatedResponse, successResponse } = require("../../utils/response");
const { logErrorOnce } = require("../../system/error-observability");

function sendError(res, error, fallbackStatus = 400) {
  if (error?.statusCode || error?.status) {
    return res.status(error.statusCode || error.status).json({
      status: false,
      message: error.message,
    });
  }

  logErrorOnce(error, {
    event: "incoming_mail_request_failed",
    message: "Incoming mail request failed",
  });
  return res.status(Math.max(500, fallbackStatus)).json({
    status: false,
    message: "Gagal memproses surat masuk.",
  });
}

exports.getAll = async (req, res) => {
  try {
    const result = await service.getIncomingMails({
      req,
      query: req.query,
      userId: req.user.id,
    });

    if (result.meta) {
      return paginatedResponse(res, result.data, result.meta);
    }

    return successResponse(res, result.data);
  } catch (error) {
    return sendError(res, error);
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
    return sendError(res, error);
  }
};

exports.getById = async (req, res) => {
  try {
    const result = await service.getIncomingMailsById({
      req,
      id: req.params.id,
      userId: req.user.id,
    });
    return successResponse(res, result);
  } catch (error) {
    return sendError(res, error, 404);
  }
};

exports.createWithDispo = async (req, res) => {
  try {
    const result = await service.createIncomingMailsWithDispo({
      req,
      payload: req.body,
      senderId: req.user.id,
    });

    return res.status(201).json({
      status: true,
      message:
        "Surat masuk beserta disposisi awal ke penerima disposisi divisi berhasil dibuat",
      data: result,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.update = async (req, res) => {
  try {
    const result = await service.updateIncomingMail({
      req,
      id: req.params.id,
      payload: req.body,
      userId: req.user.id,
    });

    return res.status(200).json({
      status: true,
      message: "Surat masuk berhasil diperbarui",
      data: result,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.delete = async (req, res) => {
  try {
    await service.deleteIncomingMail(req.params.id, req.user.id);
    return successResponse(res, null, "Surat masuk berhasil dihapus");
  } catch (error) {
    return sendError(res, error);
  }
};

exports.redispose = async (req, res) => {
  try {
    const result = await service.redispose({
      id: req.params.id,
      payload: req.body,
      senderId: req.user.id,
    });

    return res.status(201).json({
      status: true,
      message: "Disposisi surat masuk berhasil ditambahkan",
      data: result,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.complete = async (req, res) => {
  try {
    const result = await service.completeIncomingMail({
      req,
      id: req.params.id,
      userId: req.user.id,
    });
    return res.status(200).json({
      status: true,
      message: "Surat masuk berhasil ditandai selesai",
      data: result,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.updateDispositionStatus = async (req, res) => {
  try {
    const result = await service.updateDispositionStatus({
      req,
      incomingMailId: req.params.id,
      dispositionId: req.params.dispositionId,
      status: req.body.status,
      userId: req.user.id,
    });

    return res.status(200).json({
      status: true,
      message: "Status disposisi surat masuk berhasil diperbarui",
      data: result,
    });
  } catch (error) {
    return sendError(res, error);
  }
};
