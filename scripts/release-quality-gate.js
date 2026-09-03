const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const BACKEND_DIRECTORY = path.resolve(__dirname, "..");
const DEFAULT_TIMEOUTS = Object.freeze({
  backend: 20 * 60 * 1000,
  // The browser gate runs 95 production-build scenarios serially across
  // desktop, tablet, and mobile. A single worker keeps shared fixtures and
  // rate-limit assertions deterministic, so provide measured runtime headroom
  // instead of terminating a healthy suite near its final projects.
  frontend: 45 * 60 * 1000,
  // Role-route smoke alone exercises more than 160 authenticated page loads.
  // Keep enough headroom for a slower CI host without weakening any assertion.
  fullstack: 20 * 60 * 1000,
  performance: 5 * 60 * 1000,
  heartbeat: 30 * 1000,
});
const MAX_TIMEOUT_MS = 4 * 60 * 60 * 1000;

function readRepositoryManifest(directory, label) {
  let resolvedDirectory;
  try {
    resolvedDirectory = fs.realpathSync(directory);
  } catch {
    throw new Error(`${label} tidak ditemukan: ${directory}`);
  }

  const manifestPath = path.join(resolvedDirectory, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error(`${label} tidak memiliki package.json yang valid.`);
  }

  return { manifest, resolvedDirectory };
}

function resolveFrontendDirectory(
  env = process.env,
  backendDirectory = BACKEND_DIRECTORY,
) {
  const configuredDirectory = String(env.FULLSTACK_FRONTEND_DIR || "").trim();
  const candidate = configuredDirectory
    ? path.resolve(backendDirectory, configuredDirectory)
    : path.resolve(backendDirectory, "..", "frontend-production");
  const { manifest, resolvedDirectory } = readRepositoryManifest(
    candidate,
    "Repository frontend",
  );

  if (manifest.name !== "ruang-arsip") {
    throw new Error(
      "FULLSTACK_FRONTEND_DIR tidak menunjuk repository frontend Ruwang Arsip.",
    );
  }

  for (const scriptName of ["quality:release", "test:e2e:server"]) {
    if (!manifest.scripts?.[scriptName]) {
      throw new Error(
        `Repository frontend tidak memiliki script ${scriptName}.`,
      );
    }
  }

  return resolvedDirectory;
}

function assertLoopbackUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} harus berupa URL valid.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLoopback =
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.");

  if (!isLoopback || !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${label} wajib memakai HTTP(S) loopback.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} tidak boleh memuat credential.`);
  }

  return parsed;
}

function resolveUrlPort(parsed) {
  return Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
}

function resolveBackendHealthUrl(env) {
  const port = Number.parseInt(String(env.PORT || "7111"), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT quality gate harus berupa port valid.");
  }

  const value =
    String(env.FULLSTACK_BACKEND_HEALTH_URL || "").trim() ||
    `http://127.0.0.1:${port}/health`;
  const parsed = assertLoopbackUrl(value, "FULLSTACK_BACKEND_HEALTH_URL");
  const parsedPort = resolveUrlPort(parsed);

  if (parsedPort !== port) {
    throw new Error(
      "FULLSTACK_BACKEND_HEALTH_URL harus memakai port yang sama dengan PORT.",
    );
  }

  return parsed;
}

function parseDurationMs(value, label, fallback, { minimum = 1000 } = {}) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > MAX_TIMEOUT_MS
  ) {
    throw new Error(
      `${label} harus bilangan bulat ${minimum}-${MAX_TIMEOUT_MS} milidetik.`,
    );
  }
  return parsed;
}

function resolveReportDirectory(env, backendDirectory) {
  const configured = String(env.QUALITY_GATE_REPORT_DIR || "").trim();
  const reportRoot = path.resolve(
    backendDirectory,
    configured || "quality-reports",
  );
  const filesystemRoot = path.parse(reportRoot).root;

  if (
    reportRoot === filesystemRoot ||
    reportRoot === backendDirectory ||
    reportRoot === path.dirname(backendDirectory)
  ) {
    throw new Error("QUALITY_GATE_REPORT_DIR menunjuk direktori yang tidak aman.");
  }

  return reportRoot;
}

