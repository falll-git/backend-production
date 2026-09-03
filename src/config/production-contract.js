const path = require("node:path");

const DATABASE_SCOPES = Object.freeze([
  ["DATABASE_URL", "runtime"],
  ["DATABASE_SYSTEM_URL", "system"],
  ["MIGRATION_DATABASE_URL", "migration"],
  ["SJ_WORKER_DATABASE_URL", "seputar-jaminan-worker"],
]);
const KNOWN_PRIVILEGED_DATABASE_USERS = new Set([
  "postgres",
  "rdsadmin",
  "cloudsqlsuperuser",
  "azure_superuser",
]);

function valueOf(env, key) {
  return String(env?.[key] || "").trim();
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parsePostgresCredential(rawValue, label, errors) {
  if (!rawValue) {
    errors.push(`${label} wajib diisi.`);
    return null;
  }
  let url;
  try {
    url = new URL(rawValue);
  } catch {
    errors.push(`${label} wajib berupa URL PostgreSQL valid.`);
    return null;
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.username ||
    !url.password ||
    !url.hostname ||
    url.pathname.length <= 1
  ) {
    errors.push(`${label} wajib memuat protocol, user, password, host, dan database.`);
    return null;
  }
  return {
    label,
    raw: rawValue,
    username: decodeURIComponent(url.username),
    target: [
      url.hostname.toLowerCase(),
      url.port || "5432",
      url.pathname,
      url.searchParams.get("schema") || "public",
    ].join("|"),
  };
}

function validateDatabaseSeparation(env, errors, { requireMigration = false } = {}) {
  const credentials = [];
  for (const [key, scope] of DATABASE_SCOPES) {
    const value = valueOf(env, key);
    if (key === "MIGRATION_DATABASE_URL" && !requireMigration && !value) continue;
    const parsed = parsePostgresCredential(value, key, errors);
    if (parsed) credentials.push({ ...parsed, key, scope });
  }
  if (credentials.length < (requireMigration ? 4 : 3)) return;

  if (new Set(credentials.map((entry) => entry.raw)).size !== credentials.length) {
    errors.push("Credential database runtime, system, migration, dan worker wajib terpisah.");
  }
  if (new Set(credentials.map((entry) => entry.username)).size !== credentials.length) {
    errors.push("User database runtime, system, migration, dan worker wajib berbeda.");
  }
  if (new Set(credentials.map((entry) => entry.target)).size !== 1) {
    errors.push("Empat credential database wajib menunjuk database instalasi BPRS yang sama.");
  }

  for (const credential of credentials) {
    if (
      credential.scope !== "migration" &&
      KNOWN_PRIVILEGED_DATABASE_USERS.has(credential.username.toLowerCase())
    ) {
      errors.push(`${credential.key} tidak boleh memakai user database superuser.`);
    }
  }

  const runtime = credentials.find((entry) => entry.key === "DATABASE_URL");
  const system = credentials.find((entry) => entry.key === "DATABASE_SYSTEM_URL");
  const runtimeRole = valueOf(env, "DATABASE_RUNTIME_ROLE");
  const systemRole = valueOf(env, "DATABASE_SYSTEM_ROLE");
  if (runtime && runtimeRole && runtime.username !== runtimeRole) {
    errors.push("DATABASE_RUNTIME_ROLE wajib sama dengan user pada DATABASE_URL.");
  }
  if (system && systemRole && system.username !== systemRole) {
    errors.push("DATABASE_SYSTEM_ROLE wajib sama dengan user pada DATABASE_SYSTEM_URL.");
  }
}

function validateStorageSeparation(env, errors, { repositoryRoot = process.cwd() } = {}) {
  const deployRootValue = valueOf(env, "RUWANG_DEPLOY_ROOT");
  if (!deployRootValue) {
    errors.push("RUWANG_DEPLOY_ROOT wajib diisi di production.");
    return;
  }
  if (!path.isAbsolute(deployRootValue)) {
    errors.push("RUWANG_DEPLOY_ROOT wajib memakai absolute path.");
    return;
  }
  const deployRoot = path.resolve(deployRootValue);
  const sourceRoot = path.resolve(repositoryRoot);
  const storageKeys = ["UPLOAD_DIR", "UPLOAD_TEMP_DIR"];
  if (valueOf(env, "SJ_MEDIA_STORAGE_PROVIDER").toUpperCase() === "FILESYSTEM") {
    storageKeys.push("SJ_MEDIA_FILESYSTEM_ROOT");
  }
  for (const key of storageKeys) {
    const configured = valueOf(env, key);
    if (!configured || !path.isAbsolute(configured)) continue;
    const storagePath = path.resolve(configured);
    if (isInside(deployRoot, storagePath) || isInside(sourceRoot, storagePath)) {
      errors.push(`${key} wajib berada di luar source dan seluruh direktori release.`);
    }
  }
}

function validateBackendProductionEnvironment(
  env,
  { repositoryRoot = process.cwd(), requireMigration = false } = {},
) {
  const errors = [];
  validateDatabaseSeparation(env, errors, { requireMigration });
  validateStorageSeparation(env, errors, { repositoryRoot });
  return { valid: errors.length === 0, errors };
}

module.exports = {
  DATABASE_SCOPES,
  validateBackendProductionEnvironment,
  validateDatabaseSeparation,
  validateStorageSeparation,
};
