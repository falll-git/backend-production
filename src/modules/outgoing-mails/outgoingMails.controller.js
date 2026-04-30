const service = require("./outgoingMails.service");
const { paginatedResponse, successResponse } = require("../../utils/response");

exports.getAll = async (req, res) => {
  try {
    const result = await service.getAll({ req, query: req.query });

    if (result.meta) {
      return paginatedResponse(res, result.data, result.meta);
    }

    return successResponse(res, result.data);
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const result = await service.getById({ req, id: req.params.id });
    return successResponse(res, result);
  } catch (error) {
    return res.status(404).json({ status: false, message: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const result = await service.create({ req, payload: req.body, userId });
    return res.status(201).json({
      status: true,
      data: result,
      message: "Surat keluar berhasil dibuat",
    });
  } catch (err) {
    return res.status(400).json({ status: false, message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const result = await service.update({
      req,
      id: req.params.id,
      payload: req.body,
      userId,
    });
    return res.status(200).json({
      status: true,
      message: "Surat keluar berhasil diperbarui",
      data: result,
    });
  } catch (err) {
    return res.status(400).json({ status: false, message: err.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    await service.delete(req.params.id, userId);
    return res.status(200).json({
      status: true,
      message: "Surat keluar berhasil dihapus",
      data: null,
    });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};
