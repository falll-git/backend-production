const service = require("./debtorMarketing.service");
const { paginatedResponse, successResponse } = require("../../utils/response");

function status(error, fallback = 400) {
  return error.statusCode || fallback;
}

exports.getAll = async (req, res) => {
  try {
    const result = await service.getAll({ req, kindSlug: req.params.kind, query: req.query });
    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.getById = async (req, res) => {
  try {
    return successResponse(res, await service.getById({ req, kindSlug: req.params.kind, id: req.params.id }));
  } catch (error) {
    return res.status(status(error, 404)).json({ status: false, success: false, message: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const data = await service.create({ req, kindSlug: req.params.kind, payload: req.body, userId: req.user?.id });
    return res.status(201).json({ status: true, success: true, message: "Aktivitas marketing berhasil dibuat.", data });
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    return successResponse(
      res,
      await service.update({ req, kindSlug: req.params.kind, id: req.params.id, payload: req.body, userId: req.user?.id }),
      "Aktivitas marketing berhasil diperbarui.",
    );
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    await service.delete({ kindSlug: req.params.kind, id: req.params.id, userId: req.user?.id });
    return successResponse(res, null, "Aktivitas marketing berhasil dihapus.");
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};
