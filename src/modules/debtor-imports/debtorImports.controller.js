const service = require("./debtorImports.service");
const { paginatedResponse } = require("../../utils/response");

function status(error, fallback = 400) {
  return error.statusCode || fallback;
}

exports.getAll = async (req, res) => {
  try {
    const result = await service.getAll({ req, query: req.query });
    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

function createHandler(type) {
  return async (req, res) => {
    try {
      const data = await service.createJob({
        req,
        type,
        payload: req.body,
        userId: req.user?.id,
      });
      return res.status(201).json({ status: true, success: true, message: "Job import berhasil dibuat.", data });
    } catch (error) {
      return res.status(status(error)).json({ status: false, success: false, message: error.message });
    }
  };
}

exports.createMaster = createHandler("MASTER");
exports.createCollectibility = createHandler("COLLECTIBILITY");
exports.createSlik = createHandler("SLIK");
exports.createRestrik = createHandler("RESTRIK");
