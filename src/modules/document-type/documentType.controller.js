const service = require("./documentType.service");
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

    const result = await service.getDocumentTypes({ pagination, search });
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
    const result = await service.getDocumentTypeById(req.params.id);
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
    const result = await service.createDocumentType(req.body);
    return res.status(201).json({
      status: true,
      data: result,
      message: "Jenis dokumen berhasil dibuat.",
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
    const result = await service.updateDocumentType(req.params.id, req.body);
    return res.status(200).json({
      status: true,
      message: "Jenis dokumen berhasil diperbarui.",
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
    await service.deleteDocumentType(req.params.id);
    successResponse(res, null, "Jenis dokumen berhasil dihapus.");
  } catch (error) {
    return res.status(resolveStatusCode(error, 500)).json({
      status: false,
      message: error.message,
    });
  }
};
