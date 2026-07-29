const { loadEnv } = require("./config/env");
loadEnv();

const express = require("express");
const cors = require("cors");
const requestId = require("./middlewares/request-id.middleware");
const { requestContext } = require("./utils/request-context");
const systemActivity = require("./middlewares/system-activity.middleware");
const securityHeaders = require("./middlewares/security-headers.middleware");
const serverErrorResponse = require("./middlewares/server-error-response.middleware");
const requestLogging = require("./middlewares/request-logging.middleware");
const telemetry = require("./middlewares/telemetry.middleware");
const drainMiddleware = require("./middlewares/drain.middleware");
const healthController = require("./system/health.controller");
const { mountOpenApi } = require("./docs/openapi.route");
const { createApiV1Router } = require("./routes/api-v1.router");
const {
  apiVersion,
  legacyApi,
} = require("./middlewares/api-version.middleware");
const {
  API_VERSION_PATH,
  LEGACY_API_PATH,
} = require("./utils/api-version");
const secureFileAccess = require("./middlewares/secure-file-access.middleware");
const {
  downloadRateLimit,
  fileAccessAttemptRateLimit,
} = require("./middlewares/rate-limit.middleware");
const { PUBLIC_PREFIX, STORAGE_ROOT } = require("./utils/persuratan-files");
const {
  PUBLIC_PREFIX: DIGITAL_ARCHIVE_PUBLIC_PREFIX,
  STORAGE_ROOT: DIGITAL_ARCHIVE_STORAGE_ROOT,
} = require("./utils/digital-archive-files");
const {
  PUBLIC_PREFIX: WATERMARK_PUBLIC_PREFIX,
  STORAGE_ROOT: WATERMARK_STORAGE_ROOT,
} = require("./utils/watermark-files");
const {
  PUBLIC_PREFIX: WATERMARKED_PUBLIC_PREFIX,
  STORAGE_ROOT: WATERMARKED_STORAGE_ROOT,
} = require("./utils/watermarked-files");
const { logErrorOnce } = require("./system/error-observability");

function parseCorsOrigins() {
  const raw = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getBodyLimit(key, fallback) {
  const value = process.env[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

const app = express();
app.disable("x-powered-by");
const configuredProxyHops = Number(process.env.TRUST_PROXY_HOPS);
app.set(
  "trust proxy",
  Number.isInteger(configuredProxyHops) && configuredProxyHops >= 0
    ? configuredProxyHops
    : 1,
);
app.use(securityHeaders);
app.use(requestId);
app.use(telemetry);
app.use(requestContext);
app.use(requestLogging);
app.use(serverErrorResponse);
app.use(drainMiddleware);

const allowedCorsOrigins = parseCorsOrigins();
app.use(
  cors(
    allowedCorsOrigins.length > 0
      ? {
          origin(origin, callback) {
            if (!origin || allowedCorsOrigins.includes(origin)) {
              return callback(null, true);
            }

            const error = new Error("CORS origin not allowed");
            error.statusCode = 403;
            return callback(error);
          },
          credentials: true,
          exposedHeaders: ["X-Request-Id"],
        }
      : undefined,
  ),
);
app.use(express.json({ limit: getBodyLimit("JSON_BODY_LIMIT", "1mb") }));
app.use(
  express.urlencoded({
    extended: true,
    limit: getBodyLimit("URLENCODED_BODY_LIMIT", "1mb"),
  }),
);
app.use(systemActivity);

const staticStorageMounts = [
  {
    publicPrefix: PUBLIC_PREFIX,
    storageRoot: STORAGE_ROOT,
    secure: true,
  },
  {
    publicPrefix: DIGITAL_ARCHIVE_PUBLIC_PREFIX,
    storageRoot: DIGITAL_ARCHIVE_STORAGE_ROOT,
    secure: true,
  },
  {
    publicPrefix: WATERMARK_PUBLIC_PREFIX,
    storageRoot: WATERMARK_STORAGE_ROOT,
    secure: false,
  },
  {
    publicPrefix: WATERMARKED_PUBLIC_PREFIX,
    storageRoot: WATERMARKED_STORAGE_ROOT,
    secure: true,
  },
];

function setWatermarkAssetHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
}

for (const mount of staticStorageMounts) {
  const staticMiddleware = express.static(mount.storageRoot, {
    dotfiles: "deny",
    index: false,
    ...(mount.publicPrefix === WATERMARK_PUBLIC_PREFIX
      ? { setHeaders: setWatermarkAssetHeaders }
      : {}),
  });
  const middlewares = mount.secure
    ? [
        fileAccessAttemptRateLimit,
        secureFileAccess(mount.publicPrefix),
        downloadRateLimit,
        staticMiddleware,
      ]
    : [staticMiddleware];

  app.use(mount.publicPrefix, ...middlewares);
}

app.get("/health", healthController.liveness);
app.get("/ready", healthController.readiness);

app.use(API_VERSION_PATH, apiVersion);
mountOpenApi(app);

const apiV1Router = createApiV1Router();
app.use(API_VERSION_PATH, apiV1Router);
app.use(LEGACY_API_PATH, legacyApi, apiVersion, apiV1Router);

app.use((req, res) => {
  res.status(404).json({
    status: false,
    success: false,
    request_id: req.requestId || null,
    message: "Route not found",
  });
});

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;
  const requestId = req.requestId || null;
  const isMalformedJson =
    statusCode === 400 && err && err.type === "entity.parse.failed";

  if (statusCode >= 500) {
    logErrorOnce(err, {
      event: "http_request_error",
      message: "Unhandled HTTP request error",
      fields: {
        request_id: requestId,
        request_method: req.method,
        request_path: String(req.originalUrl || req.url || "").split("?")[0],
        response_status: statusCode,
      },
    });
  }

  res.status(statusCode).json({
    status: false,
    success: false,
    request_id: requestId,
    message: isMalformedJson
      ? "Payload JSON tidak valid."
      : statusCode >= 500
        ? "Internal server error"
        : err.message || "Internal server error",
  });
});

module.exports = app;
