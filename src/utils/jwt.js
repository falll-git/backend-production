const jwt = require("jsonwebtoken");

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
    expiresIn,
  });
};

exports.generateRefreshToken = (payload) => {
  const expiresIn = process.env.JWT_REFRESH_EXPIRES_IN;
  if (!expiresIn) {
    throw new Error("JWT_REFRESH_EXPIRES_IN belum dikonfigurasi.");
  }

  return jwt.sign(payload, requireSecret("JWT_REFRESH_SECRET"), {
    expiresIn,
  });
};
