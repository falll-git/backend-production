const service = require("./auth.service");
const { successResponse } = require("../../utils/response");

const FORGOT_PASSWORD_MESSAGE =
  "If the account is eligible, password reset instructions will be sent.";

function resolveStatusCode(error, fallback = 400) {
  return error.statusCode || fallback;
}

exports.login = async (req, res) => {
  try {
    const result = await service.login(req.body);
    successResponse(res, result);
  } catch (error) {
    res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const result = await service.refreshToken(refreshToken);
    successResponse(res, result);
  } catch (error) {
    res.status(resolveStatusCode(error, 401)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.logout = async (req, res) => {
  try {
    await service.logout(req.user.id);

    res.json({
      status: true,
      message: "Logout berhasil",
    });
  } catch (err) {
    res.status(resolveStatusCode(err, 400)).json({
      status: false,
      message: err.message,
    });
  }
};

exports.changePassword = async (req, res) => {
  try {
    await service.changePassword(req.user.id, req.body);

    res.json({
      status: true,
      message: "Password berhasil diubah",
    });
  } catch (err) {
    res.status(resolveStatusCode(err, 400)).json({
      status: false,
      message: err.message,
    });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    await service.forgotPassword(req.body);
    successResponse(res, null, FORGOT_PASSWORD_MESSAGE);
  } catch (error) {
    res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.verifySetPasswordToken = async (req, res) => {
  try {
    const result = await service.verifySetPasswordToken(req.body.token);
    successResponse(res, result);
  } catch (error) {
    res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.verifyResetPasswordToken = async (req, res) => {
  try {
    const result = await service.verifyResetPasswordToken(req.body.token);
    successResponse(res, result);
  } catch (error) {
    res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.setPassword = async (req, res) => {
  try {
    const result = await service.setPassword(req.body);
    successResponse(res, result, "Password has been set successfully");
  } catch (error) {
    res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const result = await service.resetPassword(req.body);
    successResponse(res, result, "Password has been reset successfully");
  } catch (error) {
    res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};
