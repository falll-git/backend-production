const service = require("./letterPriority.service");
const { paginatedResponse, successResponse } = require("../../utils/response");

function resolveStatusCode(error, fallback = 400) {
  return error.statusCode || fallback;
}

exports.getAll = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = req.query.search || "";

    const result = await service.getLetterPriorities({ page, limit, search });
    paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.getById = async (req, res) => {
  try {
    const result = await service.getLetterPriorityById(req.params.id);
    successResponse(res, result);
  } catch (error) {
    res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.create = async (req, res) => {
  try {
    const result = await service.createLetterPriority(req.body);
    return res.status(201).json({
      status: true,
      data: result,
      message: "Letter priority created successfully",
    });
  } catch (err) {
    return res.status(resolveStatusCode(err, 400)).json({
      status: false,
      message: err.message,
    });
  }
};

exports.update = async (req, res) => {
  try {
    const result = await service.updateLetterPriority(req.params.id, req.body);
    return res.status(200).json({
      status: true,
      message: "Letter priority updated successfully",
      data: result,
    });
  } catch (err) {
    return res.status(resolveStatusCode(err, 400)).json({
      status: false,
      message: err.message,
    });
  }
};

exports.delete = async (req, res) => {
  try {
    await service.deleteLetterPriority(req.params.id);
    successResponse(res, null, "Letter priority deleted successfully");
  } catch (error) {
    return res.status(resolveStatusCode(error, 500)).json({
      status: false,
      message: error.message,
    });
  }
};
