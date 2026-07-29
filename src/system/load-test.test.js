const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  LOAD_TEST_SCENARIOS,
  assertLoopbackLoadTarget,
  assertSafeLoadDatabase,
  buildScenarioSchedule,
  compareNotificationState,
  evaluateThresholds,
  parseLoadTestConfig,
  percentile,
  resolveReportDirectory,
  runLoadPhase,
  summarizeSamples,
} = require("./performance-harness");

test("target load test wajib loopback, tanpa credential, query, atau path", () => {
  assert.equal(
    assertLoopbackLoadTarget("http://127.0.0.1:7211").port,
    "7211",
  );
  assert.throws(
    () => assertLoopbackLoadTarget("https://ruwangarsip.com"),
    /loopback/,
  );
  assert.throws(
    () => assertLoopbackLoadTarget("http://admin:secret@localhost:7211"),
    /credential/,
  );
  assert.throws(
    () => assertLoopbackLoadTarget("http://localhost:7211/api/v1"),
    /origin tanpa path/,
  );
});

test("database load test dibatasi ke lokal atau CI GitHub eksplisit", () => {
  assert.equal(
    assertSafeLoadDatabase({
      DATABASE_URL: "postgresql://user:secret@localhost:5432/ruwang_arsip_local",
    }).mode,
    "local",
  );
  assert.equal(
    assertSafeLoadDatabase({
      CI: "true",
      GITHUB_ACTIONS: "true",
      DATABASE_URL: "postgresql://user:secret@postgres:5432/ruwang_arsip_ci",
    }).mode,
    "github_ci",
  );
  assert.throws(
    () =>
      assertSafeLoadDatabase({
        DATABASE_URL: "postgresql://user:secret@database.example/production",
      }),
    /ditolak/,
  );
  assert.throws(
    () =>
      assertSafeLoadDatabase({
        DATABASE_URL: "postgresql://user:secret@localhost/local",
        DATABASE_SYSTEM_URL:
          "postgresql://system:secret@database.example/production",
      }),
    /DATABASE_SYSTEM_URL/,
  );
});

test("profil dan override load test divalidasi dengan batas keras", () => {
  const smoke = parseLoadTestConfig({}, "smoke");
  assert.equal(smoke.concurrency, 4);
  assert.equal(smoke.durationMs, 3_000);
  assert.equal(smoke.thresholds.maxP95Ms, null);

  const configured = parseLoadTestConfig(
    {
      LOAD_TEST_CONCURRENCY: "12",
      LOAD_TEST_DURATION_MS: "5000",
      LOAD_TEST_MAX_ERROR_RATE_PERCENT: "0.5",
      LOAD_TEST_MAX_P95_MS: "750",
      LOAD_TEST_MIN_REQUESTS_PER_SECOND: "25",
    },
    "baseline",
  );
  assert.equal(configured.concurrency, 12);
  assert.equal(configured.thresholds.maxErrorRatePercent, 0.5);
  assert.throws(
    () => parseLoadTestConfig({ LOAD_TEST_CONCURRENCY: "101" }),
    /1-100/,
  );
  assert.throws(
    () => parseLoadTestConfig({}, "tidak-ada"),
    /tidak dikenal/,
  );
});

test("jadwal skenario mengikuti bobot yang dinyatakan", () => {
  const schedule = buildScenarioSchedule([
    { id: "a", weight: 2 },
    { id: "b", weight: 1 },
  ]);
  assert.deepEqual(schedule.map((entry) => entry.id), ["a", "a", "b"]);
});

test("skenario bawaan hanya membaca endpoint terautentikasi yang ditetapkan", () => {
  assert.deepEqual(
    LOAD_TEST_SCENARIOS.map(({ method, path }) => ({ method, path })),
    [
      { method: "GET", path: "/api/v1/notifications/unread-count" },
      { method: "GET", path: "/api/v1/menus" },
      { method: "GET", path: "/api/v1/activity-centre/summary" },
    ],
  );
});

