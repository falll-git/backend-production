const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = require("./jwt");

const ORIGINAL_ENV = {
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN,
};

process.env.JWT_SECRET = "access-secret-for-jwt-security-test-123";
process.env.JWT_REFRESH_SECRET = "refresh-secret-for-jwt-security-test-456";
process.env.JWT_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "1d";

test.after(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("token akses dan refresh hanya diterima untuk audience masing-masing", () => {
  const accessToken = generateAccessToken({ id: "user-1", session_id: "session-1" });
  const refreshToken = generateRefreshToken({ id: "user-1", jti: "session-1" });

  assert.equal(verifyAccessToken(accessToken).id, "user-1");
  assert.equal(verifyRefreshToken(refreshToken).id, "user-1");
  assert.throws(() => verifyAccessToken(refreshToken));
  assert.throws(() => verifyRefreshToken(accessToken));
});

test("refresh token dapat direkonstruksi secara deterministik dari waktu terbit", () => {
  const issuedAtSeconds = Math.floor(Date.now() / 1000) - 60;
  const issuedAt = new Date(issuedAtSeconds * 1000);
  const payload = { id: "user-1", jti: "session-1" };

  const firstToken = generateRefreshToken(payload, { issuedAt });
  const reconstructedToken = generateRefreshToken(payload, { issuedAt });

  assert.equal(reconstructedToken, firstToken);
  assert.equal(verifyRefreshToken(reconstructedToken).iat, issuedAtSeconds);
});

test("verifikasi menolak algoritma selain HS256", () => {
  const token = jwt.sign(
    { id: "user-1", session_id: "session-1" },
    process.env.JWT_SECRET,
    {
      algorithm: "HS512",
      issuer: "ruwang-arsip-api",
      audience: "ruwang-arsip-access",
      expiresIn: "15m",
    },
  );

  assert.throws(() => verifyAccessToken(token));
});
