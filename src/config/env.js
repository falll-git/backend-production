const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

let loaded = false;
let validated = false;

const PRODUCTION_ENV = "production";
const FILE_BACKED_ENV_KEYS = Object.freeze([
  "DATABASE_URL",
  "DATABASE_SYSTEM_URL",
  "MIGRATION_DATABASE_URL",
  "REDIS_URL",
  "JOB_QUEUE_REDIS_URL",
  "RATE_LIMIT_REDIS_URL",
  "APP_CACHE_REDIS_URL",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "FILE_ACCESS_SECRET",
  "RATE_LIMIT_KEY_SECRET",
  "RESEND_API_KEY",
]);

function hydrateFileBackedEnv(env = process.env) {
  for (const key of FILE_BACKED_ENV_KEYS) {
    const fileKey = `${key}_FILE`;
    const directValue = typeof env[key] === "string" ? env[key].trim() : "";
    const filePath = typeof env[fileKey] === "string" ? env[fileKey].trim() : "";
    if (!filePath) continue;

    if (directValue) {
      throw new Error(`${key} dan ${fileKey} tidak boleh diisi bersamaan.`);
    }
    if (env.NODE_ENV === PRODUCTION_ENV && !path.isAbsolute(filePath)) {
      throw new Error(`${fileKey} wajib memakai absolute path di production.`);
    }

    let stats;
    let value;
    try {
      stats = fs.statSync(filePath);
      value = fs.readFileSync(filePath, "utf8").trim();
    } catch {
      throw new Error(`${fileKey} tidak dapat dibaca.`);
    }
    if (!stats.isFile()) {
      throw new Error(`${fileKey} harus menunjuk ke file biasa.`);
    }
    if (stats.size < 1 || stats.size > 64 * 1024) {
      throw new Error(`${fileKey} harus berukuran 1 byte sampai 64 KiB.`);
    }

    if (!value) {
      throw new Error(`${fileKey} tidak boleh menunjuk ke file kosong.`);
    }
    env[key] = value;
  }

  return env;
}

function readEnv(key) {
  const value = process.env[key];
  return typeof value === "string" ? value.trim() : "";
}

function isEnabledBoolean(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase(),
  );
}

function isPlaceholder(value) {
  return /^(GANTI|ISI|CHANGE|YOUR)_/i.test(value);
}

function isUnsafeProductionSecret(value) {
  return /(local|development|dev_|please_change|changeme|example|dummy|test)/i.test(
    value,
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

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function requireEnv(key, errors) {
  const value = readEnv(key);
  if (!value || isPlaceholder(value)) {
    errors.push(`${key} wajib diisi dengan nilai production yang valid.`);
  }

  return value;
}

function requireSecret(key, errors) {
  const value = requireEnv(key, errors);
  if (value && value.length < 32) {
    errors.push(`${key} minimal 32 karakter.`);
  }

  if (
    process.env.NODE_ENV === PRODUCTION_ENV &&
    value &&
    isUnsafeProductionSecret(value)
  ) {
    errors.push(`${key} tidak boleh memakai nilai dummy/local/dev di production.`);
  }

  return value;
}

function validateProductionUrl(key, errors, { requireApiPath = false } = {}) {
  const value = requireEnv(key, errors);
  if (!value) return null;

  const parsed = parseUrl(value);
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
    errors.push(`${key} harus berupa URL HTTP/HTTPS yang valid.`);
    return null;
  }

  if (parsed.protocol !== "https:") {
    errors.push(`${key} wajib memakai HTTPS di production.`);
  }

  if (isLoopbackHostname(parsed.hostname)) {
    errors.push(`${key} tidak boleh memakai localhost/127.0.0.1/0.0.0.0 di production.`);
  }

  if (isPlaceholder(parsed.hostname) || isUnsafeProductionSecret(parsed.hostname)) {
    errors.push(`${key} tidak boleh memakai hostname dummy/local/dev di production.`);
  }

  if (
    requireApiPath &&
    !parsed.pathname.replace(/\/+$/, "").endsWith("/api/v1")
  ) {
    errors.push(
      `${key} wajib mengarah ke base API berversi, contoh https://domain.com/api/v1.`,
    );
  }

  return parsed;
}

function validateProductionCorsOrigins(errors) {
  const raw = requireEnv("CORS_ORIGIN", errors);
  if (!raw) return;

  const origins = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    errors.push("CORS_ORIGIN wajib berisi minimal satu origin valid.");
    return;
  }

  for (const origin of origins) {
    const parsed = parseUrl(origin);
    if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
      errors.push(`CORS_ORIGIN berisi origin tidak valid: ${origin}`);
      continue;
    }

    if (parsed.protocol !== "https:") {
      errors.push(`CORS_ORIGIN wajib HTTPS di production: ${origin}`);
    }

    if (isLoopbackHostname(parsed.hostname)) {
      errors.push(`CORS_ORIGIN tidak boleh loopback di production: ${origin}`);
    }
  }
}

