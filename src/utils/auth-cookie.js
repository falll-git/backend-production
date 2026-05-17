function getRefreshTokenCookieName() {
  const cookieName = (process.env.AUTH_REFRESH_COOKIE_NAME || "").trim();
  if (!cookieName) {
    throw new Error("AUTH_REFRESH_COOKIE_NAME wajib diisi.");
  }

  return cookieName;
}

function parseCookieHeader(header) {
  if (!header || typeof header !== "string") return {};

  return header.split(";").reduce((cookies, item) => {
    const separatorIndex = item.indexOf("=");
    if (separatorIndex === -1) return cookies;

    const key = item.slice(0, separatorIndex).trim();
    const value = item.slice(separatorIndex + 1).trim();
    if (!key) return cookies;

    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
    return cookies;
  }, {});
}

function readRefreshTokenCookie(req) {
  return parseCookieHeader(req.headers.cookie)[getRefreshTokenCookieName()] || null;
}

function getSameSite() {
  const rawValue = (process.env.AUTH_COOKIE_SAME_SITE || "").trim().toLowerCase();
  if (rawValue === "strict" || rawValue === "lax" || rawValue === "none") {
    return rawValue;
  }

  return process.env.NODE_ENV === "production" ? "lax" : "lax";
}

function getCookieOptions({ expiresAt, remember } = {}) {
  const sameSite = getSameSite();
  const secure = process.env.NODE_ENV === "production" || sameSite === "none";
  const options = {
    httpOnly: true,
    secure,
    sameSite,
    path: "/api/auth",
  };
  const domain = (process.env.AUTH_COOKIE_DOMAIN || "").trim();

  if (domain) {
    options.domain = domain;
  }

  if (remember && expiresAt instanceof Date) {
    const maxAge = expiresAt.getTime() - Date.now();
    if (maxAge > 0) {
      options.maxAge = maxAge;
    }
  }

  return options;
}

function setRefreshTokenCookie(res, token, options = {}) {
  if (!token) return;
  res.cookie(getRefreshTokenCookieName(), token, getCookieOptions(options));
}

function clearRefreshTokenCookie(res) {
  res.clearCookie(getRefreshTokenCookieName(), getCookieOptions());
}

module.exports = {
  clearRefreshTokenCookie,
  readRefreshTokenCookie,
  setRefreshTokenCookie,
};
