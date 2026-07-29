const pino = require("pino");
const { getRequestContext } = require("../utils/request-context");
const { context, isSpanContextValid, trace } = require("@opentelemetry/api");

const REDACTED = "[REDACTED]";
const DEFAULT_MAX_STRING_LENGTH = 16 * 1024;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 100;
const MAX_DEPTH = 8;
const SENSITIVE_KEY =
  /(?:password|passwd|secret|authorization|cookie|token|otp|recovery[_-]?code|api[_-]?key|private[_-]?key|credential|dsn)/i;
const LOG_LEVELS = new Set([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);

function readPositiveIntEnv(key, fallback, env = process.env) {
  const value = Number(env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function resolveLogLevel(env = process.env) {
  const configured = String(env.LOG_LEVEL || "")
    .trim()
    .toLowerCase();
  if (LOG_LEVELS.has(configured)) return configured;
  return env.NODE_ENV === "test" ? "silent" : "info";
}

function sanitizeLogString(
  value,
  maxLength = readPositiveIntEnv(
    "LOG_MAX_STRING_LENGTH",
    DEFAULT_MAX_STRING_LENGTH,
  ),
) {
  const sanitized = String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(
      /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
      REDACTED,
    )
    .replace(
      /\b(redis|rediss|postgres|postgresql|mysql|https?):\/\/[^@\s/]+@/gi,
      (_match, protocol) => `${protocol}://${REDACTED}@`,
    )
    .replace(
      /([?&](?:password|secret|token|key|api_key)=)[^&#\s]*/gi,
      `$1${REDACTED}`,
    )
    .replace(
      /\b(password|passwd|secret|authorization|cookie|token|api[_-]?key|credential|dsn)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
      (_match, key) => `${key}=${REDACTED}`,
    );

  if (sanitized.length <= maxLength) return sanitized;
  return `${sanitized.slice(0, maxLength)}...[TRUNCATED]`;
}

function serializeError(error, seen, depth, maxStringLength) {
  const serialized = {
    type: sanitizeLogString(
      error?.name || error?.constructor?.name || "Error",
      maxStringLength,
    ),
    message: sanitizeLogString(
      error?.message || "Unknown error",
      maxStringLength,
    ),
  };
  if (
    typeof error?.code === "string" &&
    /^[A-Za-z0-9_.-]{1,80}$/.test(error.code)
  ) {
    serialized.code = error.code;
  }
  if (typeof error?.stack === "string") {
    serialized.stack = sanitizeLogString(error.stack, maxStringLength);
  }
  if (error?.cause && depth < MAX_DEPTH) {
    serialized.cause = sanitizeLogValueInternal(
      error.cause,
      seen,
      depth + 1,
      maxStringLength,
    );
  }
  return serialized;
}

function sanitizeLogValueInternal(value, seen, depth, maxStringLength) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return sanitizeLogString(value, maxStringLength);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") {
    return `[${typeof value}]`;
  }
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[MAX_DEPTH]";
  if (value instanceof Error) {
    return serializeError(value, seen, depth, maxStringLength);
  }
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) =>
        sanitizeLogValueInternal(
          item,
          seen,
          depth + 1,
          maxStringLength,
        ),
      );
    if (value.length > MAX_ARRAY_ITEMS) result.push("[TRUNCATED_ITEMS]");
    return result;
  }

  const result = {};
  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
  for (const [key, item] of entries) {
    result[key] = SENSITIVE_KEY.test(key)
      ? REDACTED
      : sanitizeLogValueInternal(
          item,
          seen,
          depth + 1,
          maxStringLength,
        );
  }
  if (Object.keys(value).length > MAX_OBJECT_KEYS) {
    result._truncated_keys = true;
  }
  return result;
}

function sanitizeLogValue(
  value,
  {
    maxStringLength = readPositiveIntEnv(
      "LOG_MAX_STRING_LENGTH",
      DEFAULT_MAX_STRING_LENGTH,
    ),
  } = {},
) {
  return sanitizeLogValueInternal(
    value,
    new WeakSet(),
    0,
    maxStringLength,
  );
}

function normalizeLogArguments(first, second) {
  if (first instanceof Error) {
    return {
      fields: { err: first },
      message: typeof second === "string" ? second : undefined,
    };
  }
  if (typeof first === "string") {
    return {
      fields:
        second instanceof Error
          ? { err: second }
          : second && typeof second === "object"
            ? second
            : {},
      message: first,
    };
  }
  return {
    fields: first && typeof first === "object" ? first : {},
    message: typeof second === "string" ? second : undefined,
  };
}

function wrapLogger(baseLogger, staticBindings = {}) {
  function activeTraceFields() {
    const spanContext = trace.getSpan(context.active())?.spanContext();
    if (!spanContext || !isSpanContextValid(spanContext)) return {};
    return {
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
    };
  }

  function write(level, first, second) {
    const { fields, message } = normalizeLogArguments(first, second);
    const context = getRequestContext();
    const payload = sanitizeLogValue({
      ...context,
      ...activeTraceFields(),
      ...staticBindings,
      ...fields,
    });
    const safeMessage = message
      ? sanitizeLogString(message)
      : undefined;
    if (safeMessage) baseLogger[level](payload, safeMessage);
    else baseLogger[level](payload);
  }

  const wrapped = {
    fatal: (first, second) => write("fatal", first, second),
    error: (first, second) => write("error", first, second),
    warn: (first, second) => write("warn", first, second),
    info: (first, second) => write("info", first, second),
    debug: (first, second) => write("debug", first, second),
    trace: (first, second) => write("trace", first, second),
    log: (first, second) => write("info", first, second),
    child(bindings = {}) {
      return wrapLogger(baseLogger, {
        ...staticBindings,
        ...sanitizeLogValue(bindings),
      });
    },
    flush() {
      baseLogger.flush?.();
    },
  };
  return wrapped;
}

function createLogger({
  destination = process.stdout,
  env = process.env,
  level = resolveLogLevel(env),
  base = {},
} = {}) {
  const baseLogger = pino(
    {
      level,
      messageKey: "message",
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      serializers: {
        err(value) {
          return value;
        },
      },
      base: {
        service: "ruwang-arsip-backend",
        app_instance: env.APP_INSTANCE_KEY || "local",
        runtime_role: env.RUNTIME_ROLE || "api",
        environment: env.NODE_ENV || "development",
        pid: process.pid,
        log_schema_version: 1,
        ...sanitizeLogValue(base),
      },
    },
    destination,
  );
  return wrapLogger(baseLogger);
}

const logger = createLogger();

module.exports = {
  DEFAULT_MAX_STRING_LENGTH,
  LOG_LEVELS,
  REDACTED,
  SENSITIVE_KEY,
  createLogger,
  logger,
  resolveLogLevel,
  sanitizeLogString,
  sanitizeLogValue,
};
