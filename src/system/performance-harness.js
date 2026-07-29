const crypto = require("node:crypto");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const LOAD_TEST_SCENARIOS = Object.freeze([
  Object.freeze({
    id: "notification-count",
    method: "GET",
    path: "/api/v1/notifications/unread-count",
    expectedStatuses: Object.freeze([200]),
    weight: 4,
  }),
  Object.freeze({
    id: "menu-access",
    method: "GET",
    path: "/api/v1/menus",
    expectedStatuses: Object.freeze([200]),
    weight: 3,
  }),
  Object.freeze({
    id: "activity-summary",
    method: "GET",
    path: "/api/v1/activity-centre/summary",
    expectedStatuses: Object.freeze([200]),
    weight: 1,
  }),
]);

const PROFILE_DEFAULTS = Object.freeze({
  smoke: Object.freeze({
    concurrency: 4,
    durationMs: 3_000,
    maxRequests: 5_000,
    requestTimeoutMs: 5_000,
    warmupMs: 1_000,
  }),
  baseline: Object.freeze({
    concurrency: 10,
    durationMs: 15_000,
    maxRequests: 50_000,
    requestTimeoutMs: 5_000,
    warmupMs: 3_000,
  }),
});

function parseInteger(
  value,
  label,
  fallback,
  { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {},
) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${label} harus bilangan bulat ${minimum}-${maximum}.`,
    );
  }
  return parsed;
}

function parseOptionalNumber(value, label, { minimum = 0, maximum } = {}) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed < minimum ||
    (maximum !== undefined && parsed > maximum)
  ) {
    const range = maximum === undefined ? `minimal ${minimum}` : `${minimum}-${maximum}`;
    throw new Error(`${label} harus berupa angka ${range}.`);
  }
  return parsed;
}

function assertLoopbackLoadTarget(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("LOAD_TEST_BASE_URL harus berupa URL valid.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLoopback =
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.startsWith("127.");

  if (!isLoopback || !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("LOAD_TEST_BASE_URL hanya boleh menunjuk HTTP(S) loopback.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("LOAD_TEST_BASE_URL tidak boleh memuat credential.");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("LOAD_TEST_BASE_URL tidak boleh memuat query atau fragment.");
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error("LOAD_TEST_BASE_URL harus menunjuk origin tanpa path.");
  }

  parsed.pathname = "/";
  return parsed;
}

function assertSafeLoadDatabase(env = process.env) {
  let primaryResult;
  for (const key of ["DATABASE_URL", "DATABASE_SYSTEM_URL"]) {
    const rawValue = String(env[key] || "").trim();
    if (!rawValue && key !== "DATABASE_URL") continue;

    let parsed;
    try {
      parsed = new URL(rawValue);
    } catch {
      throw new Error(`Load test ditolak: ${key} tidak valid.`);
    }

    const hostname = parsed.hostname.toLowerCase();
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    const loopback =
      hostname === "localhost" ||
      hostname === "[::1]" ||
      hostname === "::1" ||
      hostname.startsWith("127.");
    const githubCiDatabase =
      String(env.CI).toLowerCase() === "true" &&
      String(env.GITHUB_ACTIONS).toLowerCase() === "true" &&
      /(?:^|[_-])ci(?:$|[_-])/i.test(databaseName);

    if (!loopback && !githubCiDatabase) {
      throw new Error(
        `Load test ditolak: ${key} harus lokal atau database CI GitHub yang eksplisit.`,
      );
    }

    const result = {
      databaseName,
      hostname,
      mode: loopback ? "local" : "github_ci",
    };
    if (key === "DATABASE_URL") primaryResult = result;
  }

  return primaryResult;
}

function resolveReportDirectory(value, repositoryDirectory) {
  const reportRoot = path.resolve(
    repositoryDirectory,
    String(value || "performance-reports").trim(),
  );
  const filesystemRoot = path.parse(reportRoot).root;
  const relativeToRepository = path.relative(repositoryDirectory, reportRoot);

  if (
    reportRoot === filesystemRoot ||
    reportRoot === repositoryDirectory ||
    reportRoot === path.dirname(repositoryDirectory) ||
    relativeToRepository.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRepository)
  ) {
    throw new Error("LOAD_TEST_REPORT_DIR menunjuk direktori yang tidak aman.");
  }
  return path.join(reportRoot, "latest");
}

function buildScenarioSchedule(scenarios = LOAD_TEST_SCENARIOS) {
  const schedule = [];
  for (const scenario of scenarios) {
    const weight = parseInteger(scenario.weight, `${scenario.id}.weight`, 1, {
      minimum: 1,
      maximum: 100,
    });
    for (let index = 0; index < weight; index += 1) schedule.push(scenario);
  }
  if (schedule.length === 0) throw new Error("Load test membutuhkan skenario.");
  return schedule;
}

function parseLoadTestConfig(env = process.env, profile = "baseline") {
  const defaults = PROFILE_DEFAULTS[profile];
  if (!defaults) throw new Error(`Profil load test tidak dikenal: ${profile}.`);

  const baseUrl = assertLoopbackLoadTarget(
    env.LOAD_TEST_BASE_URL || "http://127.0.0.1:7211",
  );
  const concurrency = parseInteger(
    env.LOAD_TEST_CONCURRENCY,
    "LOAD_TEST_CONCURRENCY",
    defaults.concurrency,
    { minimum: 1, maximum: 100 },
  );
  const durationMs = parseInteger(
    env.LOAD_TEST_DURATION_MS,
    "LOAD_TEST_DURATION_MS",
    defaults.durationMs,
    { minimum: 1_000, maximum: 10 * 60 * 1_000 },
  );
  const warmupMs = parseInteger(
    env.LOAD_TEST_WARMUP_MS,
    "LOAD_TEST_WARMUP_MS",
    defaults.warmupMs,
    { minimum: 0, maximum: 60_000 },
  );
  const requestTimeoutMs = parseInteger(
    env.LOAD_TEST_REQUEST_TIMEOUT_MS,
    "LOAD_TEST_REQUEST_TIMEOUT_MS",
    defaults.requestTimeoutMs,
    { minimum: 100, maximum: 60_000 },
  );
  const maxRequests = parseInteger(
    env.LOAD_TEST_MAX_REQUESTS,
    "LOAD_TEST_MAX_REQUESTS",
    defaults.maxRequests,
    { minimum: concurrency, maximum: 100_000 },
  );

  return {
    profile,
    baseUrl,
    concurrency,
    durationMs,
    warmupMs,
    requestTimeoutMs,
    maxRequests,
    thresholds: {
      maxErrorRatePercent: parseOptionalNumber(
        env.LOAD_TEST_MAX_ERROR_RATE_PERCENT,
        "LOAD_TEST_MAX_ERROR_RATE_PERCENT",
        { minimum: 0, maximum: 100 },
      ),
      maxP95Ms: parseOptionalNumber(
        env.LOAD_TEST_MAX_P95_MS,
        "LOAD_TEST_MAX_P95_MS",
        { minimum: 0 },
      ),
      minRequestsPerSecond: parseOptionalNumber(
        env.LOAD_TEST_MIN_REQUESTS_PER_SECOND,
        "LOAD_TEST_MIN_REQUESTS_PER_SECOND",
        { minimum: 0 },
      ),
    },
  };
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(ratio * sorted.length) - 1);
  return round(sorted[index]);
}

function latencyBounds(values) {
  let minimum = null;
  let maximum = null;
  for (const value of values) {
    if (minimum === null || value < minimum) minimum = value;
    if (maximum === null || value > maximum) maximum = value;
  }
  return { minimum: minimum ?? 0, maximum: maximum ?? 0 };
}

function summarizeSamples(samples, durationMs, stopReason) {
  const latencies = samples
    .filter((sample) => Number.isFinite(sample.latencyMs))
    .map((sample) => sample.latencyMs);
  const total = samples.length;
  const failed = samples.filter((sample) => !sample.ok).length;
  const statuses = {};
  const errorNames = {};
  const scenarios = {};
  const overallBounds = latencyBounds(latencies);

  for (const sample of samples) {
    const statusKey = sample.status === null ? "transport_error" : String(sample.status);
    statuses[statusKey] = (statuses[statusKey] || 0) + 1;
    if (sample.errorName) {
      errorNames[sample.errorName] = (errorNames[sample.errorName] || 0) + 1;
    }
    if (!scenarios[sample.scenario]) {
      scenarios[sample.scenario] = { requests: 0, failed: 0, latencies: [] };
    }
    const entry = scenarios[sample.scenario];
    entry.requests += 1;
    if (!sample.ok) entry.failed += 1;
    if (Number.isFinite(sample.latencyMs)) entry.latencies.push(sample.latencyMs);
  }

  const scenarioSummary = Object.fromEntries(
    Object.entries(scenarios).map(([id, entry]) => [
      id,
      {
        requests: entry.requests,
        failed: entry.failed,
        error_rate_percent: round((entry.failed / entry.requests) * 100),
        latency_ms: {
          p50: percentile(entry.latencies, 0.5),
          p95: percentile(entry.latencies, 0.95),
          max: round(latencyBounds(entry.latencies).maximum),
        },
      },
    ]),
  );

  return {
    requests: total,
    succeeded: total - failed,
    failed,
    error_rate_percent: total === 0 ? 100 : round((failed / total) * 100),
    requests_per_second: durationMs > 0 ? round(total / (durationMs / 1_000)) : 0,
    response_bytes: samples.reduce((sum, sample) => sum + sample.bytes, 0),
    request_id_mismatches: samples.filter((sample) => !sample.requestIdMatched).length,
    stop_reason: stopReason,
    status_counts: statuses,
    error_names: errorNames,
    latency_ms: {
      min: round(overallBounds.minimum),
      mean:
        latencies.length > 0
          ? round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
          : 0,
      p50: percentile(latencies, 0.5),
      p90: percentile(latencies, 0.9),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      max: round(overallBounds.maximum),
    },
    scenarios: scenarioSummary,
  };
}

async function executeLoadRequest({
  baseUrl,
  fetchImpl,
  requestTimeoutMs,
  phase,
  runId,
  scenario,
  sequence,
  token,
  userAgent,
}) {
  const requestId = `load-test:${runId}:${phase}:${sequence}`;
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetchImpl(new URL(scenario.path, baseUrl).href, {
      method: scenario.method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": userAgent,
        "X-Request-Id": requestId,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.text();
    let validJson = false;
    let apiSucceeded = false;
    try {
      const parsed = JSON.parse(body);
      validJson = Boolean(parsed && typeof parsed === "object");
      apiSucceeded = validJson && parsed.status !== false && parsed.success !== false;
    } catch {
      validJson = false;
    }
    const requestIdMatched = response.headers.get("x-request-id") === requestId;
    const expectedStatus = scenario.expectedStatuses.includes(response.status);

    return {
      scenario: scenario.id,
      status: response.status,
      latencyMs: performance.now() - startedAt,
      bytes: Buffer.byteLength(body),
      requestIdMatched,
      ok: expectedStatus && requestIdMatched && validJson && apiSucceeded,
      errorName: null,
    };
  } catch (error) {
    return {
      scenario: scenario.id,
      status: null,
      latencyMs: performance.now() - startedAt,
      bytes: 0,
      requestIdMatched: false,
      ok: false,
      errorName:
        error && typeof error.name === "string" && /^[A-Za-z]+Error$/.test(error.name)
          ? error.name
          : "RequestError",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runLoadPhase({
  baseUrl,
  concurrency,
  durationMs,
  fetchImpl = fetch,
  maxRequests,
  requestTimeoutMs,
  phase = "measurement",
  runId = crypto.randomUUID(),
  scenarios = LOAD_TEST_SCENARIOS,
  token,
  userAgent = `RuwangArsipLoadTest/${runId}`,
}) {
  if (!token) throw new Error("Access token load test tidak tersedia.");
  const schedule = buildScenarioSchedule(scenarios);
  const samples = [];
  const startedAt = performance.now();
  const deadline = startedAt + durationMs;
  let issued = 0;

  async function worker() {
    while (performance.now() < deadline && issued < maxRequests) {
      const sequence = issued;
      issued += 1;
      const scenario = schedule[sequence % schedule.length];
      samples.push(
        await executeLoadRequest({
          baseUrl,
          fetchImpl,
          requestTimeoutMs,
          phase,
          runId,
          scenario,
          sequence,
          token,
          userAgent,
        }),
      );
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const actualDurationMs = performance.now() - startedAt;
  const stopReason = issued >= maxRequests ? "max_requests" : "duration";

  return {
    duration_ms: round(actualDurationMs),
    ...summarizeSamples(samples, actualDurationMs, stopReason),
  };
}

function evaluateThresholds(summary, thresholds) {
  const violations = [];
  if (
    thresholds.maxErrorRatePercent !== null &&
    summary.error_rate_percent > thresholds.maxErrorRatePercent
  ) {
    violations.push("max_error_rate_percent");
  }
  if (
    thresholds.maxP95Ms !== null &&
    summary.latency_ms.p95 > thresholds.maxP95Ms
  ) {
    violations.push("max_p95_ms");
  }
  if (
    thresholds.minRequestsPerSecond !== null &&
    summary.requests_per_second < thresholds.minRequestsPerSecond
  ) {
    violations.push("min_requests_per_second");
  }

  return {
    configured: Object.values(thresholds).some((value) => value !== null),
    values: {
      max_error_rate_percent: thresholds.maxErrorRatePercent,
      max_p95_ms: thresholds.maxP95Ms,
      min_requests_per_second: thresholds.minRequestsPerSecond,
    },
    passed: violations.length === 0,
    violations,
  };
}

function compareNotificationState(before, after) {
  const unchanged =
    before.count === after.count &&
    before.latest_created_at === after.latest_created_at &&
    before.latest_updated_at === after.latest_updated_at;
  return { before, after, unchanged };
}

async function runLoadPlan({ config, fetchImpl = fetch, runId, token, userAgent }) {
  const common = {
    baseUrl: config.baseUrl,
    concurrency: config.concurrency,
    fetchImpl,
    requestTimeoutMs: config.requestTimeoutMs,
    runId,
    token,
    userAgent,
  };
  let warmup = null;
  if (config.warmupMs > 0) {
    warmup = await runLoadPhase({
      ...common,
      durationMs: config.warmupMs,
      maxRequests: Math.min(config.maxRequests, config.concurrency * 100),
      phase: "warmup",
    });
  }
  const measurement = await runLoadPhase({
    ...common,
    durationMs: config.durationMs,
    maxRequests: config.maxRequests,
    phase: "measurement",
  });
  const thresholds = evaluateThresholds(measurement, config.thresholds);
  const functionalPassed =
    measurement.requests > 0 &&
    measurement.failed === 0 &&
    measurement.request_id_mismatches === 0 &&
    (!warmup || (warmup.failed === 0 && warmup.request_id_mismatches === 0));

  return {
    functional_passed: functionalPassed,
    warmup,
    measurement,
    thresholds,
    passed: functionalPassed && thresholds.passed,
  };
}

module.exports = {
  LOAD_TEST_SCENARIOS,
  PROFILE_DEFAULTS,
  assertLoopbackLoadTarget,
  assertSafeLoadDatabase,
  buildScenarioSchedule,
  compareNotificationState,
  evaluateThresholds,
  parseLoadTestConfig,
  percentile,
  resolveReportDirectory,
  runLoadPhase,
  runLoadPlan,
  summarizeSamples,
};
