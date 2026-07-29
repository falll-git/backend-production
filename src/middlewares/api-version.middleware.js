const {
  API_VERSION,
  API_VERSION_PATH,
  LEGACY_API_PATH,
} = require("../utils/api-version");

function apiVersion(req, res, next) {
  res.setHeader("X-API-Version", API_VERSION);
  return next();
}

function legacyApi(req, res, next) {
  if (req.originalUrl === API_VERSION_PATH || req.originalUrl.startsWith(`${API_VERSION_PATH}/`)) {
    return next();
  }

  const successorUrl = req.originalUrl.replace(
    new RegExp(`^${LEGACY_API_PATH}(?=/|$)`),
    API_VERSION_PATH,
  );

  res.setHeader("X-API-Deprecated", "true");
  res.setHeader(
    "Warning",
    '299 Ruang-Arsip-API "Deprecated API path; use /api/v1"',
  );
  res.append("Link", `<${successorUrl}>; rel="successor-version"`);
  return next();
}

module.exports = { apiVersion, legacyApi };
