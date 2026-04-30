const crypto = require("crypto");

const DEFAULT_INVITE_EXPIRES_HOURS = 72;
const DEFAULT_RESET_PASSWORD_EXPIRES_HOURS = 2;

function generatePlainToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getExpiryDate(rawValue, defaultHours) {
  const rawHours = Number(rawValue);
  const hours =
    Number.isFinite(rawHours) && rawHours > 0 ? rawHours : defaultHours;

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + hours);
  return expiresAt;
}

function getInviteExpiryDate() {
  return getExpiryDate(
    process.env.AUTH_INVITE_EXPIRES_HOURS,
    DEFAULT_INVITE_EXPIRES_HOURS,
  );
}

function getResetPasswordExpiryDate() {
  return getExpiryDate(
    process.env.AUTH_RESET_PASSWORD_EXPIRES_HOURS,
    DEFAULT_RESET_PASSWORD_EXPIRES_HOURS,
  );
}

function buildSetPasswordPath(token) {
  return `/set-password?token=${encodeURIComponent(token)}`;
}

function buildResetPasswordPath(token) {
  return `/reset-password?token=${encodeURIComponent(token)}`;
}

function getFrontendBaseUrl() {
  return (
    process.env.FRONTEND_URL ||
    process.env.APP_URL ||
    process.env.CLIENT_URL ||
    process.env.WEB_URL
  );
}

function buildFrontendUrl(path) {
  const baseUrl = getFrontendBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  return `${normalizedBaseUrl}${path}`;
}

function buildSetPasswordUrl(token) {
  return buildFrontendUrl(buildSetPasswordPath(token));
}

function buildResetPasswordUrl(token) {
  return buildFrontendUrl(buildResetPasswordPath(token));
}

module.exports = {
  buildSetPasswordPath,
  buildSetPasswordUrl,
  buildResetPasswordPath,
  buildResetPasswordUrl,
  generatePlainToken,
  getInviteExpiryDate,
  getResetPasswordExpiryDate,
  hashToken,
};
