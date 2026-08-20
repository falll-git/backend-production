function readPositiveInt(env, key, fallback) {
  const value = Number(env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readNonNegativeInt(env, key, fallback) {
  const value = Number(env[key]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function buildDatabasePoolConfig(env = process.env, options = {}) {
  const runtimeRole = String(env.RUNTIME_ROLE || "api")
    .trim()
    .toLowerCase();
  const defaultApplicationName =
    runtimeRole === "api"
      ? "ruwang-arsip-api"
      : `ruwang-arsip-${runtimeRole.replace(/[^a-z0-9-]+/g, "-")}`;
  const {
    applicationName = defaultApplicationName,
    connectionString = env.DATABASE_URL,
    maxKey = runtimeRole === "api" ? "DB_POOL_MAX" : "DB_WORKER_POOL_MAX",
  } = options;

  return {
    connectionString,
    min: readNonNegativeInt(env, "DB_POOL_MIN", 0),
    max: readPositiveInt(env, maxKey, 10),
    connectionTimeoutMillis: readPositiveInt(
      env,
      "DB_CONNECTION_TIMEOUT_MS",
      15000,
    ),
    idleTimeoutMillis: readPositiveInt(env, "DB_POOL_IDLE_TIMEOUT_MS", 30000),
    statement_timeout: readPositiveInt(env, "DB_STATEMENT_TIMEOUT_MS", 30000),
    query_timeout: readPositiveInt(env, "DB_QUERY_TIMEOUT_MS", 35000),
    lock_timeout: readPositiveInt(env, "DB_LOCK_TIMEOUT_MS", 5000),
    idle_in_transaction_session_timeout: readPositiveInt(
      env,
      "DB_IDLE_TRANSACTION_TIMEOUT_MS",
      30000,
    ),
    application_name: applicationName,
  };
}

function buildDatabaseTransactionOptions(env = process.env) {
  return {
    maxWait: readPositiveInt(env, "DB_TRANSACTION_MAX_WAIT_MS", 15000),
    timeout: readPositiveInt(env, "DB_TRANSACTION_TIMEOUT_MS", 30000),
  };
}

module.exports = {
  buildDatabasePoolConfig,
  buildDatabaseTransactionOptions,
};
