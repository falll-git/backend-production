const service = require("./auth.service");
const { successResponse } = require("../../utils/response");
const {
  clearRefreshTokenCookie,
  readRefreshTokenCookie,
  setRefreshTokenCookie,
} = require("../../utils/auth-cookie");

const FORGOT_PASSWORD_MESSAGE =
  "Jika akun terdaftar dan aktif, instruksi reset password akan dikirim.";

function resolveStatusCode(error, fallback = 400) {
  return error.statusCode || fallback;
}

function resolveRefreshFailure(error) {
  const statusCode = Number(error?.statusCode);
  if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500) {
    return {
      message: error.message,
      statusCode,
    };
  }

  const databaseCode = String(error?.code || error?.cause?.code || "").trim();
  if (["P1001", "P1002", "P1008", "P2024", "P2028"].includes(databaseCode)) {
    return {
      message: "Layanan autentikasi sedang sibuk. Silakan coba lagi.",
      statusCode: 503,
    };
  }

  return {
    message: "Layanan autentikasi sedang mengalami gangguan. Silakan coba lagi.",
    statusCode:
      Number.isInteger(statusCode) && statusCode >= 500 ? statusCode : 500,
  };
}

function stripPrivateAuthFields(result) {
  if (!result || typeof result !== "object") return result;
  const { refreshToken, refreshTokenExpiresAt, ...safeResult } = result;
  return safeResult;
}

function readBearerAccessToken(req) {
  const authorization = req.headers.authorization;
  if (!authorization || !authorization.startsWith("Bearer ")) return null;

  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

function buildSessionContext(req) {
  return {
    ipAddress: String(req.ip || "").slice(0, 64) || null,
    userAgent: String(req.headers["user-agent"] || "").slice(0, 512) || null,
  };
}

exports.login = async (req, res) => {
  try {
    const result = await service.login(req.body, buildSessionContext(req));
    if (result.refreshToken) {
      setRefreshTokenCookie(res, result.refreshToken, {
        expiresAt: result.refreshTokenExpiresAt,
        remember: Boolean(req.body.remember),
      });
    }
    successResponse(res, stripPrivateAuthFields(result));
  } catch (error) {
    res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};

exports.refresh = async (req, res) => {
  try {
    const body = req.body || {};
    const refreshToken = readRefreshTokenCookie(req);
    const result = await service.refreshToken(
      refreshToken,
      buildSessionContext(req),
    );
    setRefreshTokenCookie(res, result.refreshToken, {
      expiresAt: result.refreshTokenExpiresAt,
      remember: Boolean(body.remember),
    });
    successResponse(res, stripPrivateAuthFields(result));
  } catch (error) {
    const failure = resolveRefreshFailure(error);
    // Jangan menghapus cookie pada request refresh yang gagal. Request lama dapat
    // selesai setelah request baru berhasil dan menghapus cookie sesi pengganti.
    // Cookie invalid tetap ditolak server dan akan ditimpa saat login berikutnya.
    res.status(failure.statusCode).json({
      status: false,
      message: failure.message,
    });
  }
};

exports.logout = async (req, res) => {
  try {
    const refreshToken = readRefreshTokenCookie(req);
    const accessToken = readBearerAccessToken(req);
    clearRefreshTokenCookie(res);
    const result = await service.logout({ refreshToken, accessToken });
    if (!req.user && result.actor_id) {
      req.user = { id: result.actor_id };
    }

    res.json({
      status: true,
      message: "Logout berhasil",
    });
  } catch (err) {
    clearRefreshTokenCookie(res);
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
    successResponse(res, result, "Password berhasil dibuat.");
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
    successResponse(res, result, "Password berhasil direset.");
  } catch (error) {
    res.status(resolveStatusCode(error, 400)).json({
      status: false,
      message: error.message,
    });
  }
};
