const jwt = require("jsonwebtoken");

const FILE_TOKEN_QUERY_PARAM = "file_token";
const FILE_ACCESS_TOKEN_TYPE = "document_file_access";

function getFileAccessSecret() {
  return process.env.FILE_ACCESS_SECRET;
}

function getFileAccessExpiresIn() {
  return process.env.FILE_ACCESS_TOKEN_EXPIRES_IN || "15m";
}

function createFileAccessToken({ req, storedPath, module, entityId }) {
  const userId = req?.user?.id;
  const secret = getFileAccessSecret();

  if (!userId || !secret || !storedPath || !module || !entityId) return null;

  return jwt.sign(
    {
      type: FILE_ACCESS_TOKEN_TYPE,
      path: storedPath,
      module,
      entity_id: entityId,
      user_id: userId,
    },
    secret,
    {
      expiresIn: getFileAccessExpiresIn(),
    },
  );
}

function appendFileAccessToken(req, url, { storedPath, module, entityId }) {
  if (!url || !storedPath) return url;

  const token = createFileAccessToken({
    req,
    storedPath,
    module,
    entityId,
  });

  if (!token) return url;

  try {
    const isRelative = String(url).startsWith("/");
    const parsed = new URL(url, isRelative ? "http://localhost" : undefined);
    parsed.searchParams.set(FILE_TOKEN_QUERY_PARAM, token);

    return isRelative
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : parsed.toString();
  } catch {
    return url;
  }
}

function verifyFileAccessToken(token) {
  const secret = getFileAccessSecret();
  if (!secret || !token) return null;

  try {
    const payload = jwt.verify(token, secret);
    if (!payload || payload.type !== FILE_ACCESS_TOKEN_TYPE) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = {
  FILE_TOKEN_QUERY_PARAM,
  appendFileAccessToken,
  verifyFileAccessToken,
};
