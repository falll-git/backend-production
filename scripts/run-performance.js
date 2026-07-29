const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const { loadEnv } = require("../src/config/env");
const prisma = require("../src/config/prisma");
const systemPrisma = require("../src/config/prisma-system");
const {
  assertSafeLoadDatabase,
  compareNotificationState,
  parseLoadTestConfig,
  resolveReportDirectory,
  runLoadPlan,
} = require("../src/system/performance-harness");

const REPOSITORY_DIRECTORY = path.resolve(__dirname, "..");

function readProfile(argv = process.argv.slice(2)) {
  const profileArgument = argv.find((argument) => argument.startsWith("--profile="));
  return profileArgument ? profileArgument.slice("--profile=".length) : "baseline";
}

function readCredentials(env = process.env) {
  const username = String(
    env.API_TEST_ADMIN_USERNAME || env.SEED_ADMIN_USERNAME || "",
  ).trim();
  const password = String(
    env.API_TEST_ADMIN_PASSWORD || env.SEED_ADMIN_PASSWORD || "",
  );
  if (!username || !password) {
    throw new Error(
      "Load test membutuhkan API_TEST_ADMIN atau SEED_ADMIN credential.",
    );
  }
  return { username, password };
}

function resolvePort(baseUrl) {
  return Number(baseUrl.port || (baseUrl.protocol === "https:" ? 443 : 80));
}

function assertPortAvailable(hostname, port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => {
      reject(new Error(`Port load test ${hostname}:${port} sedang digunakan.`));
    });
    probe.listen(port, hostname, () => {
      probe.close(() => resolve());
    });
  });
}

async function terminateProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }

  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

async function waitForServer(child, healthUrl, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error("Backend load test berhenti sebelum siap.");
    }
    try {
      const response = await fetch(healthUrl, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // Server belum siap; ulangi sampai batas waktu.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Backend load test tidak siap dalam 60 detik.");
}

async function readHealth(baseUrl, pathname) {
  const response = await fetch(new URL(pathname, baseUrl), {
    cache: "no-store",
    headers: { "X-Request-Id": `load-health:${crypto.randomUUID()}` },
  });
  const payload = await response.json();
  return {
    http_status: response.status,
    ready: payload?.data?.ready ?? payload?.status ?? false,
    state: payload?.data?.state || payload?.message || "unknown",
  };
}

async function login(baseUrl, credentials, runId, userAgent) {
  const response = await fetch(new URL("/api/v1/auth/login", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": userAgent,
      "X-Request-Id": `load-login:${runId}`,
    },
    body: JSON.stringify({
      username: credentials.username,
      password: credentials.password,
      remember: false,
    }),
  });
  const payload = await response.json();
  const token = payload?.data?.token;
  if (!response.ok || typeof token !== "string" || !token) {
    throw new Error("Login akun load test gagal.");
  }
  return token;
}

