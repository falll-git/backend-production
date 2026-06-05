const service = require("./legal.service");
const { paginatedResponse, successResponse } = require("../../utils/response");

function status(error, fallback = 400) {
  return error.statusCode || fallback;
}

function list(method) {
  return async (req, res) => {
    try {
      const result = await service[method]({
        req,
        query: req.query,
        userId: req.user?.id,
      });
      return paginatedResponse(res, result.data, result.meta);
    } catch (error) {
      return res.status(status(error)).json({ status: false, success: false, message: error.message });
    }
  };
}

function create(method, message) {
  return async (req, res) => {
    try {
      const data = await service[method]({ req, payload: req.body, userId: req.user?.id });
      return res.status(201).json({ status: true, success: true, message, data });
    } catch (error) {
      return res.status(status(error)).json({ status: false, success: false, message: error.message });
    }
  };
}

function update(method, message) {
  return async (req, res) => {
    try {
      return successResponse(
        res,
        await service[method]({ req, id: req.params.id, payload: req.body, userId: req.user?.id }),
        message,
      );
    } catch (error) {
      return res.status(status(error)).json({ status: false, success: false, message: error.message });
    }
  };
}

function remove(modelName, message) {
  return async (req, res) => {
    try {
      await service.deleteRecord({ modelName, id: req.params.id, userId: req.user?.id });
      return successResponse(res, null, message);
    } catch (error) {
      return res.status(status(error)).json({ status: false, success: false, message: error.message });
    }
  };
}

exports.listTemplates = list("listTemplates");
exports.createTemplate = create("createTemplate", "Template legal berhasil dibuat.");
exports.updateTemplate = update("updateTemplate", "Template legal berhasil diperbarui.");
exports.deleteTemplate = async (req, res) => {
  try {
    await service.deleteTemplate({ id: req.params.id, userId: req.user?.id });
    return successResponse(res, null, "Template legal berhasil dihapus.");
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.listPrints = list("listPrints");
exports.printDocumentContext = async (req, res) => {
  try {
    return successResponse(
      res,
      await service.getPrintDocumentContext({
        query: req.query,
        userId: req.user?.id,
      }),
    );
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};
exports.createPrint = create("createPrint", "Dokumen legal berhasil dicetak.");

exports.listNotaryProgress = list("listNotaryProgress");
exports.createNotaryProgress = create("createNotaryProgress", "Progress notaris berhasil dibuat.");
exports.updateNotaryProgress = update("updateNotaryProgress", "Progress notaris berhasil diperbarui.");
exports.deleteNotaryProgress = remove("legal_notary_progress", "Progress notaris berhasil dihapus.");

exports.listInsuranceProgress = list("listInsuranceProgress");
exports.createInsuranceProgress = create("createInsuranceProgress", "Progress asuransi berhasil dibuat.");
exports.updateInsuranceProgress = update("updateInsuranceProgress", "Progress asuransi berhasil diperbarui.");
exports.deleteInsuranceProgress = remove("legal_insurance_progress", "Progress asuransi berhasil dihapus.");

exports.listKjppProgress = list("listKjppProgress");
exports.createKjppProgress = create("createKjppProgress", "Progress KJPP berhasil dibuat.");
exports.updateKjppProgress = update("updateKjppProgress", "Progress KJPP berhasil diperbarui.");
exports.deleteKjppProgress = remove("legal_kjpp_progress", "Progress KJPP berhasil dihapus.");

exports.listClaims = list("listClaims");
exports.createClaim = create("createClaim", "Klaim asuransi berhasil dibuat.");
exports.updateClaim = update("updateClaim", "Klaim asuransi berhasil diperbarui.");
exports.deleteClaim = remove("legal_claims", "Klaim asuransi berhasil dihapus.");

exports.listDeposits = async (req, res) => {
  try {
    const result = await service.listDeposits({
      query: req.query,
      userId: req.user?.id,
    });
    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};
exports.createDeposit = async (req, res) => {
  try {
    const data = await service.createDeposit({ payload: req.body, userId: req.user?.id });
    return res.status(201).json({ status: true, success: true, message: "Dana titipan berhasil dibuat.", data });
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};
exports.updateDeposit = async (req, res) => {
  try {
    return successResponse(
      res,
      await service.updateDeposit({ id: req.params.id, payload: req.body, userId: req.user?.id }),
      "Dana titipan berhasil diperbarui.",
    );
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};
exports.deleteDeposit = remove("legal_deposits", "Dana titipan berhasil dihapus.");

exports.listDepositTransactions = async (req, res) => {
  try {
    const result = await service.listDepositTransactions({
      query: req.query,
      userId: req.user?.id,
    });
    return paginatedResponse(res, result.data, result.meta);
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};
exports.createDepositTransaction = async (req, res) => {
  try {
    const data = await service.createDepositTransaction({ payload: req.body, userId: req.user?.id });
    return res.status(201).json({ status: true, success: true, message: "Transaksi titipan berhasil dibuat.", data });
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};

exports.summaryReport = async (req, res) => {
  try {
    return successResponse(
      res,
      await service.getSummaryReport(req.query, req.user?.id),
    );
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};
exports.thirdPartyDocumentsReport = async (req, res) => {
  try {
    return successResponse(
      res,
      await service.getThirdPartyDocumentsReport(req.query, req.user?.id),
    );
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};
exports.thirdPartyDepositFundsReport = async (req, res) => {
  try {
    return successResponse(
      res,
      await service.getThirdPartyDepositFundsReport(req.query, req.user?.id),
    );
  } catch (error) {
    return res.status(status(error)).json({ status: false, success: false, message: error.message });
  }
};