function validateAbsolutePathEnv(key, errors) {
  const value = requireEnv(key, errors);
  if (!value) return;

  if (!path.isAbsolute(value)) {
    errors.push(`${key} wajib absolute path di production.`);
  }

  const normalized = value.replace(/\\/g, "/").toLowerCase();
  if (
    normalized.endsWith("/public") ||
    normalized.includes("/public/") ||
    normalized.endsWith("/www/html") ||
    normalized.includes("/www/html/")
  ) {
    errors.push(`${key} tidak boleh mengarah ke folder public web bebas.`);
  }
}

function validateOptionalPositiveInt(key, errors) {
  const value = readEnv(key);
  if (!value) return;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    errors.push(`${key} harus berupa angka bulat positif.`);
  }
}

function validateOptionalBoolean(key, errors) {
  const value = readEnv(key);
  if (!value) return;

  if (!["1", "0", "true", "false", "yes", "no", "on", "off"].includes(value.toLowerCase())) {
    errors.push(`${key} harus berupa boolean: true/false.`);
  }
}

function validateOptionalRedisUrl(key, errors) {
  const value = readEnv(key);
  if (!value) return;

  const parsed = parseUrl(value);
  if (!parsed || !["redis:", "rediss:"].includes(parsed.protocol)) {
    errors.push(`${key} harus berupa URL Redis yang valid, contoh redis://127.0.0.1:6379.`);
  }
}

function validateOptionalTelemetryEndpoint(key, errors) {
  const value = readEnv(key);
  if (!value) return;
  const parsed = parseUrl(value);
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
    errors.push(`${key} harus berupa URL HTTP/HTTPS yang valid.`);
    return;
  }
  if (parsed.username || parsed.password) {
    errors.push(`${key} tidak boleh memuat credential pada URL.`);
  }
  if (
    process.env.NODE_ENV === PRODUCTION_ENV &&
    parsed.protocol !== "https:" &&
    !isLoopbackHostname(parsed.hostname)
  ) {
    errors.push(
      `${key} wajib HTTPS jika collector tidak berada di localhost production.`,
    );
  }
}

function validateOptionalEnum(key, allowedValues, errors) {
  const value = readEnv(key);
  if (!value) return;
  if (!allowedValues.includes(value.toLowerCase())) {
    errors.push(`${key} harus salah satu dari: ${allowedValues.join(", ")}.`);
  }
}

function validateOptionalCachePrefix(key, errors) {
  const value = readEnv(key);
  if (!value) return;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,79}$/.test(value)) {
    errors.push(
      `${key} hanya boleh berisi huruf, angka, titik dua, garis bawah, atau tanda hubung (maksimal 80 karakter).`,
    );
  }
}

function validateOptionalInstanceKey(key, errors) {
  const value = readEnv(key);
  if (!value) return;
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(value)) {
    errors.push(
      `${key} hanya boleh berisi huruf kecil, angka, garis bawah, atau tanda hubung (2-64 karakter).`,
    );
  }
}

function validateOptionalQueueName(key, errors) {
  const value = readEnv(key);
  if (!value) return;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)) {
    errors.push(
      `${key} hanya boleh berisi huruf, angka, garis bawah, atau tanda hubung (maksimal 80 karakter).`,
    );
  }
}

function validateInstanceScopedValue(key, instanceKey, errors) {
  const value = readEnv(key).toLowerCase();
  if (!value || !instanceKey) return;
  if (!value.includes(instanceKey.toLowerCase())) {
    errors.push(`${key} wajib memuat APP_INSTANCE_KEY agar terisolasi per domain.`);
  }
}

function validateOptionalSecret(key, errors) {
  const value = readEnv(key);
  if (!value) return;
  if (value.length < 32) errors.push(`${key} minimal 32 karakter.`);
  if (
    process.env.NODE_ENV === PRODUCTION_ENV &&
    isUnsafeProductionSecret(value)
  ) {
    errors.push(`${key} tidak boleh memakai nilai dummy/local/dev di production.`);
  }
}

function validateOptionalNonNegativeInt(key, errors) {
  const value = readEnv(key);
  if (!value) return;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    errors.push(`${key} harus berupa angka bulat 0 atau positif.`);
  }
}

