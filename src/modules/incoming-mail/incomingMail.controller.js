const service = require("./incomingMail.service");
const { paginatedResponse, successResponse } = require("../../utils/response");

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
    return res.status(400).json({
      status: false,
      message: error.message,
    });
  }
};

exports.getById = async (req, res) => {
  try {
    const result = await service.getIncomingMailsById({
      req,
      id: req.params.id,
    });
    return successResponse(res, result);
  } catch (error) {
    return res.status(404).json({
      status: false,
      message: error.message,
    });
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
      message: "Surat masuk beserta disposisi awal ke manajer berhasil dibuat",
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      status: false,
      message: error.message,
    });
  }
};

exports.update = async (req, res) => {
  try {
    const result = await service.updateIncomingMail({
      req,
      id: req.params.id,
      payload: req.body,
    });

    return res.status(200).json({
      status: true,
      message: "Surat masuk berhasil diperbarui",
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      status: false,
      message: error.message,
    });
  }
};

exports.delete = async (req, res) => {
  try {
    await service.deleteIncomingMail(req.params.id);
    return successResponse(res, null, "Surat masuk berhasil dihapus");
  } catch (error) {
    return res.status(400).json({
      status: false,
      message: error.message,
    });
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
    return res.status(400).json({
      status: false,
      message: error.message,
    });
  }
};

exports.complete = async (req, res) => {
  try {
    const result = await service.completeIncomingMail({
      req,
      id: req.params.id,
    });
    return res.status(200).json({
      status: true,
      message: "Surat masuk berhasil ditandai selesai",
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      status: false,
      message: error.message,
    });
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
    return res.status(400).json({
      status: false,
      message: error.message,
    });
  }
};