async function logout(baseUrl, token, runId, userAgent) {
  if (!token) return false;
  try {
    const response = await fetch(new URL("/api/v1/auth/logout", baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": userAgent,
        "X-Request-Id": `load-logout:${runId}`,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function cleanupLoadArtifacts(userAgent) {
  const results = await Promise.allSettled([
    systemPrisma.system_activity_logs.deleteMany({ where: { user_agent: userAgent } }),
    systemPrisma.debtor_activity_logs.deleteMany({ where: { user_agent: userAgent } }),
    systemPrisma.legal_activity_logs.deleteMany({ where: { user_agent: userAgent } }),
    systemPrisma.refresh_tokens.deleteMany({ where: { user_agent: userAgent } }),
  ]);
  return {
    passed: results.every((result) => result.status === "fulfilled"),
    operations: results.length,
  };
}

function normalizeTimestamp(value) {
  return value instanceof Date ? value.toISOString() : null;
}

async function readNotificationState() {
  const result = await systemPrisma.notifications.aggregate({
    _count: { id: true },
    _max: {
      created_at: true,
      updated_at: true,
    },
  });
  return {
    count: result._count.id,
    latest_created_at: normalizeTimestamp(result._max.created_at),
    latest_updated_at: normalizeTimestamp(result._max.updated_at),
  };
}

function writeReport(reportDirectory, report) {
  fs.mkdirSync(reportDirectory, { recursive: true });
  const reportPath = path.join(reportDirectory, "report.json");
  const temporaryPath = `${reportPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.rmSync(reportPath, { force: true });
  fs.renameSync(temporaryPath, reportPath);
  return reportPath;
}

async function run() {
  loadEnv();
  const profile = readProfile();
  const config = parseLoadTestConfig(process.env, profile);
  const database = assertSafeLoadDatabase(process.env);
  const credentials = readCredentials(process.env);
  const reportDirectory = resolveReportDirectory(
    process.env.LOAD_TEST_REPORT_DIR,
    REPOSITORY_DIRECTORY,
  );
  const runId = crypto.randomUUID();
  const userAgent = `RuwangArsipLoadTest/${runId}`;
  const port = resolvePort(config.baseUrl);
  const startedAt = new Date();
  let child;
  let token;
  let report;
  let cleanup = { passed: false, operations: 0 };
  let notificationStateBefore;

  try {
    await assertPortAvailable(config.baseUrl.hostname, port);
    child = spawn(process.execPath, ["src/server.js"], {
      cwd: REPOSITORY_DIRECTORY,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        NODE_ENV: "development",
        RUNTIME_ROLE: "api",
        HOST: config.baseUrl.hostname,
        PORT: String(port),
        LOG_LEVEL: "warn",
        HTTP_ACCESS_LOG_ENABLED: "false",
        OTEL_ENABLED: "false",
        RATE_LIMIT_STORE: "memory",
        API_RATE_LIMIT_MAX: "1000000",
        APP_CACHE_ENABLED: "false",
        SLIK_IMPORT_QUEUE_ENABLED: "false",
        SLIK_IMPORT_LOCAL_FALLBACK_ENABLED: "true",
        SLIK_IMPORT_REQUIRE_WORKER: "false",
        WATERMARK_PROCESSING_MODE: "inline",
      },
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    });
    await waitForServer(child, new URL("/health", config.baseUrl));
    const healthBefore = await readHealth(config.baseUrl, "/ready");
    if (healthBefore.http_status !== 200 || healthBefore.ready !== true) {
      throw new Error("Readiness backend tidak siap sebelum load test.");
    }
    token = await login(config.baseUrl, credentials, runId, userAgent);
    notificationStateBefore = await readNotificationState();
    const result = await runLoadPlan({ config, runId, token, userAgent });
    const notificationState = compareNotificationState(
      notificationStateBefore,
      await readNotificationState(),
    );
    const healthAfter = await readHealth(config.baseUrl, "/ready");
    const readinessPassed =
      healthAfter.http_status === 200 && healthAfter.ready === true;

    report = {
      schema_version: 1,
      run_id: runId,
      status:
        result.passed && readinessPassed && notificationState.unchanged
          ? "passed"
          : "failed",
      profile,
      measurement_mode: result.thresholds.configured ? "threshold" : "baseline",
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      target: { scope: "loopback", protocol: config.baseUrl.protocol },
      database: { scope: database.mode },
      config: {
        concurrency: config.concurrency,
        duration_ms: config.durationMs,
        warmup_ms: config.warmupMs,
        request_timeout_ms: config.requestTimeoutMs,
        max_requests: config.maxRequests,
      },
      health: { before: healthBefore, after: healthAfter },
      data_integrity: {
        notification_state_unchanged: notificationState.unchanged,
        notification_count_before: notificationState.before.count,
        notification_count_after: notificationState.after.count,
        latest_notification_created_at_before:
          notificationState.before.latest_created_at,
        latest_notification_created_at_after:
          notificationState.after.latest_created_at,
        latest_notification_updated_at_before:
          notificationState.before.latest_updated_at,
        latest_notification_updated_at_after:
          notificationState.after.latest_updated_at,
      },
      ...result,
      cleanup: null,
    };
  } catch (error) {
    report = {
      schema_version: 1,
      run_id: runId,
      status: "failed",
      profile,
      measurement_mode: "baseline",
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      failure: {
        name: error?.name || "Error",
        reason:
          error instanceof Error && /^(Load test|Backend|Login|Readiness|Port|Akun)/.test(error.message)
            ? error.message
            : "Load test gagal pada pemeriksaan internal.",
      },
      cleanup: null,
    };
  } finally {
    await logout(config.baseUrl, token, runId, userAgent);
    try {
      cleanup = await cleanupLoadArtifacts(userAgent);
    } catch {
      cleanup = { passed: false, operations: 0 };
    }
    await terminateProcessTree(child);
    if (systemPrisma !== prisma) {
      await systemPrisma.$disconnect().catch(() => {});
    }
    await prisma.$disconnect().catch(() => {});
  }

  report.cleanup = cleanup;
  if (!cleanup.passed) report.status = "failed";
  const reportPath = writeReport(reportDirectory, report);
  const summary = {
    status: report.status,
    profile,
    run_id: runId,
    requests: report.measurement?.requests || 0,
    requests_per_second: report.measurement?.requests_per_second || 0,
    p95_ms: report.measurement?.latency_ms?.p95 || 0,
    error_rate_percent: report.measurement?.error_rate_percent ?? 100,
    thresholds_configured: report.thresholds?.configured || false,
    cleanup_passed: cleanup.passed,
    report: reportPath,
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (report.status !== "passed") process.exitCode = 1;
}

if (require.main === module) {
  run().catch(async () => {
    await prisma.$disconnect().catch(() => {});
    process.stderr.write("Load test gagal sebelum laporan dapat diselesaikan.\n");
    process.exitCode = 1;
  });
}

module.exports = {
  assertPortAvailable,
  cleanupLoadArtifacts,
  readNotificationState,
  readCredentials,
  readProfile,
  resolvePort,
  run,
};