function validateOptionalBodyLimit(key, errors) {
  const value = readEnv(key);
  if (!value) return;

  if (!/^\d+(b|kb|mb)$/i.test(value)) {
    errors.push(`${key} harus memakai format seperti 1mb, 512kb, atau 1048576b.`);
  }
}

function validateOptionalPercent(key, errors) {
  const value = readEnv(key);
  if (!value) return;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    errors.push(`${key} harus berupa angka antara 0 sampai 100.`);
  }
}

function validateOptionalIntRange(key, minimum, maximum, errors) {
  const value = readEnv(key);
  if (!value) return;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    errors.push(`${key} harus berupa angka bulat antara ${minimum} sampai ${maximum}.`);
  }
}

function validateOptionalDuration(key, errors) {
  const value = readEnv(key);
  if (!value) return;
  if (!/^\d+(?:ms|s|m|h|d)$/i.test(value)) {
    errors.push(`${key} harus berupa durasi seperti 300s, 5m, atau 1h.`);
  }
}

function validateDatabasePool(errors) {
  validateOptionalNonNegativeInt("DB_POOL_MIN", errors);
  validateOptionalPositiveInt("DB_POOL_MAX", errors);
  const minimum = Number(readEnv("DB_POOL_MIN"));
  const maximum = Number(readEnv("DB_POOL_MAX"));
  if (
    Number.isInteger(minimum) &&
    Number.isInteger(maximum) &&
    minimum > maximum
  ) {
    errors.push("DB_POOL_MIN tidak boleh lebih besar dari DB_POOL_MAX.");
  }
}

function validateOptionalPositiveIntList(key, errors) {
  const value = readEnv(key);
  if (!value) return;
  const items = value.split(",").map((item) => item.trim());
  if (
    items.length === 0 ||
    items.some((item) => !/^\d+$/.test(item) || Number(item) < 1)
  ) {
    errors.push(`${key} harus berupa daftar angka bulat positif dipisahkan koma.`);
  }
}