test("ringkasan menghitung throughput, percentile, status, dan kegagalan", () => {
  const samples = [
    { scenario: "a", status: 200, latencyMs: 10, bytes: 10, requestIdMatched: true, ok: true },
    { scenario: "a", status: 200, latencyMs: 20, bytes: 20, requestIdMatched: true, ok: true },
    { scenario: "b", status: 500, latencyMs: 30, bytes: 30, requestIdMatched: false, ok: false },
  ];
  const summary = summarizeSamples(samples, 1_000, "duration");

  assert.equal(summary.requests, 3);
  assert.equal(summary.failed, 1);
  assert.equal(summary.requests_per_second, 3);
  assert.equal(summary.latency_ms.p95, 30);
  assert.equal(summary.request_id_mismatches, 1);
  assert.equal(summary.status_counts[500], 1);
  assert.equal(percentile([10, 20, 30, 40], 0.5), 20);
});

test("threshold hanya dinilai jika nilainya dikonfigurasi", () => {
  const summary = {
    error_rate_percent: 1,
    latency_ms: { p95: 250 },
    requests_per_second: 20,
  };
  assert.deepEqual(
    evaluateThresholds(summary, {
      maxErrorRatePercent: null,
      maxP95Ms: null,
      minRequestsPerSecond: null,
    }),
    {
      configured: false,
      values: {
        max_error_rate_percent: null,
        max_p95_ms: null,
        min_requests_per_second: null,
      },
      passed: true,
      violations: [],
    },
  );
  assert.deepEqual(
    evaluateThresholds(summary, {
      maxErrorRatePercent: 0,
      maxP95Ms: 200,
      minRequestsPerSecond: 25,
    }).violations,
    ["max_error_rate_percent", "max_p95_ms", "min_requests_per_second"],
  );
});

test("load test menolak perubahan keadaan notifikasi", () => {
  const before = {
    count: 12,
    latest_created_at: "2026-07-26T00:00:00.000Z",
    latest_updated_at: "2026-07-26T00:00:00.000Z",
  };
  assert.equal(compareNotificationState(before, { ...before }).unchanged, true);
  assert.equal(
    compareNotificationState(before, {
      ...before,
      latest_updated_at: "2026-07-26T00:01:00.000Z",
    }).unchanged,
    false,
  );
  assert.equal(
    compareNotificationState(before, { ...before, count: 13 }).unchanged,
    false,
  );
});

test("fase load memverifikasi status, JSON, dan korelasi request ID", async () => {
  const responses = [];
  const result = await runLoadPhase({
    baseUrl: new URL("http://127.0.0.1:7211"),
    concurrency: 2,
    durationMs: 1_000,
    maxRequests: 4,
    requestTimeoutMs: 100,
    runId: "123e4567-e89b-42d3-a456-426614174000",
    token: "token-test",
    userAgent: "RuwangArsipLoadTest/test",
    scenarios: [
      {
        id: "read",
        method: "GET",
        path: "/api/v1/menus",
        expectedStatuses: [200],
        weight: 1,
      },
    ],
    async fetchImpl(url, options) {
      responses.push({ url, options });
      return new Response(JSON.stringify({ status: true, success: true }), {
        status: 200,
        headers: { "X-Request-Id": options.headers["X-Request-Id"] },
      });
    },
  });

  assert.equal(result.requests, 4);
  assert.equal(result.failed, 0);
  assert.equal(result.stop_reason, "max_requests");
  assert.equal(responses[0].options.headers.Authorization, "Bearer token-test");
  assert.equal(JSON.stringify(result).includes("token-test"), false);
});

test("direktori laporan tidak boleh menunjuk repository atau filesystem root", () => {
  const repository = path.resolve("D:\\backend-production");
  assert.throws(() => resolveReportDirectory(".", repository), /tidak aman/);
  assert.match(
    resolveReportDirectory("performance-reports", repository),
    /performance-reports[\\/]latest$/,
  );
});
