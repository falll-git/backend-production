const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildDatabasePoolConfig,
  buildDatabaseTransactionOptions,
} = require("./database-pool");

test("pool database memakai batas koneksi dan timeout dari environment", () => {
  const config = buildDatabasePoolConfig({
    DATABASE_URL: "postgresql://example.invalid/database",
    DB_POOL_MIN: "2",
    DB_POOL_MAX: "12",
    DB_CONNECTION_TIMEOUT_MS: "4000",
    DB_POOL_IDLE_TIMEOUT_MS: "20000",
    DB_STATEMENT_TIMEOUT_MS: "25000",
    DB_QUERY_TIMEOUT_MS: "30000",
    DB_LOCK_TIMEOUT_MS: "3000",
    DB_IDLE_TRANSACTION_TIMEOUT_MS: "15000",
  });

  assert.deepEqual(config, {
    connectionString: "postgresql://example.invalid/database",
    min: 2,
    max: 12,
    connectionTimeoutMillis: 4000,
    idleTimeoutMillis: 20000,
    statement_timeout: 25000,
    query_timeout: 30000,
    lock_timeout: 3000,
    idle_in_transaction_session_timeout: 15000,
    application_name: "ruwang-arsip-api",
  });
});

test("worker memakai pool terpisah dan application name yang dapat ditelusuri", () => {
  const config = buildDatabasePoolConfig({
    RUNTIME_ROLE: "slik-import-worker",
    DATABASE_URL: "postgresql://example.invalid/database",
    DB_POOL_MIN: "0",
    DB_POOL_MAX: "20",
    DB_WORKER_POOL_MAX: "4",
  });

  assert.equal(config.max, 4);
  assert.equal(config.application_name, "ruwang-arsip-slik-import-worker");
});

test("transaksi Prisma memakai batas tunggu dan eksekusi eksplisit", () => {
  assert.deepEqual(
    buildDatabaseTransactionOptions({
      DB_TRANSACTION_MAX_WAIT_MS: "7000",
      DB_TRANSACTION_TIMEOUT_MS: "24000",
    }),
    { maxWait: 7000, timeout: 24000 },
  );
});

test("transaksi Prisma memakai default aman saat environment tidak valid", () => {
  assert.deepEqual(
    buildDatabaseTransactionOptions({
      DB_TRANSACTION_MAX_WAIT_MS: "0",
      DB_TRANSACTION_TIMEOUT_MS: "invalid",
    }),
    { maxWait: 15000, timeout: 30000 },
  );
});

test("default antrean transaksi tidak berakhir sebelum checkout pool", () => {
  const pool = buildDatabasePoolConfig({});
  const transaction = buildDatabaseTransactionOptions({});

  assert.equal(pool.connectionTimeoutMillis, 15000);
  assert.equal(transaction.maxWait, pool.connectionTimeoutMillis);
  assert.ok(transaction.timeout > transaction.maxWait);
});
