const path = require("path");
const dotenv = require("dotenv");

let loaded = false;
let validated = false;

const PRODUCTION_ENV = "production";

function readEnv(key) {
  const value = process.env[key];
  return typeof value === "string" ? value.trim() : "";
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

  if (requireApiPath && !parsed.pathname.replace(/\/+$/, "").endsWith("/api")) {
    errors.push(`${key} wajib mengarah ke base API, contoh https://domain.com/api.`);
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

function validateEnv() {
  if (validated) {
    return;
  }

  loadEnv();

  const errors = [];
  const warnings = [];
  const isProduction = readEnv("NODE_ENV") === PRODUCTION_ENV;
  const jwtSecret = requireSecret("JWT_SECRET", errors);
  const refreshSecret = requireSecret("JWT_REFRESH_SECRET", errors);
  const fileSecret = requireSecret("FILE_ACCESS_SECRET", errors);

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
    requireEnv("RESEND_API_KEY", errors);
    requireEnv("RESEND_FROM_EMAIL", errors);
  }

  validateOptionalPositiveInt("AUTH_RATE_LIMIT_WINDOW_MS", errors);
  validateOptionalPositiveInt("AUTH_RATE_LIMIT_MAX", errors);
  validateOptionalPositiveInt("AUTH_REFRESH_RATE_LIMIT_MAX", errors);
  validateOptionalRedisUrl("REDIS_URL", errors);
  validateOptionalBoolean("SLIK_IMPORT_QUEUE_ENABLED", errors);
  validateOptionalPositiveInt("SLIK_IMPORT_WORKER_CONCURRENCY", errors);
  validateOptionalPositiveInt("SLIK_IMPORT_MAX_FILE_SIZE_MB", errors);
  validateOptionalPositiveInt("SLIK_IMPORT_BATCH_SIZE", errors);
  validateOptionalPositiveInt("SLIK_IMPORT_MAX_ERROR_SAMPLES", errors);
  validateOptionalNonNegativeInt("SLIK_IMPORT_MAX_ROWS", errors);
  validateOptionalBodyLimit("JSON_BODY_LIMIT", errors);
  validateOptionalBodyLimit("URLENCODED_BODY_LIMIT", errors);

  if (errors.length > 0) {
    throw new Error(`Konfigurasi env tidak valid:\n- ${errors.join("\n- ")}`);
  }

  for (const warning of warnings) {
    console.warn(`[env] ${warning}`);
  }

  validated = true;
}

function loadEnv() {
  if (loaded) {
    return;
  }

  dotenv.config({ path: ".env" });

  loaded = true;
}

module.exports = { loadEnv, validateEnv };
