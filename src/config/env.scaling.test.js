const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

function validationMessage(overrides) {
  const script = `
    Object.assign(process.env, JSON.parse(process.argv[1]));
    try {
      require("./src/config/env").validateEnv();
      process.stdout.write("VALID");
    } catch (error) {
      process.stdout.write(String(error.message));
    }
  `;
  const result = spawnSync(
    process.execPath,
    ["-e", script, JSON.stringify(overrides)],
    {
      cwd: path.resolve(__dirname, "../.."),
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function productionScalingEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    RUNTIME_ROLE: "api",
    APP_INSTANCE_KEY: "demoruwangarsip",
    DB_WORKER_POOL_MAX: "3",
    HTTP_KEEP_ALIVE_TIMEOUT_MS: "65000",
    HTTP_HEADERS_TIMEOUT_MS: "66000",
    HTTP_REQUEST_TIMEOUT_MS: "300000",
    HTTP_MAX_HEADERS_COUNT: "200",
    GRACEFUL_SHUTDOWN_DRAIN_MS: "5000",
    GRACEFUL_SHUTDOWN_TIMEOUT_MS: "30000",
    JOB_QUEUE_REDIS_URL: "redis://127.0.0.1:6379",
    JOB_QUEUE_REDIS_CONNECT_TIMEOUT_MS: "5000",
    SLIK_IMPORT_QUEUE_ENABLED: "true",
    SLIK_IMPORT_QUEUE_NAME: "ruwang-arsip-demoruwangarsip-slik-import",
    SLIK_IMPORT_LOCAL_FALLBACK_ENABLED: "false",
    SLIK_IMPORT_REQUIRE_WORKER: "true",
    WORKER_SHUTDOWN_TIMEOUT_MS: "120000",
    WORKER_HEARTBEAT_KEY_PREFIX:
      "ruwang-arsip:demoruwangarsip:worker-heartbeat",
    WORKER_HEARTBEAT_INTERVAL_MS: "5000",
    WORKER_HEARTBEAT_TTL_MS: "15000",
    WORKER_HEARTBEAT_REDIS_CONNECT_TIMEOUT_MS: "1000",
    WATERMARK_PROCESSING_MODE: "worker",
    WATERMARK_WORKER_POLL_INTERVAL_MS: "2000",
    WATERMARK_WORKER_BATCH_SIZE: "1",
    WATERMARK_PROCESSING_STALE_MS: "21600000",
    ...overrides,
  };
}

test("production menolak fallback SLIK lokal dan watermark inline", () => {
  const message = validationMessage(
    productionScalingEnv({
      SLIK_IMPORT_LOCAL_FALLBACK_ENABLED: "true",
      WATERMARK_PROCESSING_MODE: "inline",
    }),
  );

  assert.match(message, /SLIK_IMPORT_LOCAL_FALLBACK_ENABLED wajib false/);
  assert.match(message, /WATERMARK_PROCESSING_MODE wajib worker/);
});

test("production menolak queue atau worker SLIK yang dinonaktifkan", () => {
  const message = validationMessage(
    productionScalingEnv({
      SLIK_IMPORT_QUEUE_ENABLED: "false",
      SLIK_IMPORT_REQUIRE_WORKER: "false",
    }),
  );

  assert.match(message, /SLIK_IMPORT_QUEUE_ENABLED wajib true/);
  assert.match(message, /SLIK_IMPORT_REQUIRE_WORKER wajib true/);
});

test("production menolak urutan timeout drain dan HTTP yang tidak aman", () => {
  const message = validationMessage(
    productionScalingEnv({
      HTTP_HEADERS_TIMEOUT_MS: "65000",
      GRACEFUL_SHUTDOWN_TIMEOUT_MS: "5000",
    }),
  );

  assert.match(message, /HTTP_HEADERS_TIMEOUT_MS harus lebih besar/);
  assert.match(message, /GRACEFUL_SHUTDOWN_TIMEOUT_MS harus lebih besar/);
});

test("production menolak TTL heartbeat yang tidak memberi ruang dua interval", () => {
  const message = validationMessage(
    productionScalingEnv({
      WORKER_HEARTBEAT_INTERVAL_MS: "5000",
      WORKER_HEARTBEAT_TTL_MS: "10000",
    }),
  );

  assert.match(
    message,
    /WORKER_HEARTBEAT_TTL_MS harus lebih besar dari dua kali/,
  );
});

test("production tidak boleh mematikan least privilege atau RLS", () => {
  const message = validationMessage(
    productionScalingEnv({
      DB_REQUIRE_LEAST_PRIVILEGE: "false",
      DB_REQUIRE_RLS: "false",
    }),
  );

  assert.match(message, /DB_REQUIRE_LEAST_PRIVILEGE wajib true/);
  assert.match(message, /DB_REQUIRE_RLS wajib true/);
});

test("production menolak namespace Redis yang tidak memuat instance domain", () => {
  const message = validationMessage(
    productionScalingEnv({
      APP_CACHE_KEY_PREFIX: "ruwang-arsip:cache",
      RATE_LIMIT_KEY_PREFIX: "ruwang-arsip:rate-limit",
      SLIK_IMPORT_QUEUE_NAME: "ruwang-arsip-slik-import",
      WORKER_HEARTBEAT_KEY_PREFIX: "ruwang-arsip:worker-heartbeat",
    }),
  );

  assert.match(message, /APP_CACHE_KEY_PREFIX wajib memuat APP_INSTANCE_KEY/);
  assert.match(message, /RATE_LIMIT_KEY_PREFIX wajib memuat APP_INSTANCE_KEY/);
  assert.match(message, /SLIK_IMPORT_QUEUE_NAME wajib memuat APP_INSTANCE_KEY/);
  assert.match(
    message,
    /WORKER_HEARTBEAT_KEY_PREFIX wajib memuat APP_INSTANCE_KEY/,
  );
});