function validateEnv() {
  if (validated) {
    return;
  }

  loadEnv();

  const errors = [];
  const warnings = [];
  const isProduction = readEnv("NODE_ENV") === PRODUCTION_ENV;
  const instanceKey = isProduction
    ? requireEnv("APP_INSTANCE_KEY", errors)
    : readEnv("APP_INSTANCE_KEY");
  const jwtSecret = requireSecret("JWT_SECRET", errors);
  const refreshSecret = requireSecret("JWT_REFRESH_SECRET", errors);
  const fileSecret = requireSecret("FILE_ACCESS_SECRET", errors);
  const rateLimitKeySecret = isProduction
    ? requireSecret("RATE_LIMIT_KEY_SECRET", errors)
    : readEnv("RATE_LIMIT_KEY_SECRET");

  requireEnv("DATABASE_URL", errors);
  requireEnv("JWT_EXPIRES_IN", errors);
  requireEnv("JWT_REFRESH_EXPIRES_IN", errors);
  requireEnv("FILE_ACCESS_TOKEN_EXPIRES_IN", errors);
  requireEnv("AUTH_REFRESH_COOKIE_NAME", errors);

  if (jwtSecret && refreshSecret && jwtSecret === refreshSecret) {
    errors.push("JWT_SECRET dan JWT_REFRESH_SECRET harus berbeda.");
  }

  if (fileSecret && jwtSecret && fileSecret === jwtSecret) {
    errors.push("FILE_ACCESS_SECRET harus berbeda dari JWT_SECRET.");
  }

  if (fileSecret && refreshSecret && fileSecret === refreshSecret) {
    errors.push("FILE_ACCESS_SECRET harus berbeda dari JWT_REFRESH_SECRET.");
  }

  if (
    rateLimitKeySecret &&
    [jwtSecret, refreshSecret, fileSecret].includes(rateLimitKeySecret)
  ) {
    errors.push(
      "RATE_LIMIT_KEY_SECRET harus berbeda dari JWT_SECRET, JWT_REFRESH_SECRET, dan FILE_ACCESS_SECRET.",
    );
  }

  const allowedOrigins = readEnv("CORS_ORIGIN") || readEnv("FRONTEND_URL");
  if (!allowedOrigins) {
    const message = "CORS_ORIGIN atau FRONTEND_URL wajib diisi.";
    if (isProduction) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }

  if (isProduction && !readEnv("FRONTEND_URL")) {
    errors.push("FRONTEND_URL wajib diisi di production.");
  }

  if (isProduction) {
    validateProductionUrl("FRONTEND_URL", errors);
    validateProductionUrl("PUBLIC_BASE_URL", errors);
    validateProductionUrl("API_BASE_URL", errors, { requireApiPath: true });
    validateProductionCorsOrigins(errors);
    validateAbsolutePathEnv("UPLOAD_DIR", errors);
    validateAbsolutePathEnv("UPLOAD_TEMP_DIR", errors);
    [
      "UPLOAD_TEMP_TTL_MS",
      "UPLOAD_TEMP_CLEANUP_INTERVAL_MS",
      "STORAGE_MIN_FREE_BYTES",
      "STORAGE_MIN_FREE_PERCENT",
      "STORAGE_MIN_FREE_INODES",
      "DB_POOL_MIN",
      "DB_POOL_MAX",
      "DB_WORKER_POOL_MAX",
      "DB_SYSTEM_POOL_MAX",
      "DB_CONNECTION_TIMEOUT_MS",
      "DB_POOL_IDLE_TIMEOUT_MS",
      "DB_STATEMENT_TIMEOUT_MS",
      "DB_QUERY_TIMEOUT_MS",
      "DB_LOCK_TIMEOUT_MS",
      "DB_IDLE_TRANSACTION_TIMEOUT_MS",
      "DATABASE_RUNTIME_ROLE",
      "RUNTIME_ROLE",
      "DB_REQUIRE_LEAST_PRIVILEGE",
      "DB_REQUIRE_RLS",
      "BCRYPT_ROUNDS",
      "TRUST_PROXY_HOPS",
      "HTTP_KEEP_ALIVE_TIMEOUT_MS",
      "HTTP_HEADERS_TIMEOUT_MS",
      "HTTP_REQUEST_TIMEOUT_MS",
      "HTTP_MAX_HEADERS_COUNT",
      "GRACEFUL_SHUTDOWN_DRAIN_MS",
      "GRACEFUL_SHUTDOWN_TIMEOUT_MS",
      "RATE_LIMIT_STORE",
      "RATE_LIMIT_KEY_PREFIX",
      "API_RATE_LIMIT_WINDOW_MS",
      "API_RATE_LIMIT_MAX",
      "UPLOAD_RATE_LIMIT_WINDOW_MS",
      "UPLOAD_RATE_LIMIT_MAX",
      "FILE_ACCESS_RATE_LIMIT_WINDOW_MS",
      "FILE_ACCESS_RATE_LIMIT_MAX",
      "DOWNLOAD_RATE_LIMIT_WINDOW_MS",
      "DOWNLOAD_RATE_LIMIT_MAX",
      "IMPORT_RATE_LIMIT_WINDOW_MS",
      "IMPORT_RATE_LIMIT_MAX",
      "EXPORT_RATE_LIMIT_WINDOW_MS",
      "EXPORT_RATE_LIMIT_MAX",
      "REPORT_RATE_LIMIT_WINDOW_MS",
      "REPORT_RATE_LIMIT_MAX",
      "CLIENT_ERROR_REPORT_RATE_LIMIT_WINDOW_MS",
      "CLIENT_ERROR_REPORT_RATE_LIMIT_MAX",
      "EXPENSIVE_OPERATION_RATE_LIMIT_WINDOW_MS",
      "EXPENSIVE_OPERATION_RATE_LIMIT_MAX",
      "APP_CACHE_ENABLED",
      "APP_CACHE_KEY_PREFIX",
      "APP_CACHE_TTL_MS",
      "APP_CACHE_TTL_JITTER_PERCENT",
      "APP_CACHE_MAX_ENTRY_BYTES",
      "APP_CACHE_LOCK_TTL_MS",
      "APP_CACHE_WAIT_TIMEOUT_MS",
      "APP_CACHE_WAIT_INTERVAL_MS",
      "APP_CACHE_CONNECT_TIMEOUT_MS",
      "JOB_QUEUE_REDIS_CONNECT_TIMEOUT_MS",
      "SLIK_IMPORT_QUEUE_ENABLED",
      "SLIK_IMPORT_QUEUE_NAME",
      "SLIK_IMPORT_LOCAL_FALLBACK_ENABLED",
      "SLIK_IMPORT_REQUIRE_WORKER",
      "WORKER_SHUTDOWN_TIMEOUT_MS",
      "WORKER_HEARTBEAT_KEY_PREFIX",
      "WORKER_HEARTBEAT_INTERVAL_MS",
      "WORKER_HEARTBEAT_TTL_MS",
      "WORKER_HEARTBEAT_REDIS_CONNECT_TIMEOUT_MS",
      "WATERMARK_PROCESSING_MODE",
      "WATERMARK_WORKER_POLL_INTERVAL_MS",
      "WATERMARK_WORKER_BATCH_SIZE",
      "WATERMARK_PROCESSING_STALE_MS",
    ].forEach((key) => requireEnv(key, errors));
    if (readEnv("RATE_LIMIT_STORE").toLowerCase() !== "redis") {
      errors.push("RATE_LIMIT_STORE wajib redis di production.");
    }
    if (!readEnv("RATE_LIMIT_REDIS_URL") && !readEnv("REDIS_URL")) {
      errors.push(
        "RATE_LIMIT_REDIS_URL atau REDIS_URL wajib diisi untuk rate limiting production.",
      );
    }
    if (!isEnabledBoolean(readEnv("SLIK_IMPORT_QUEUE_ENABLED"))) {
      errors.push("SLIK_IMPORT_QUEUE_ENABLED wajib true di production.");
    }
    if (isEnabledBoolean(readEnv("SLIK_IMPORT_LOCAL_FALLBACK_ENABLED"))) {
      errors.push(
        "SLIK_IMPORT_LOCAL_FALLBACK_ENABLED wajib false di production.",
      );
    }
    if (!isEnabledBoolean(readEnv("SLIK_IMPORT_REQUIRE_WORKER"))) {
      errors.push("SLIK_IMPORT_REQUIRE_WORKER wajib true di production.");
    }
    if (readEnv("WATERMARK_PROCESSING_MODE").toLowerCase() !== "worker") {
      errors.push("WATERMARK_PROCESSING_MODE wajib worker di production.");
    }
    if (!readEnv("JOB_QUEUE_REDIS_URL") && !readEnv("REDIS_URL")) {
      errors.push(
        "JOB_QUEUE_REDIS_URL atau REDIS_URL wajib diisi untuk queue production.",
      );
    }
    if (isEnabledBoolean(readEnv("DB_REQUIRE_RLS"))) {
      const systemDatabaseUrl = requireEnv("DATABASE_SYSTEM_URL", errors);
      requireEnv("DATABASE_SYSTEM_ROLE", errors);
      if (systemDatabaseUrl && systemDatabaseUrl === readEnv("DATABASE_URL")) {
        errors.push(
          "DATABASE_SYSTEM_URL harus berbeda dari DATABASE_URL saat RLS diwajibkan.",
        );
      }
    } else {
      errors.push("DB_REQUIRE_RLS wajib true di production.");
    }
    if (!isEnabledBoolean(readEnv("DB_REQUIRE_LEAST_PRIVILEGE"))) {
      errors.push("DB_REQUIRE_LEAST_PRIVILEGE wajib true di production.");
    }
    requireEnv("RESEND_API_KEY", errors);
    requireEnv("RESEND_FROM_EMAIL", errors);
  }

  validateOptionalInstanceKey("APP_INSTANCE_KEY", errors);
  validateOptionalPositiveInt("AUTH_RATE_LIMIT_WINDOW_MS", errors);
  validateOptionalPositiveInt("DOCUMENT_UPLOAD_MAX_TOTAL_SIZE_MB", errors);
  validateOptionalPositiveInt("AUTH_IP_RATE_LIMIT_MAX", errors);
  validateOptionalPositiveInt("AUTH_RATE_LIMIT_MAX", errors);
  validateOptionalPositiveInt("AUTH_REFRESH_RATE_LIMIT_MAX", errors);
  validateOptionalBoolean("APP_CACHE_ENABLED", errors);
  validateOptionalRedisUrl("APP_CACHE_REDIS_URL", errors);
  validateOptionalCachePrefix("APP_CACHE_KEY_PREFIX", errors);
  validateOptionalPositiveInt("APP_CACHE_TTL_MS", errors);
  validateOptionalPercent("APP_CACHE_TTL_JITTER_PERCENT", errors);
  validateOptionalPositiveInt("APP_CACHE_MAX_ENTRY_BYTES", errors);
  validateOptionalPositiveInt("APP_CACHE_LOCK_TTL_MS", errors);
  validateOptionalPositiveInt("APP_CACHE_WAIT_TIMEOUT_MS", errors);
  validateOptionalPositiveInt("APP_CACHE_WAIT_INTERVAL_MS", errors);
  validateOptionalPositiveInt("APP_CACHE_CONNECT_TIMEOUT_MS", errors);
  validateOptionalEnum("RATE_LIMIT_STORE", ["memory", "redis"], errors);
  validateOptionalSecret("RATE_LIMIT_KEY_SECRET", errors);
  validateOptionalCachePrefix("RATE_LIMIT_KEY_PREFIX", errors);
  validateOptionalRedisUrl("RATE_LIMIT_REDIS_URL", errors);
  validateOptionalPositiveInt("RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS", errors);
  validateOptionalPositiveInt("API_RATE_LIMIT_WINDOW_MS", errors);
  validateOptionalPositiveInt("API_RATE_LIMIT_MAX", errors);
  validateOptionalPositiveInt("UPLOAD_RATE_LIMIT_WINDOW_MS", errors);
  validateOptionalPositiveInt("UPLOAD_RATE_LIMIT_MAX", errors);
  validateOptionalPositiveInt("FILE_ACCESS_RATE_LIMIT_WINDOW_MS", errors);
  validateOptionalPositiveInt("FILE_ACCESS_RATE_LIMIT_MAX", errors);
  validateOptionalPositiveInt("DOWNLOAD_RATE_LIMIT_WINDOW_MS", errors);
  validateOptionalPositiveInt("DOWNLOAD_RATE_LIMIT_MAX", errors);
  validateOptionalPositiveInt("IMPORT_RATE_LIMIT_WINDOW_MS", errors);
  validateOptionalPositiveInt("IMPORT_RATE_LIMIT_MAX", errors);
  validateOptionalPositiveInt("EXPORT_RATE_LIMIT_WINDOW_MS", errors);
  validateOptionalPositiveInt("EXPORT_RATE_LIMIT_MAX", errors);
  validateOptionalPositiveInt("REPORT_RATE_LIMIT_WINDOW_MS", errors);
  validateOptionalPositiveInt("REPORT_RATE_LIMIT_MAX", errors);
  validateOptionalPositiveInt(
    "CLIENT_ERROR_REPORT_RATE_LIMIT_WINDOW_MS",
    errors,
  );
  validateOptionalPositiveInt("CLIENT_ERROR_REPORT_RATE_LIMIT_MAX", errors);
  validateOptionalPositiveInt(
    "EXPENSIVE_OPERATION_RATE_LIMIT_WINDOW_MS",
    errors,
  );
  validateOptionalPositiveInt("EXPENSIVE_OPERATION_RATE_LIMIT_MAX", errors);
  validateOptionalIntRange("BCRYPT_ROUNDS", 10, 15, errors);
  validateOptionalIntRange("TRUST_PROXY_HOPS", 0, 10, errors);
  validateOptionalPositiveInt("HTTP_KEEP_ALIVE_TIMEOUT_MS", errors);
  validateOptionalPositiveInt("HTTP_HEADERS_TIMEOUT_MS", errors);
  validateOptionalPositiveInt("HTTP_REQUEST_TIMEOUT_MS", errors);
  validateOptionalPositiveInt("HTTP_MAX_HEADERS_COUNT", errors);
  validateOptionalNonNegativeInt("GRACEFUL_SHUTDOWN_DRAIN_MS", errors);
  validateOptionalPositiveInt("GRACEFUL_SHUTDOWN_TIMEOUT_MS", errors);
  validateOptionalBoolean("DB_REQUIRE_LEAST_PRIVILEGE", errors);
  validateOptionalBoolean("DB_REQUIRE_RLS", errors);
  validateOptionalRedisUrl("REDIS_URL", errors);
  validateOptionalRedisUrl("JOB_QUEUE_REDIS_URL", errors);
  validateOptionalPositiveInt("JOB_QUEUE_REDIS_CONNECT_TIMEOUT_MS", errors);
  validateOptionalQueueName("SLIK_IMPORT_QUEUE_NAME", errors);
  validateOptionalBoolean("SLIK_IMPORT_QUEUE_ENABLED", errors);
  validateOptionalBoolean("SLIK_IMPORT_LOCAL_FALLBACK_ENABLED", errors);
  validateOptionalBoolean("SLIK_IMPORT_REQUIRE_WORKER", errors);
  validateOptionalPositiveInt("WORKER_SHUTDOWN_TIMEOUT_MS", errors);
  validateOptionalCachePrefix("WORKER_HEARTBEAT_KEY_PREFIX", errors);
  validateOptionalPositiveInt("WORKER_HEARTBEAT_INTERVAL_MS", errors);
  validateOptionalPositiveInt("WORKER_HEARTBEAT_TTL_MS", errors);
  validateOptionalPositiveInt(
    "WORKER_HEARTBEAT_REDIS_CONNECT_TIMEOUT_MS",
    errors,
  );
  validateOptionalEnum(
    "WATERMARK_PROCESSING_MODE",
    ["inline", "worker"],
    errors,
  );
  validateOptionalPositiveInt("WATERMARK_WORKER_POLL_INTERVAL_MS", errors);
  validateOptionalPositiveInt("WATERMARK_WORKER_BATCH_SIZE", errors);
  validateOptionalPositiveInt("WATERMARK_PROCESSING_STALE_MS", errors);
  validateOptionalPositiveInt("SLIK_IMPORT_WORKER_CONCURRENCY", errors);
  validateOptionalPositiveInt("SLIK_IMPORT_MAX_FILE_SIZE_MB", errors);
  validateOptionalPositiveInt("SLIK_IMPORT_MAX_TOTAL_SIZE_MB", errors);
  validateOptionalPositiveInt("SLIK_IMPORT_BATCH_SIZE", errors);
  validateOptionalPositiveInt("SLIK_IMPORT_MAX_ERROR_SAMPLES", errors);
  validateOptionalNonNegativeInt("SLIK_IMPORT_MAX_ROWS", errors);
  validateOptionalBodyLimit("JSON_BODY_LIMIT", errors);
  validateOptionalBodyLimit("URLENCODED_BODY_LIMIT", errors);
  validateOptionalBoolean("API_DOCS_ENABLED", errors);
  validateOptionalPositiveInt("HEALTH_CHECK_TIMEOUT_MS", errors);
  validateOptionalPositiveInt("HEALTH_CHECK_CACHE_MS", errors);
  validateOptionalEnum(
    "LOG_LEVEL",
    ["fatal", "error", "warn", "info", "debug", "trace", "silent"],
    errors,
  );
  validateOptionalPositiveInt("LOG_MAX_STRING_LENGTH", errors);
  validateOptionalBoolean("HTTP_ACCESS_LOG_ENABLED", errors);
  validateOptionalBoolean("HTTP_ACCESS_LOG_HEALTH", errors);
  validateOptionalPositiveInt("INFRA_ERROR_LOG_INTERVAL_MS", errors);
  validateOptionalBoolean("OTEL_ENABLED", errors);
  validateOptionalTelemetryEndpoint("OTEL_EXPORTER_OTLP_ENDPOINT", errors);
  validateOptionalTelemetryEndpoint(
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    errors,
  );
  validateOptionalEnum(
    "OTEL_TRACES_SAMPLER",
    [
      "always_on",
      "always_off",
      "traceidratio",
      "parentbased_always_on",
      "parentbased_always_off",
      "parentbased_traceidratio",
    ],
    errors,
  );
  const otelSamplerArg = readEnv("OTEL_TRACES_SAMPLER_ARG");
  if (
    otelSamplerArg &&
    (!Number.isFinite(Number(otelSamplerArg)) ||
      Number(otelSamplerArg) < 0 ||
      Number(otelSamplerArg) > 1)
  ) {
    errors.push("OTEL_TRACES_SAMPLER_ARG harus berupa angka 0 sampai 1.");
  }
  if (
    isEnabledBoolean(readEnv("OTEL_ENABLED")) &&
    !readEnv("OTEL_EXPORTER_OTLP_ENDPOINT") &&
    !readEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
  ) {
    errors.push(
      "OTEL_EXPORTER_OTLP_ENDPOINT atau OTEL_EXPORTER_OTLP_TRACES_ENDPOINT wajib diisi saat OTEL_ENABLED=true.",
    );
  }
  validateOptionalPositiveInt("UPLOAD_TEMP_TTL_MS", errors);
  validateOptionalPositiveInt("UPLOAD_TEMP_CLEANUP_INTERVAL_MS", errors);
  validateOptionalNonNegativeInt("STORAGE_MIN_FREE_BYTES", errors);
  validateOptionalPercent("STORAGE_MIN_FREE_PERCENT", errors);
  validateOptionalNonNegativeInt("STORAGE_MIN_FREE_INODES", errors);
  validateDatabasePool(errors);
  validateOptionalPositiveInt("DB_WORKER_POOL_MAX", errors);
  validateOptionalPositiveInt("DB_SYSTEM_POOL_MAX", errors);
  validateOptionalPositiveInt("DB_CONNECTION_TIMEOUT_MS", errors);
  validateOptionalPositiveInt("DB_POOL_IDLE_TIMEOUT_MS", errors);
  validateOptionalPositiveInt("DB_STATEMENT_TIMEOUT_MS", errors);
  validateOptionalPositiveInt("DB_QUERY_TIMEOUT_MS", errors);
  validateOptionalPositiveInt("DB_LOCK_TIMEOUT_MS", errors);
  validateOptionalPositiveInt("DB_IDLE_TRANSACTION_TIMEOUT_MS", errors);
  validateOptionalPositiveInt("DB_SLOW_QUERY_THRESHOLD_MS", errors);
  validateOptionalPositiveInt("DB_MAINTENANCE_REPORT_LIMIT", errors);
  validateOptionalPositiveIntList("RETENTION_REPORT_BUCKET_DAYS", errors);
  validateOptionalEnum(
    "RUNTIME_ROLE",
    ["api", "slik-import-worker", "watermark-worker"],
    errors,
  );

  if (isProduction && /^[a-z0-9][a-z0-9_-]{1,63}$/.test(instanceKey)) {
    [
      "APP_CACHE_KEY_PREFIX",
      "RATE_LIMIT_KEY_PREFIX",
      "SLIK_IMPORT_QUEUE_NAME",
      "WORKER_HEARTBEAT_KEY_PREFIX",
    ].forEach((key) => validateInstanceScopedValue(key, instanceKey, errors));
  }

  if (
    isEnabledBoolean(readEnv("APP_CACHE_ENABLED")) &&
    !readEnv("APP_CACHE_REDIS_URL") &&
    !readEnv("REDIS_URL")
  ) {
    errors.push(
      "APP_CACHE_REDIS_URL atau REDIS_URL wajib diisi saat APP_CACHE_ENABLED=true.",
    );
  }
  const keepAliveTimeoutRaw = readEnv("HTTP_KEEP_ALIVE_TIMEOUT_MS");
  const headersTimeoutRaw = readEnv("HTTP_HEADERS_TIMEOUT_MS");
  const keepAliveTimeoutMs = Number(keepAliveTimeoutRaw);
  const headersTimeoutMs = Number(headersTimeoutRaw);
  if (
    keepAliveTimeoutRaw &&
    headersTimeoutRaw &&
    Number.isInteger(keepAliveTimeoutMs) &&
    Number.isInteger(headersTimeoutMs) &&
    headersTimeoutMs <= keepAliveTimeoutMs
  ) {
    errors.push(
      "HTTP_HEADERS_TIMEOUT_MS harus lebih besar dari HTTP_KEEP_ALIVE_TIMEOUT_MS.",
    );
  }
  const drainRaw = readEnv("GRACEFUL_SHUTDOWN_DRAIN_MS");
  const shutdownTimeoutRaw = readEnv("GRACEFUL_SHUTDOWN_TIMEOUT_MS");
  const drainMs = Number(drainRaw);
  const shutdownTimeoutMs = Number(shutdownTimeoutRaw);
  if (
    drainRaw &&
    shutdownTimeoutRaw &&
    Number.isInteger(drainMs) &&
    Number.isInteger(shutdownTimeoutMs) &&
    shutdownTimeoutMs <= drainMs
  ) {
    errors.push(
      "GRACEFUL_SHUTDOWN_TIMEOUT_MS harus lebih besar dari GRACEFUL_SHUTDOWN_DRAIN_MS.",
    );
  }
  const heartbeatIntervalRaw = readEnv("WORKER_HEARTBEAT_INTERVAL_MS");
  const heartbeatTtlRaw = readEnv("WORKER_HEARTBEAT_TTL_MS");
  const heartbeatIntervalMs = Number(heartbeatIntervalRaw);
  const heartbeatTtlMs = Number(heartbeatTtlRaw);
  if (
    heartbeatIntervalRaw &&
    heartbeatTtlRaw &&
    Number.isInteger(heartbeatIntervalMs) &&
    Number.isInteger(heartbeatTtlMs) &&
    heartbeatTtlMs <= heartbeatIntervalMs * 2
  ) {
    errors.push(
      "WORKER_HEARTBEAT_TTL_MS harus lebih besar dari dua kali WORKER_HEARTBEAT_INTERVAL_MS.",
    );
  }

  if (errors.length > 0) {
    throw new Error(`Konfigurasi env tidak valid:\n- ${errors.join("\n- ")}`);
  }

  for (const warning of warnings) {
    const { logger } = require("../system/logger");
    logger.warn(
      {
        event: "environment_configuration_warning",
        component: "environment",
      },
      warning,
    );
  }

  validated = true;
}

function loadEnv() {
  if (loaded) {
    return;
  }

  dotenv.config({ path: ".env" });
  hydrateFileBackedEnv();

  loaded = true;
}

module.exports = {
  FILE_BACKED_ENV_KEYS,
  hydrateFileBackedEnv,
  loadEnv,
  validateEnv,
};