function createReleaseEnvironment(
  sourceEnv,
  { backendDirectory, frontendDirectory },
) {
  const adminUsername =
    sourceEnv.API_TEST_ADMIN_USERNAME ||
    sourceEnv.SEED_ADMIN_USERNAME ||
    sourceEnv.E2E_USERNAME;
  const adminPassword =
    sourceEnv.API_TEST_ADMIN_PASSWORD ||
    sourceEnv.SEED_ADMIN_PASSWORD ||
    sourceEnv.E2E_PASSWORD;
  const e2eUsername = sourceEnv.E2E_USERNAME || adminUsername;
  const e2ePassword = sourceEnv.E2E_PASSWORD || adminPassword;

  if (!adminUsername || !adminPassword || !e2eUsername || !e2ePassword) {
    throw new Error(
      "Quality gate membutuhkan credential admin dari API_TEST_ADMIN, SEED_ADMIN, atau E2E environment.",
    );
  }

  const frontendUrl =
    String(sourceEnv.FULLSTACK_FRONTEND_URL || "").trim() ||
    "http://localhost:3000";
  const frontendTarget = assertLoopbackUrl(
    frontendUrl,
    "FULLSTACK_FRONTEND_URL",
  );
  const backendHealthUrl = resolveBackendHealthUrl(sourceEnv);
  const backendApiTarget = new URL(backendHealthUrl.origin);
  backendApiTarget.hostname = frontendTarget.hostname;
  backendApiTarget.pathname = "/api/v1";
  const backendApiUrl = backendApiTarget.href;

  return {
    ...sourceEnv,
    API_TEST_ADMIN_USERNAME: adminUsername,
    API_TEST_ADMIN_PASSWORD: adminPassword,
    E2E_USERNAME: e2eUsername,
    E2E_PASSWORD: e2ePassword,
    E2E_BACKEND_DIR: backendDirectory,
    E2E_BACKEND_HEALTH_URL: backendHealthUrl.href,
    E2E_BACKEND_NODE_ENV:
      sourceEnv.E2E_BACKEND_NODE_ENV || sourceEnv.NODE_ENV || "development",
    E2E_REUSE_FRONTEND_BUILD: "true",
    FULLSTACK_BACKEND_HEALTH_URL: backendHealthUrl.href,
    FULLSTACK_FRONTEND_DIR: frontendDirectory,
    FULLSTACK_FRONTEND_URL: frontendUrl,
    FULLSTACK_REUSE_FRONTEND_BUILD: "true",
    NEXT_PUBLIC_API_URL: backendApiUrl,
    RUWANG_API_HOSTNAME: backendApiTarget.hostname,
    RUWANG_ALLOW_LOOPBACK_API: "true",
    PLAYWRIGHT_BASE_URL: frontendUrl,
    QUALITY_GATE_FRONTEND_PORT: String(resolveUrlPort(frontendTarget)),
  };
}

function buildReleaseSteps(
  backendDirectory,
  frontendDirectory,
  env = process.env,
) {
  return [
    {
      id: "backend-quality",
      label: "backend quality dan dependency audit",
      cwd: backendDirectory,
      script: "quality",
      timeoutMs: parseDurationMs(
        env.QUALITY_GATE_BACKEND_TIMEOUT_MS,
        "QUALITY_GATE_BACKEND_TIMEOUT_MS",
        DEFAULT_TIMEOUTS.backend,
      ),
    },
    {
      id: "frontend-quality",
      label: "frontend quality, CSP, E2E, visual, dan accessibility",
      cwd: frontendDirectory,
      script: "quality:release",
      runtime: "frontend",
      unsetEnv: ["NODE_ENV"],
      timeoutMs: parseDurationMs(
        env.QUALITY_GATE_FRONTEND_TIMEOUT_MS,
        "QUALITY_GATE_FRONTEND_TIMEOUT_MS",
        DEFAULT_TIMEOUTS.frontend,
      ),
    },
    {
      id: "fullstack",
      label: "workflow full-stack UI sampai PostgreSQL",
      cwd: backendDirectory,
      script: "test:fullstack",
      timeoutMs: parseDurationMs(
        env.QUALITY_GATE_FULLSTACK_TIMEOUT_MS,
        "QUALITY_GATE_FULLSTACK_TIMEOUT_MS",
        DEFAULT_TIMEOUTS.fullstack,
      ),
    },
    {
      id: "performance-smoke",
      label: "load smoke API lokal dan cleanup",
      cwd: backendDirectory,
      script: "test:load-smoke",
      timeoutMs: parseDurationMs(
        env.QUALITY_GATE_PERFORMANCE_TIMEOUT_MS,
        "QUALITY_GATE_PERFORMANCE_TIMEOUT_MS",
        DEFAULT_TIMEOUTS.performance,
      ),
    },
  ];
}

