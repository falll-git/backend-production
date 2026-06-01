function createRateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 60,
  keyGenerator,
  message = "Terlalu banyak percobaan. Silakan coba lagi nanti.",
} = {}) {
  const hits = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key =
      typeof keyGenerator === "function"
        ? keyGenerator(req)
        : `${req.ip || "unknown"}:${req.path || req.originalUrl || ""}`;
    const current = hits.get(key);

    if (!current || current.resetAt <= now) {
      hits.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      return next();
    }

    current.count += 1;
    hits.set(key, current);

    if (current.count > max) {
      const retryAfterSeconds = Math.ceil((current.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        status: false,
        message,
      });
    }

    if (hits.size > 5000) {
      for (const [entryKey, entry] of hits.entries()) {
        if (entry.resetAt <= now) {
          hits.delete(entryKey);
        }
      }
    }

    return next();
  };
}

function readPositiveIntEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function authKeyGenerator(req) {
  const identity =
    req.body?.username || req.body?.email || req.user?.id || "anonymous";
  return `${req.ip || "unknown"}:${req.path}:${String(identity).toLowerCase()}`;
}

const authRateLimit = createRateLimiter({
  windowMs: readPositiveIntEnv("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  max: readPositiveIntEnv("AUTH_RATE_LIMIT_MAX", 25),
  keyGenerator: authKeyGenerator,
});

const authRefreshRateLimit = createRateLimiter({
  windowMs: readPositiveIntEnv("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  max: readPositiveIntEnv("AUTH_REFRESH_RATE_LIMIT_MAX", 1000),
  keyGenerator(req) {
    return `${req.ip || "unknown"}:${req.path}:refresh`;
  },
  message: "Terlalu banyak pembaruan sesi. Silakan coba lagi nanti.",
});

module.exports = {
  authRefreshRateLimit,
  authRateLimit,
  createRateLimiter,
};
