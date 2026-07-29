const assert = require("node:assert/strict");
const test = require("node:test");

const { runWithRequestContext } = require("../utils/request-context");
const { logErrorOnce } = require("./error-observability");
const {
  createThrottledErrorLogger,
} = require("./infrastructure-events");
const {
  REDACTED,
  createLogger,
  sanitizeLogString,
  sanitizeLogValue,
} = require("./logger");

function createCaptureLogger() {
  const chunks = [];
  const destination = {
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
  };
  const logger = createLogger({
    destination,
    level: "trace",
    env: {
      NODE_ENV: "test",
      RUNTIME_ROLE: "test-worker",
    },
  });
  return {
    logger,
    entries() {
      return chunks
        .join("")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
  };
}

test("structured logger meredaksi secret, credential URL, bearer, dan JWT", () => {
  const capture = createCaptureLogger();
  const jwt =
    "test-jwt-fixture-redacted";
  capture.logger.error(
    {
      event: "redaction_test",
      password: "super-secret-password",
      nested: {
        authorization: "Bearer abcdefghijklmnop",
        database_url: "postgresql://admin:db-password@database.internal/app",
        jwt_value: jwt,
      },
      err: new Error(
        "redis://cache-user:cache-password@redis.internal:6379 failed",
      ),
    },
    `Request failed with Bearer abcdefghijklmnop and ${jwt}`,
  );

  const [entry] = capture.entries();
  const serialized = JSON.stringify(entry);
  assert.equal(entry.level, "error");
  assert.equal(entry.service, "ruwang-arsip-backend");
  assert.equal(entry.runtime_role, "test-worker");
  assert.equal(entry.password, REDACTED);
  assert.equal(entry.nested.authorization, REDACTED);
  assert.equal(serialized.includes("super-secret-password"), false);
  assert.equal(serialized.includes("db-password"), false);
  assert.equal(serialized.includes("cache-password"), false);
  assert.equal(serialized.includes("abcdefghijklmnop"), false);
  assert.equal(serialized.includes(jwt), false);
  assert.match(entry.err.message, /\[REDACTED\]/);
});

test("logger membawa request ID dan job ID melalui async context", async () => {
  const capture = createCaptureLogger();

  await runWithRequestContext(
    {
      request_id: "request-correlation-123",
      job_id: "job-correlation-456",
      import_job_id: "import-correlation-789",
    },
    async () => {
      await Promise.resolve();
      capture.logger.info(
        { event: "correlation_test" },
        "Correlated event",
      );
    },
  );

  const [entry] = capture.entries();
  assert.equal(entry.request_id, "request-correlation-123");
  assert.equal(entry.job_id, "job-correlation-456");
  assert.equal(entry.import_job_id, "import-correlation-789");
});

test("error yang sama hanya dicatat satu kali", () => {
  const capture = createCaptureLogger();
  const error = new Error("same failure");

  assert.equal(
    logErrorOnce(error, {
      logger: capture.logger,
      event: "duplicate_test",
    }),
    true,
  );
  assert.equal(
    logErrorOnce(error, {
      logger: capture.logger,
      event: "duplicate_test",
    }),
    false,
  );
  assert.equal(capture.entries().length, 1);
});

test("infrastructure error ditahan dan jumlah event yang ditekan dilaporkan", () => {
  let now = 1000;
  const records = [];
  const logger = {
    error(fields, message) {
      records.push({ fields, message });
    },
  };
  const logError = createThrottledErrorLogger({
    component: "redis_test",
    intervalMs: 1000,
    now: () => now,
    logger,
  });

  assert.equal(logError(new Error("first")), true);
  now = 1100;
  assert.equal(logError(new Error("second")), false);
  assert.equal(logError(new Error("third")), false);
  now = 2000;
  assert.equal(logError(new Error("fourth")), true);

  assert.equal(records.length, 2);
  assert.equal(records[0].fields.suppressed_count, 0);
  assert.equal(records[1].fields.suppressed_count, 2);
});

test("sanitizer membatasi payload, menangani circular, dan tidak mengubah nilai aman", () => {
  const value = { safe: "value" };
  value.self = value;
  value.buffer = Buffer.from("private file");
  value.api_key = "private-api-key";
  const sanitized = sanitizeLogValue(value, { maxStringLength: 100 });

  assert.equal(sanitized.safe, "value");
  assert.equal(sanitized.self, "[CIRCULAR]");
  assert.equal(sanitized.buffer, "[Buffer 12 bytes]");
  assert.equal(sanitized.api_key, REDACTED);
  assert.equal(
    sanitizeLogString("password=private-value", 100),
    `password=${REDACTED}`,
  );
});