function collectSecretValues(env) {
  const secretKey =
    /(?:PASSWORD|SECRET|TOKEN|DATABASE_URL|ENCRYPTION_KEY|RESEND_API_KEY)/i;
  return [...new Set(
    Object.entries(env)
      .filter(([key, value]) => secretKey.test(key) && String(value || "").length >= 4)
      .map(([, value]) => String(value)),
  )].sort((left, right) => right.length - left.length);
}

function redactText(value, secretValues) {
  return secretValues.reduce(
    (text, secret) => text.split(secret).join("[REDACTED]"),
    String(value),
  );
}

function createLineWriter(write) {
  let pending = "";
  return {
    push(chunk) {
      pending += chunk.toString();
      const lines = pending.split(/(?<=\n)/);
      pending = lines.pop() || "";
      for (const line of lines) write(line);
    },
    flush() {
      if (pending) write(pending);
      pending = "";
    },
  };
}

function terminateProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;

  if (process.platform === "win32") {
    spawnSync(
      "taskkill",
      ["/pid", String(child.pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function runCommandStep({
  command,
  args,
  cwd,
  env,
  timeoutMs,
  heartbeatMs,
  logPath,
  gateLogPath,
  output = process.stdout,
  errorOutput = process.stderr,
  spawnImpl = spawn,
}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const secretValues = collectSecretValues(env);
    let timedOut = false;
    let interruptedBy = null;
    let settled = false;

    const write = (text, target = output) => {
      const redacted = redactText(text, secretValues);
      fs.appendFileSync(logPath, redacted);
      fs.appendFileSync(gateLogPath, redacted);
      target.write(redacted);
    };
    const stdoutWriter = createLineWriter((line) => write(line, output));
    const stderrWriter = createLineWriter((line) => write(line, errorOutput));

    let child;
    try {
      child = spawnImpl(command, args, {
        cwd,
        env,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      reject(error);
      return;
    }

    const timeout = setTimeout(() => {
      timedOut = true;
      write(
        `[quality:release] TIMEOUT setelah ${Math.round(timeoutMs / 1000)} detik. Menghentikan proses tahap.\n`,
        errorOutput,
      );
      terminateProcessTree(child);
    }, timeoutMs);
    timeout.unref();

    const heartbeat = setInterval(() => {
      write(
        `[quality:release] tahap masih berjalan (${Math.round((Date.now() - startedAt) / 1000)} detik)\n`,
      );
    }, heartbeatMs);
    heartbeat.unref();

    const handleSignal = (signal) => {
      interruptedBy = signal;
      write(
        `[quality:release] menerima ${signal}; menghentikan proses tahap.\n`,
        errorOutput,
      );
      terminateProcessTree(child);
    };
    const onSigint = () => handleSignal("SIGINT");
    const onSigterm = () => handleSignal("SIGTERM");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    const cleanup = () => {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      stdoutWriter.flush();
      stderrWriter.flush();
    };

    child.stdout?.on("data", (chunk) => stdoutWriter.push(chunk));
    child.stderr?.on("data", (chunk) => stderrWriter.push(chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        exitCode: code,
        signal,
        timedOut,
        interruptedBy,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function writeFileAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, value, "utf8");
  fs.rmSync(filePath, { force: true });
  fs.renameSync(temporaryPath, filePath);
}

function writeQualityReport(reportDirectory, report) {
  writeFileAtomic(
    path.join(reportDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const failures = report.stages.filter((stage) => stage.status === "failed");
  const testCases = report.stages
    .map((stage) => {
      const time = (stage.duration_ms / 1000).toFixed(3);
      const failure =
        stage.status === "failed"
          ? `<failure message="${escapeXml(stage.error || "Tahap gagal")}" />`
          : "";
      return `  <testcase classname="quality.release" name="${escapeXml(stage.label)}" time="${time}">${failure}</testcase>`;
    })
    .join("\n");
  const junit = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="Ruwang Arsip release quality gate" tests="${report.stages.length}" failures="${failures.length}" time="${(report.duration_ms / 1000).toFixed(3)}">`,
    testCases,
    "</testsuite>",
    "",
  ].join("\n");
  writeFileAtomic(path.join(reportDirectory, "junit.xml"), junit);
}

function prepareReportDirectory(env, backendDirectory) {
  const reportRoot = resolveReportDirectory(env, backendDirectory);
  const reportDirectory = path.join(reportRoot, "latest");
  if (path.dirname(reportDirectory) !== reportRoot) {
    throw new Error("Direktori laporan quality gate tidak aman.");
  }

  fs.mkdirSync(reportRoot, { recursive: true });
  fs.rmSync(reportDirectory, { recursive: true, force: true });
  fs.mkdirSync(reportDirectory, { recursive: true });
  return reportDirectory;
}

async function runReleaseQualityGate({
  env = process.env,
  backendDirectory = BACKEND_DIRECTORY,
  stepRunner = runCommandStep,
  output = process.stdout,
  errorOutput = process.stderr,
} = {}) {
  const resolvedBackendDirectory = fs.realpathSync(backendDirectory);
  const reportDirectory = prepareReportDirectory(env, resolvedBackendDirectory);
  const gateLogPath = path.join(reportDirectory, "gate.log");
  fs.writeFileSync(gateLogPath, "", "utf8");

  const startedAt = Date.now();
  const report = {
    schema_version: 1,
    run_id: crypto.randomUUID(),
    status: "running",
    started_at: new Date(startedAt).toISOString(),
    finished_at: null,
    duration_ms: 0,
    report_directory: reportDirectory,
    error: null,
    stages: [],
  };
  writeQualityReport(reportDirectory, report);

  const writeGateMessage = (message, target = output) => {
    fs.appendFileSync(gateLogPath, message);
    target.write(message);
  };

  try {
    const npmExecPath = String(env.npm_execpath || "").trim();
    if (!npmExecPath || !fs.existsSync(npmExecPath)) {
      throw new Error("Jalankan quality gate melalui npm run quality:release.");
    }

    const frontendDirectory = resolveFrontendDirectory(
      env,
      resolvedBackendDirectory,
    );
    const releaseEnv = createReleaseEnvironment(env, {
      backendDirectory: resolvedBackendDirectory,
      frontendDirectory,
    });
    const steps = buildReleaseSteps(
      resolvedBackendDirectory,
      frontendDirectory,
      env,
    );
    const heartbeatMs = parseDurationMs(
      env.QUALITY_GATE_HEARTBEAT_MS,
      "QUALITY_GATE_HEARTBEAT_MS",
      DEFAULT_TIMEOUTS.heartbeat,
      { minimum: 5000 },
    );

    for (const [index, step] of steps.entries()) {
      const stepEnv = { ...releaseEnv, ...step.env };
      for (const variableName of step.unsetEnv || []) {
        delete stepEnv[variableName];
      }
      if (step.runtime === "frontend") {
        stepEnv.PORT = releaseEnv.QUALITY_GATE_FRONTEND_PORT;
      }

      const logFile = `${String(index + 1).padStart(2, "0")}-${step.id}.log`;
      const logPath = path.join(reportDirectory, logFile);
      fs.writeFileSync(logPath, "", "utf8");
      writeGateMessage(
        `[quality:release] ${index + 1}/${steps.length} ${step.label} (timeout ${Math.round(step.timeoutMs / 1000)} detik)\n`,
      );

      const stageStartedAt = Date.now();
      const stageReport = {
        id: step.id,
        label: step.label,
        script: step.script,
        status: "running",
        started_at: new Date(stageStartedAt).toISOString(),
        finished_at: null,
        duration_ms: 0,
        timeout_ms: step.timeoutMs,
        exit_code: null,
        signal: null,
        timed_out: false,
        log_file: logFile,
        error: null,
      };
      report.stages.push(stageReport);
      report.duration_ms = Date.now() - startedAt;
      writeQualityReport(reportDirectory, report);

      let result;
      try {
        result = await stepRunner({
          command: process.execPath,
          args: [npmExecPath, "run", step.script],
          cwd: step.cwd,
          env: stepEnv,
          timeoutMs: step.timeoutMs,
          heartbeatMs,
          logPath,
          gateLogPath,
          output,
          errorOutput,
        });
      } catch (error) {
        result = {
          exitCode: null,
          signal: null,
          timedOut: false,
          durationMs: Date.now() - stageStartedAt,
          error,
        };
      }

      stageReport.finished_at = new Date().toISOString();
      stageReport.duration_ms = result.durationMs;
      stageReport.exit_code = result.exitCode ?? null;
      stageReport.signal = result.signal || result.interruptedBy || null;
      stageReport.timed_out = Boolean(result.timedOut);

      const succeeded =
        !result.error &&
        !result.timedOut &&
        !result.interruptedBy &&
        result.exitCode === 0;
      if (!succeeded) {
        const reason = result.error
          ? result.error.message
          : result.timedOut
            ? `melewati timeout ${step.timeoutMs} ms`
            : result.interruptedBy
              ? `dihentikan oleh ${result.interruptedBy}`
              : `exit code ${result.exitCode ?? "unknown"}`;
        stageReport.status = "failed";
        stageReport.error = reason;
        report.status = "failed";
        report.finished_at = new Date().toISOString();
        report.duration_ms = Date.now() - startedAt;
        writeQualityReport(reportDirectory, report);
        throw new Error(`${step.label} gagal: ${reason}.`);
      }

      stageReport.status = "passed";
      report.duration_ms = Date.now() - startedAt;
      writeQualityReport(reportDirectory, report);
      writeGateMessage(
        `[quality:release] ${step.label} LULUS (${Math.round(result.durationMs / 1000)} detik)\n`,
      );
    }

    report.status = "passed";
    report.finished_at = new Date().toISOString();
    report.duration_ms = Date.now() - startedAt;
    writeQualityReport(reportDirectory, report);
    writeGateMessage(
      `[quality:release] LULUS (${steps.length} tahap, ${Math.round(report.duration_ms / 1000)} detik)\n`,
    );
    writeGateMessage(`[quality:release] laporan: ${reportDirectory}\n`);
    return report;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    report.error = errorMessage;
    if (report.status === "running") {
      report.status = "failed";
      report.finished_at = new Date().toISOString();
      report.duration_ms = Date.now() - startedAt;
      if (report.stages.length === 0) {
        report.stages.push({
          id: "preflight",
          label: "quality gate preflight",
          script: "quality:release",
          status: "failed",
          started_at: report.started_at,
          finished_at: report.finished_at,
          duration_ms: report.duration_ms,
          timeout_ms: 0,
          exit_code: null,
          signal: null,
          timed_out: false,
          log_file: "gate.log",
          error: errorMessage,
        });
      }
    }
    writeQualityReport(reportDirectory, report);
    writeGateMessage(
      `[quality:release] GAGAL: ${errorMessage}\n`,
      errorOutput,
    );
    writeGateMessage(`[quality:release] laporan: ${reportDirectory}\n`, errorOutput);
    if (error && typeof error === "object") {
      error.qualityGateReported = true;
    }
    throw error;
  }
}

if (require.main === module) {
  const { loadEnv } = require("../src/config/env");
  loadEnv();
  runReleaseQualityGate().catch((error) => {
    if (!error?.qualityGateReported) {
      process.stderr.write(
        `[quality:release] GAGAL: ${error instanceof Error ? error.message : "Unknown error"}\n`,
      );
    }
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_TIMEOUTS,
  assertLoopbackUrl,
  buildReleaseSteps,
  collectSecretValues,
  createReleaseEnvironment,
  parseDurationMs,
  redactText,
  resolveBackendHealthUrl,
  resolveFrontendDirectory,
  resolveReportDirectory,
  resolveUrlPort,
  runCommandStep,
  runReleaseQualityGate,
  writeQualityReport,
};
