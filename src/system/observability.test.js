const assert = require("node:assert/strict");
const test = require("node:test");

const {
  checkObservabilityHealth,
  getObservabilityState,
  injectTraceCarrier,
  isObservabilityEnabled,
  resolveTelemetryServiceName,
  runWithSpan,
  shutdownObservability,
  startObservability,
} = require("./observability");

test("OpenTelemetry default nonaktif dan nama service mengikuti runtime role", () => {
  assert.equal(isObservabilityEnabled({}), false);
  assert.equal(
    isObservabilityEnabled({ OTEL_ENABLED: "true" }),
    true,
  );
  assert.equal(
    resolveTelemetryServiceName({ RUNTIME_ROLE: "slik-import-worker" }),
    "ruwang-arsip-slik-import-worker",
  );
  assert.equal(
    resolveTelemetryServiceName({
      RUNTIME_ROLE: "api",
      OTEL_SERVICE_NAME: "custom-api",
    }),
    "custom-api",
  );
});

test("observability disabled tidak membuat span atau mengubah hasil callback", async () => {
  const state = startObservability({ env: { OTEL_ENABLED: "false" } });
  assert.deepEqual(state, {
    enabled: false,
    started: false,
    startup_error: false,
  });
  assert.equal(injectTraceCarrier(), null);
  assert.equal(
    await runWithSpan("disabled span", {}, async () => "result"),
    "result",
  );
});

test("lifecycle SDK dapat start, diperiksa, dan shutdown tanpa collector nyata", async () => {
  let startCalls = 0;
  let shutdownCalls = 0;
  const fakeSdk = {
    start() {
      startCalls += 1;
    },
    async shutdown() {
      shutdownCalls += 1;
    },
  };
  const state = startObservability({
    env: {
      NODE_ENV: "test",
      RUNTIME_ROLE: "api",
      OTEL_ENABLED: "true",
    },
    sdkFactory: () => fakeSdk,
    traceExporterFactory: () => ({ exporter: "fake" }),
    eventLogger: { info() {}, error() {} },
  });

  assert.equal(state.enabled, true);
  assert.equal(state.started, true);
  assert.equal(startCalls, 1);
  assert.deepEqual(await checkObservabilityHealth(), {
    enabled: true,
    started: true,
  });

  await shutdownObservability();
  assert.equal(shutdownCalls, 1);
  assert.equal(getObservabilityState().started, false);
});

test("kegagalan startup observability bersifat fail-soft dan terlihat di health", async () => {
  const state = startObservability({
    env: {
      OTEL_ENABLED: "true",
      RUNTIME_ROLE: "api",
    },
    sdkFactory() {
      throw new Error("collector credential=top-secret-value");
    },
    traceExporterFactory: () => ({ exporter: "fake" }),
    eventLogger: { info() {}, error() {} },
  });

  assert.equal(state.enabled, true);
  assert.equal(state.started, false);
  assert.equal(state.startup_error, true);
  await assert.rejects(checkObservabilityHealth(), /tidak aktif/);
  await shutdownObservability();
});
