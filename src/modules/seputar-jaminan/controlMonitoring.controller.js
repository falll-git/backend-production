const service = require("./controlMonitoring.service");
exports.snapshot = async (req, res) => {
  try { const result = await service.snapshot(req); for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
    return res.status(200).type("application/json").send(result.body); }
  catch (error) { return res.status(error.statusCode || 500).json({ status: false, success: false,
    message: error.statusCode ? error.message : "Monitoring belum dapat diproses." }); }
};
