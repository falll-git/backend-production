const service = require("./disposition.service");
const { paginatedResponse, successResponse } = require("../../utils/response");

exports.getAll = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = req.query.search || "";

    const result = await service.getDispositions({ page, limit, search });
    paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getById = async (req, res) => {
  try {
    const result = await service.getDispositionById(req.params.id);
    successResponse(res, result);
  } catch (error) {
    res.status(400).json({
      status: false,
      message: error.message,
    });
  }
};

exports.create = async (req, res) => {
  try {
    const result = await service.createDisposition(req.body);
    return res.status(201).json({
      status: true,
      data: result,
      message: "Disposition created successfully",
    });
  } catch (err) {
    return res.status(400).json({
      status: false,
      message: err.message,
    });
  }
};

exports.update = async (req, res) => {
  try {
    const result = await service.updateDisposition(req.params.id, req.body);
    return res.status(200).json({
      status: true,
      message: "Disposition updated successfully",
      data: result,
    });
  } catch (err) {
    return res.status(400).json({
      status: false,
      message: err.message,
    });
  }
};

exports.delete = async (req, res) => {
  try {
    await service.deleteDisposition(req.params.id);
    successResponse(res, null, "Disposition deleted successfully");
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: error.message,
    });
  }
};
