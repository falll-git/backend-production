function isServerRuntime() {
  return ["production", "staging"].includes(
    String(process.env.NODE_ENV || "").toLowerCase(),
  );
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || "").toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized.startsWith("127.")
  );
}

function normalizeOrigin(value, { allowLoopback = false } = {}) {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const parsed = new URL(value.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    if (isLoopbackHostname(parsed.hostname) && !allowLoopback) return null;

    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function getConfiguredPublicOrigin() {
  const allowLoopback =
    !isServerRuntime() && process.env.ALLOW_LOOPBACK_PUBLIC_URL === "true";
  const keys = [
    "PUBLIC_ASSET_BASE_URL",
    "PUBLIC_BASE_URL",
    "APP_BASE_URL",
    "API_BASE_URL",
  ];

  for (const key of keys) {
    const origin = normalizeOrigin(process.env[key], { allowLoopback });
    if (origin) return origin;
  }

  return null;
}

function getRequestOrigin(req) {
  if (!req) return null;

  const host = req.get("x-forwarded-host") || req.get("host");
  if (!host) return null;

  const protocol = String(req.get("x-forwarded-proto") || req.protocol || "http")
    .split(",")[0]
    .trim();

  return normalizeOrigin(`${protocol}://${host}`, {
    allowLoopback: !isServerRuntime(),
  });
}

function normalizePublicPath(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return `${parsed.pathname}${parsed.search}${parsed.hash}`.replace(
        /^\/api\/api\//,
        "/api/",
      );
    } catch {
      return trimmed;
    }
  }

  if (!trimmed.startsWith("/")) return trimmed;
  return trimmed.replace(/^\/api\/api\//, "/api/");
}

function buildPublicUrl(req, storedPath) {
  const rawValue = typeof storedPath === "string" ? storedPath.trim() : "";
  if (/^https?:\/\//i.test(rawValue)) {
    try {
      const parsed = new URL(rawValue);
      const normalizedPath = `${parsed.pathname}${parsed.search}${parsed.hash}`.replace(
        /^\/api\/api\//,
        "/api/",
      );

      if (
        !isLoopbackHostname(parsed.hostname) &&
        normalizedPath === `${parsed.pathname}${parsed.search}${parsed.hash}` &&
        (!isServerRuntime() || parsed.protocol === "https:")
      ) {
        return rawValue;
      }

      const origin = getConfiguredPublicOrigin() || getRequestOrigin(req);
      return origin ? new URL(normalizedPath, origin).toString() : normalizedPath;
    } catch {
      return rawValue;
    }
  }

  const publicPath = normalizePublicPath(rawValue);
  if (!publicPath) return null;
  if (!publicPath.startsWith("/")) return publicPath;

  const origin = getConfiguredPublicOrigin() || getRequestOrigin(req);
  if (!origin) return publicPath;

  return new URL(publicPath, origin).toString();
}

module.exports = {
  buildPublicUrl,
  getConfiguredPublicOrigin,
  getRequestOrigin,
  isLoopbackHostname,
  normalizeOrigin,
};
