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
    requireEnv("RESEND_API_KEY", errors);
    requireEnv("RESEND_FROM_EMAIL", errors);
  }

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
