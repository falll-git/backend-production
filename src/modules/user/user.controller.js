const service = require("./user.service");
const { paginatedResponse, successResponse } = require("../../utils/response");
const {
  PAGINATION_PROFILES,
  resolvePagination,
} = require("../../utils/pagination");

function resolveStatusCode(error, fallback = 400) {
  return error.statusCode || fallback;
}

exports.getAll = async (req, res) => {
  try {
    const pagination = resolvePagination(req.query, PAGINATION_PROFILES.SETUP);
    const search = req.query.search || "";

    const result = await service.getUsersForRequest({
      pagination,
      search,
      requestUser: req.user,
    });
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
      message: "Pengguna berhasil dibuat.",
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
      message: "Pengguna berhasil diperbarui.",
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
    await service.deleteUser(req.params.id, req.user.id);
    successResponse(res, null, "Pengguna berhasil dihapus.");
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

exports.closeAccess = async (req, res) => {
  try {
    const result = await service.closeAccess(req.params.id, req.user.id, req.body);
    successResponse(
      res,
      result,
      "Pengguna berhasil dinonaktifkan. Akun tidak dapat login dan tidak akan muncul dalam pilihan proses baru.",
    );
  } catch (error) {
    return res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.reactivateAccess = async (req, res) => {
  try {
    const result = await service.reactivateAccess(
      req.params.id,
      req.user.id,
      req.body,
    );
    successResponse(res, result, "Pengguna berhasil diaktifkan kembali.");
  } catch (error) {
    return res.status(resolveStatusCode(error, 400)).json({
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
      message: "Undangan aktivasi berhasil dibuat.",
      data: result,
    });
  } catch (error) {
    return res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};
