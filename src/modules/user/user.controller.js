const service = require("./user.service");
const { paginatedResponse, successResponse } = require("../../utils/response");

function resolveStatusCode(error, fallback = 400) {
  return error.statusCode || fallback;
}

exports.getAll = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = req.query.search || "";

    const result = await service.getUsers({ page, limit, search });
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
    const result = await service.getUserById(req.params.id);
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
    const result = await service.createUser(req.body);
    return res.status(201).json({
      status: true,
      data: result,
      message: "User created successfully",
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
    const result = await service.updateUser(req.params.id, req.body);
    return res.status(200).json({
      status: true,
      message: "User updated successfully",
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
    await service.deleteUser(req.params.id);
    successResponse(res, null, "User deleted successfully");
  } catch (error) {
    return res.status(resolveStatusCode(error, 500)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.getMe = async (req, res) => {
  try {
    const userId = req.user.id;
    const data = await service.getProfile(userId);
    successResponse(res, data);
  } catch (error) {
    res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.sendInvite = async (req, res) => {
  try {
    const result = await service.sendInvite(req.params.id);
    return res.status(200).json({
      status: true,
      message: "Invitation generated successfully",
      data: result,
    });
  } catch (error) {
    return res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};
