const jwt = require("jsonwebtoken");

const JWT_ALGORITHM = "HS256";
const JWT_ISSUER = "ruwang-arsip-api";
const ACCESS_TOKEN_AUDIENCE = "ruwang-arsip-access";
const REFRESH_TOKEN_AUDIENCE = "ruwang-arsip-refresh";

function requireSecret(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} belum dikonfigurasi.`);
  }

  return value;
}

exports.generateAccessToken = (payload) => {
  const expiresIn = process.env.JWT_EXPIRES_IN;
  if (!expiresIn) {
    throw new Error("JWT_EXPIRES_IN belum dikonfigurasi.");
  }

  return jwt.sign(payload, requireSecret("JWT_SECRET"), {
    algorithm: JWT_ALGORITHM,
    issuer: JWT_ISSUER,
    audience: ACCESS_TOKEN_AUDIENCE,
    expiresIn,
  });
};

exports.generateRefreshToken = (payload, { issuedAt = null } = {}) => {
  const expiresIn = process.env.JWT_REFRESH_EXPIRES_IN;
  if (!expiresIn) {
    throw new Error("JWT_REFRESH_EXPIRES_IN belum dikonfigurasi.");
  }

  const issuedAtSeconds =
    issuedAt instanceof Date && Number.isFinite(issuedAt.getTime())
      ? Math.floor(issuedAt.getTime() / 1000)
      : null;

  return jwt.sign(
    issuedAtSeconds === null ? payload : { ...payload, iat: issuedAtSeconds },
    requireSecret("JWT_REFRESH_SECRET"),
    {
    algorithm: JWT_ALGORITHM,
    issuer: JWT_ISSUER,
    audience: REFRESH_TOKEN_AUDIENCE,
    expiresIn,
    },
  );
};

exports.verifyAccessToken = (token) => {
  return jwt.verify(token, requireSecret("JWT_SECRET"), {
    algorithms: [JWT_ALGORITHM],
    issuer: JWT_ISSUER,
    audience: ACCESS_TOKEN_AUDIENCE,
  });
};

exports.verifyRefreshToken = (token) => {
  return jwt.verify(token, requireSecret("JWT_REFRESH_SECRET"), {
    algorithms: [JWT_ALGORITHM],
    issuer: JWT_ISSUER,
    audience: REFRESH_TOKEN_AUDIENCE,
  });
};
