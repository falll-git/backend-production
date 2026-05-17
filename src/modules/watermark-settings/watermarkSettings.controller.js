const service = require("./watermarkSettings.service");
const { successResponse } = require("../../utils/response");

function resolveStatusCode(error, fallback = 400) {
  return error.statusCode || fallback;
}

exports.getSettings = async (req, res) => {
  try {
    const result = await service.getSettings(req);
    successResponse(res, result);
  } catch (error) {
    res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.getOptions = async (req, res) => {
  try {
    successResponse(res, service.getOptions());
  } catch (error) {
    res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const result = await service.updateSettings(req.body, req.user, req);
    successResponse(res, result, "Konfigurasi watermark berhasil diperbarui.");
  } catch (error) {
    res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.updateImage = async (req, res) => {
  try {
    const result = await service.updateImage(req.file, req.user, req);
    successResponse(res, result, "Gambar watermark berhasil diperbarui.");
  } catch (error) {
    res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.deleteImage = async (req, res) => {
  try {
    const result = await service.deleteImage(req.user, req);
    successResponse(res, result, "Gambar watermark berhasil dihapus.");
  } catch (error) {
    res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.applyExistingFiles = async (req, res) => {
  try {
    const result = await service.applyExistingFiles();
    successResponse(res, result, "Watermark file existing mulai diproses.");
  } catch (error) {
    res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.getQueueSummary = async (req, res) => {
  try {
    const result = await service.getQueueSummary();
    successResponse(res, result);
  } catch (error) {
    res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};
