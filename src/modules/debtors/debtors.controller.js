const service = require("./debtors.service");
const { paginatedResponse, successResponse } = require("../../utils/response");

function status(error, fallback = 400) {
  return error.statusCode || fallback;
}

exports.getAll = async (req, res) => {
  try {
    const result = await service.getAll({ query: req.query, userId: req.user?.id });
    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.getById = async (req, res) => {
  try {
    return successResponse(res, await service.getById({ id: req.params.id, userId: req.user?.id }));
  } catch (error) {
    return res.status(status(error, 404)).json({ status: false, success: false, message: error.message });
  }
};

exports.getWorkflow = async (req, res) => {
  try {
    return successResponse(
      res,
      await service.getWorkflow({ req, id: req.params.id, userId: req.user?.id }),
    );
  } catch (error) {
    return res.status(status(error, 404)).json({ status: false, success: false, message: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const data = await service.create({ payload: req.body, userId: req.user?.id });
    return res.status(201).json({ status: true, success: true, message: "Debitur berhasil dibuat.", data });
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    return successResponse(
      res,
      await service.update({ id: req.params.id, payload: req.body, userId: req.user?.id }),
      "Debitur berhasil diperbarui.",
    );
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    await service.delete({ id: req.params.id, userId: req.user?.id });
    return successResponse(res, null, "Debitur berhasil dihapus.");
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.getContracts = async (req, res) => {
  try {
    const result = await service.getContracts({
      debtorId: req.params.id,
      query: req.query,
      userId: req.user?.id,
    });
    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.createContract = async (req, res) => {
  try {
    const data = await service.createContract({
      debtorId: req.params.id,
      payload: req.body,
      userId: req.user?.id,
    });
    return res.status(201).json({ status: true, success: true, message: "Kontrak debitur berhasil dibuat.", data });
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.getDocuments = async (req, res) => {
  try {
    const result = await service.getDocuments({
      req,
      debtorId: req.params.id,
      query: req.query,
      userId: req.user?.id,
    });
    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.createDocument = async (req, res) => {
  try {
    const data = await service.createDocument({
      req,
      debtorId: req.params.id,
      payload: req.body,
      userId: req.user?.id,
    });
    return res.status(201).json({ status: true, success: true, message: "Dokumen debitur berhasil diunggah.", data });
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};
