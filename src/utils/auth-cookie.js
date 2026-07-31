function getRefreshTokenCookieName() {
  const cookieName = (process.env.AUTH_REFRESH_COOKIE_NAME || "").trim();
  if (!cookieName) {
    throw new Error("AUTH_REFRESH_COOKIE_NAME wajib diisi.");
  }

  return cookieName;
}

function parseCookieHeader(header) {
  if (!header || typeof header !== "string") return new Map();

  return header.split(";").reduce((cookies, item) => {
    const separatorIndex = item.indexOf("=");
    if (separatorIndex === -1) return cookies;

    const key = item.slice(0, separatorIndex).trim();
    const value = item.slice(separatorIndex + 1).trim();
    if (!key) return cookies;

    try {
      cookies.set(key, decodeURIComponent(value));
    } catch {
      cookies.set(key, value);
    }
    return cookies;
  }, new Map());
}

function readRefreshTokenCookie(req) {
  return (
    parseCookieHeader(req?.headers?.cookie).get(getRefreshTokenCookieName()) ||
    null
  );
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
    path: "/api",
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
  if (typeof res.clearCookie === "function") {
    res.clearCookie(getRefreshTokenCookieName(), {
      ...getCookieOptions(),
      path: "/api/auth",
    });
  }
  res.cookie(getRefreshTokenCookieName(), token, getCookieOptions(options));
}

function clearRefreshTokenCookie(res) {
  res.clearCookie(getRefreshTokenCookieName(), getCookieOptions());
  res.clearCookie(getRefreshTokenCookieName(), {
    ...getCookieOptions(),
    path: "/api/auth",
  });
}

module.exports = {
  clearRefreshTokenCookie,
  readRefreshTokenCookie,
  setRefreshTokenCookie,
};
