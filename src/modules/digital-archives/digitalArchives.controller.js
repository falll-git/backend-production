const service = require("./digitalArchives.service");
const { paginatedResponse, successResponse } = require("../../utils/response");

exports.getStorageSummary = async (req, res) => {
  try {
    const result = await service.getStorageSummary({
      userId: req.user?.id,
    });

    return successResponse(res, result);
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};

exports.getOfficeCabinets = async (req, res) => {
  try {
    const result = await service.getOfficeCabinets({
      officeId: req.params.officeId,
      userId: req.user?.id,
    });

    return successResponse(res, result);
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};

exports.getCabinetRacks = async (req, res) => {
  try {
    const result = await service.getCabinetRacks({
      cabinetId: req.params.cabinetId,
      userId: req.user?.id,
    });

    return successResponse(res, result);
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};

exports.getRackDocuments = async (req, res) => {
  try {
    const result = await service.getRackDocuments({
      req,
      rackId: req.params.rackId,
      query: req.query,
      userId: req.user?.id,
    });

    if (result.meta) {
      return paginatedResponse(res, result.data, result.meta);
    }

    return successResponse(res, result.data);
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};

exports.getStorageHistories = async (req, res) => {
  try {
    const result = await service.getStorageHistories({
      query: req.query,
      userId: req.user?.id,
    });

    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};

exports.getAccessRequestHistories = async (req, res) => {
  try {
    const result = await service.getAccessRequestHistories({
      req,
      query: req.query,
      userId: req.user?.id,
    });

    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};

exports.getLoanHistories = async (req, res) => {
  try {
    const result = await service.getLoanHistories({
      req,
      query: req.query,
      userId: req.user?.id,
    });

    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};

exports.getLoanReport = async (req, res) => {
  try {
    const result = await service.getLoanReport({
      req,
      query: req.query,
      userId: req.user?.id,
    });

    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};

exports.getOverdueLoans = async (req, res) => {
  try {
    const result = await service.getOverdueLoans({
      req,
      query: req.query,
      userId: req.user?.id,
    });

    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: false,
      success: false,
      message: error.message,
    });
  }
};
