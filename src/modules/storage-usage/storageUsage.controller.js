const service = require("./storageUsage.service");
const { successResponse } = require("../../utils/response");

exports.getSummary = async (req, res) => {
  try {
    const result = await service.getSummary({ query: req.query });
    return successResponse(res, result, "Ringkasan storage berhasil dimuat");
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: false,
      message: error.message || "Ringkasan storage gagal dimuat",
    });
  }
};
