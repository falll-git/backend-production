const { getRateLimitStore } = require("../system/rate-limit-store");
const {
  createThrottledErrorLogger,
} = require("../system/infrastructure-events");

function readPositiveIntEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function canonicalRoute(req) {
  const routePath = req.route?.path || req.path || req.originalUrl || "/";
  return `${req.method || "UNKNOWN"}:${req.baseUrl || ""}${routePath}`;
}

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || "unknown").slice(0, 128);
}

function authenticatedKeyGenerator(req) {
  const userId = String(req.user?.id || "anonymous").slice(0, 128);
  return `user:${userId}:ip:${clientIp(req)}:route:${canonicalRoute(req)}`;
}

function apiGeneralKeyGenerator(req) {
  return `ip:${clientIp(req)}`;
}

function fileDownloadKeyGenerator(req) {
  const access = req.fileAccess || req.res?.locals?.fileAccess || null;
  const userId = String(access?.user_id || "anonymous").slice(0, 128);
  const moduleName = String(access?.module || "unknown").slice(0, 64);
  return `user:${userId}:ip:${clientIp(req)}:module:${moduleName}`;
}

function authKeyGenerator(req) {
  const rawIdentity =
    req.body?.username || req.body?.email || req.user?.id || "anonymous";
  const identity = String(rawIdentity)
    .trim()
    .toLowerCase()
    .slice(0, 128);
  return `ip:${clientIp(req)}:route:${canonicalRoute(req)}:identity:${identity || "anonymous"}`;
}

function setRateLimitHeaders(res, { max, count, resetAt, windowMs }) {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((resetAt - Date.now()) / 1000),
  );
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  res.setHeader("RateLimit-Limit", String(max));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, max - count)));
  res.setHeader("RateLimit-Reset", String(retryAfterSeconds));
  res.setHeader("RateLimit-Policy", `${max};w=${windowSeconds}`);
  return retryAfterSeconds;
}

function createRateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 60,
  keyGenerator,
  message = "Terlalu banyak permintaan. Silakan coba lagi nanti.",
  profile = "default",
  skip,
  store,
} = {}) {
  if (!Number.isInteger(windowMs) || windowMs < 1) {
    throw new Error("Rate limit windowMs harus berupa angka bulat positif.");
  }
  if (!Number.isInteger(max) || max < 1) {
    throw new Error("Rate limit max harus berupa angka bulat positif.");
  }

  const resolvedStore = store || getRateLimitStore();
  const logStoreError = createThrottledErrorLogger({
    component: `rate_limit_store_${profile}`,
    event: "rate_limit_store_unavailable",
  });

  const middleware = async (req, res, next) => {
    if (typeof skip === "function" && skip(req)) return next();

    const rawKey =
      typeof keyGenerator === "function"
        ? keyGenerator(req)
        : authenticatedKeyGenerator(req);
    const key = `profile:${profile}:${String(rawKey).slice(0, 1024)}`;

    let result;
    try {
      result = await resolvedStore.consume({ key, windowMs });
    } catch (error) {
      logStoreError(error);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Retry-After", "1");
      return res.status(503).json({
        status: false,
        success: false,
        request_id: req.requestId || null,
        message:
          "Layanan pembatasan permintaan sedang tidak tersedia. Silakan coba lagi.",
      });
    }

    const retryAfterSeconds = setRateLimitHeaders(res, {
      max,
      count: result.count,
      resetAt: result.resetAt,
      windowMs,
    });
    if (result.count > max) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        status: false,
        success: false,
        request_id: req.requestId || null,
        message,
      });
    }

    return next();
  };
  middleware.rateLimitProfile = profile;
  return middleware;
}

const authWindowMs = readPositiveIntEnv(
  "AUTH_RATE_LIMIT_WINDOW_MS",
  15 * 60 * 1000,
);

const apiGeneralRateLimit = createRateLimiter({
  windowMs: readPositiveIntEnv("API_RATE_LIMIT_WINDOW_MS", 60 * 1000),
  max: readPositiveIntEnv("API_RATE_LIMIT_MAX", 300),
  keyGenerator: apiGeneralKeyGenerator,
  profile: "api-general",
  skip: (req) => req.method === "OPTIONS",
});

