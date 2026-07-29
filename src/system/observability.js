const {
  SpanKind,
  SpanStatusCode,
  context,
  isSpanContextValid,
  propagation,
  trace,
} = require("@opentelemetry/api");
const { OTLPTraceExporter } = require(
  "@opentelemetry/exporter-trace-otlp-http",
);
const { resourceFromAttributes } = require("@opentelemetry/resources");
const { NodeSDK } = require("@opentelemetry/sdk-node");
const {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
} = require("@opentelemetry/semantic-conventions");
const { logger } = require("./logger");

const TRACER_NAME = "ruwang-arsip-backend";

let sdk;
let observabilityState = {
  enabled: false,
  started: false,
  startup_error: false,
};

function readBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase(),
  );
}

function isObservabilityEnabled(env = process.env) {
  return readBoolean(env.OTEL_ENABLED, false);
}

function resolveTelemetryServiceName(env = process.env) {
  const configured = String(env.OTEL_SERVICE_NAME || "").trim();
  if (configured) return configured;
  const role = String(env.RUNTIME_ROLE || "api")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");
  return `ruwang-arsip-${role}`;
}

function startObservability({
  env = process.env,
  sdkFactory = (options) => new NodeSDK(options),
  traceExporterFactory = () => new OTLPTraceExporter(),
  eventLogger = logger,
} = {}) {
  if (sdk) return { ...observabilityState };
  if (!isObservabilityEnabled(env)) {
    observabilityState = {
      enabled: false,
      started: false,
      startup_error: false,
    };
    return { ...observabilityState };
  }

  try {
    const serviceName = resolveTelemetryServiceName(env);
    sdk = sdkFactory({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
        [ATTR_SERVICE_NAMESPACE]: "ruwang-arsip",
        "deployment.environment.name": env.NODE_ENV || "development",
        "service.instance.id": env.INSTANCE_ID || `${serviceName}-${process.pid}`,
      }),
      traceExporter: traceExporterFactory(),
    });
    sdk.start();
    observabilityState = {
      enabled: true,
      started: true,
      startup_error: false,
    };
    eventLogger.info(
      {
        event: "observability_started",
        component: "opentelemetry",
        telemetry_service: serviceName,
      },
      "OpenTelemetry tracing started",
    );
  } catch (error) {
    sdk = undefined;
    observabilityState = {
      enabled: true,
      started: false,
      startup_error: true,
    };
    eventLogger.error(
      {
        event: "observability_startup_failed",
        component: "opentelemetry",
        err: error,
      },
      "OpenTelemetry tracing failed to start",
    );
  }
  return { ...observabilityState };
}

function getObservabilityState() {
  return { ...observabilityState };
}

function getActiveTraceFields() {
  const span = trace.getSpan(context.active());
  const spanContext = span?.spanContext();
  if (!spanContext || !isSpanContextValid(spanContext)) return {};
  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
  };
}

function injectTraceCarrier() {
  if (!observabilityState.started) return null;
  const carrier = {};
  propagation.inject(context.active(), carrier);
  return Object.keys(carrier).length > 0 ? carrier : null;
}

async function runWithSpan(
  name,
  {
    attributes = {},
    kind = SpanKind.INTERNAL,
    parentCarrier = null,
  } = {},
  callback,
) {
  if (typeof callback !== "function") {
    throw new Error("Callback telemetry span wajib berupa fungsi.");
  }
  if (!observabilityState.started) return callback();

  const parentContext = parentCarrier
    ? propagation.extract(context.active(), parentCarrier)
    : context.active();
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(
    name,
    { attributes, kind },
    parentContext,
    async (span) => {
      try {
        return await callback(span);
      } catch (error) {
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error?.name || "Error",
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

function recordActiveException(error) {
  const span = trace.getSpan(context.active());
  if (!span || !error) return false;
  span.recordException(error);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error?.name || "Error",
  });
  return true;
}

function recordClientErrorReport(fields = {}) {
  const span = trace.getSpan(context.active());
  if (!span) return false;

  const attributes = {};
  for (const [key, value] of Object.entries(fields)) {
    if (
      value !== undefined &&
      value !== null &&
      ["string", "number", "boolean"].includes(typeof value)
    ) {
      attributes[`client.error.${key}`] = value;
    }
  }
  span.addEvent("frontend.error", attributes);
  span.setStatus({ code: SpanStatusCode.ERROR, message: "FrontendError" });
  return true;
}

async function checkObservabilityHealth() {
  const state = getObservabilityState();
  if (!state.enabled) return { enabled: false };
  if (!state.started) {
    throw new Error("OpenTelemetry tracing tidak aktif.");
  }
  return { enabled: true, started: true };
}

async function shutdownObservability() {
  if (!sdk) return;
  const activeSdk = sdk;
  sdk = undefined;
  try {
    await activeSdk.shutdown();
    observabilityState = {
      enabled: observabilityState.enabled,
      started: false,
      startup_error: false,
    };
  } catch (error) {
    observabilityState = {
      enabled: observabilityState.enabled,
      started: false,
      startup_error: true,
    };
    logger.error(
      {
        event: "observability_shutdown_failed",
        component: "opentelemetry",
        err: error,
      },
      "OpenTelemetry tracing failed to shut down",
    );
  }
}

module.exports = {
  SpanKind,
  SpanStatusCode,
  checkObservabilityHealth,
  getActiveTraceFields,
  getObservabilityState,
  injectTraceCarrier,
  isObservabilityEnabled,
  recordActiveException,
  recordClientErrorReport,
  resolveTelemetryServiceName,
  runWithSpan,
  shutdownObservability,
  startObservability,
};