const uploadRateLimit = createRateLimiter({
  windowMs: readPositiveIntEnv("UPLOAD_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  max: readPositiveIntEnv("UPLOAD_RATE_LIMIT_MAX", 60),
  keyGenerator: authenticatedKeyGenerator,
  profile: "upload",
  message: "Terlalu banyak unggahan. Silakan coba lagi nanti.",
});

const fileAccessAttemptRateLimit = createRateLimiter({
  windowMs: readPositiveIntEnv(
    "FILE_ACCESS_RATE_LIMIT_WINDOW_MS",
    60 * 1000,
  ),
  max: readPositiveIntEnv("FILE_ACCESS_RATE_LIMIT_MAX", 300),
  keyGenerator: apiGeneralKeyGenerator,
  profile: "file-access",
  message: "Terlalu banyak percobaan akses file. Silakan coba lagi nanti.",
});

const downloadRateLimit = createRateLimiter({
  windowMs: readPositiveIntEnv(
    "DOWNLOAD_RATE_LIMIT_WINDOW_MS",
    15 * 60 * 1000,
  ),
  max: readPositiveIntEnv("DOWNLOAD_RATE_LIMIT_MAX", 300),
  keyGenerator: fileDownloadKeyGenerator,
  profile: "download",
  message: "Terlalu banyak permintaan download. Silakan coba lagi nanti.",
});

const importRateLimit = createRateLimiter({
  windowMs: readPositiveIntEnv("IMPORT_RATE_LIMIT_WINDOW_MS", 60 * 60 * 1000),
  max: readPositiveIntEnv("IMPORT_RATE_LIMIT_MAX", 20),
  keyGenerator: authenticatedKeyGenerator,
  profile: "import",
  message: "Terlalu banyak proses impor. Silakan coba lagi nanti.",
});

const exportRateLimit = createRateLimiter({
  windowMs: readPositiveIntEnv("EXPORT_RATE_LIMIT_WINDOW_MS", 60 * 60 * 1000),
  max: readPositiveIntEnv("EXPORT_RATE_LIMIT_MAX", 120),
  keyGenerator: authenticatedKeyGenerator,
  profile: "export",
  message: "Terlalu banyak permintaan export. Silakan coba lagi nanti.",
});

const expensiveOperationRateLimit = createRateLimiter({
  windowMs: readPositiveIntEnv(
    "EXPENSIVE_OPERATION_RATE_LIMIT_WINDOW_MS",
    60 * 60 * 1000,
  ),
  max: readPositiveIntEnv("EXPENSIVE_OPERATION_RATE_LIMIT_MAX", 10),
  keyGenerator: authenticatedKeyGenerator,
  profile: "expensive-operation",
  message: "Terlalu banyak operasi berat. Silakan coba lagi nanti.",
});

const reportRateLimit = createRateLimiter({
  windowMs: readPositiveIntEnv("REPORT_RATE_LIMIT_WINDOW_MS", 5 * 60 * 1000),
  max: readPositiveIntEnv("REPORT_RATE_LIMIT_MAX", 120),
  keyGenerator: authenticatedKeyGenerator,
  profile: "report",
  message: "Terlalu banyak permintaan laporan. Silakan coba lagi nanti.",
});

const clientErrorReportRateLimit = createRateLimiter({
  windowMs: readPositiveIntEnv(
    "CLIENT_ERROR_REPORT_RATE_LIMIT_WINDOW_MS",
    5 * 60 * 1000,
  ),
  max: readPositiveIntEnv("CLIENT_ERROR_REPORT_RATE_LIMIT_MAX", 30),
  keyGenerator: apiGeneralKeyGenerator,
  profile: "client-error-report",
  message: "Terlalu banyak laporan kendala aplikasi. Silakan coba lagi nanti.",
});

const authRateLimit = createRateLimiter({
  windowMs: authWindowMs,
  max: readPositiveIntEnv("AUTH_RATE_LIMIT_MAX", 25),
  keyGenerator: authKeyGenerator,
  profile: "auth-identity",
});

const authIpRateLimit = createRateLimiter({
  windowMs: authWindowMs,
  max: readPositiveIntEnv("AUTH_IP_RATE_LIMIT_MAX", 100),
  keyGenerator(req) {
    return `ip:${clientIp(req)}:route:${canonicalRoute(req)}`;
  },
  profile: "auth-ip",
});

const authRefreshRateLimit = createRateLimiter({
  windowMs: authWindowMs,
  max: readPositiveIntEnv("AUTH_REFRESH_RATE_LIMIT_MAX", 1000),
  keyGenerator(req) {
    return `ip:${clientIp(req)}:route:${canonicalRoute(req)}`;
  },
  profile: "auth-refresh",
  message: "Terlalu banyak pembaruan sesi. Silakan coba lagi nanti.",
});

module.exports = {
  apiGeneralRateLimit,
  authIpRateLimit,
  authRefreshRateLimit,
  authRateLimit,
  authKeyGenerator,
  authenticatedKeyGenerator,
  createRateLimiter,
  clientErrorReportRateLimit,
  downloadRateLimit,
  expensiveOperationRateLimit,
  exportRateLimit,
  fileAccessAttemptRateLimit,
  fileDownloadKeyGenerator,
  importRateLimit,
  reportRateLimit,
  uploadRateLimit,
};
