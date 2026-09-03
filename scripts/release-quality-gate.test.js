const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
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
} = require("./release-quality-gate");

function createFrontendRepository(root, scripts = {}) {
  const directory = path.join(root, "frontend-production");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "ruang-arsip",
      scripts: {
        "quality:release": "echo quality",
        "test:e2e:server": "echo server",
        ...scripts,
      },
    }),
  );
  return directory;
}

function createGateFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ruwang-quality-"));
  const backendDirectory = path.join(root, "backend-production");
  fs.mkdirSync(backendDirectory);
  const frontendDirectory = createFrontendRepository(root);
  const npmExecPath = path.join(root, "npm-cli.js");
  fs.writeFileSync(npmExecPath, "// test npm cli");
  return {
    root,
    backendDirectory,
    frontendDirectory,
    npmExecPath,
    reportRoot: path.join(root, "quality-reports"),
  };
}

test("target browser quality gate wajib loopback dan tanpa credential", () => {
  assert.equal(assertLoopbackUrl("http://localhost:3000", "URL").port, "3000");
  assert.equal(
    assertLoopbackUrl("http://127.0.0.1:7111/health", "URL").pathname,
    "/health",
  );
  assert.throws(
    () => assertLoopbackUrl("https://ruwangarsip.com", "URL"),
    /loopback/,
  );
  assert.throws(
    () => assertLoopbackUrl("http://admin:secret@localhost:3000", "URL"),
    /credential/,
  );
  assert.equal(
    resolveUrlPort(assertLoopbackUrl("http://localhost:3000", "URL")),
    3000,
  );
});

test("frontend repository divalidasi dari package dan script wajib", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ruwang-quality-"));
  try {
    const backendDirectory = path.join(root, "backend-production");
    fs.mkdirSync(backendDirectory);
    const frontendDirectory = createFrontendRepository(root);

    assert.equal(
      resolveFrontendDirectory({}, backendDirectory),
      fs.realpathSync(frontendDirectory),
    );

    fs.writeFileSync(
      path.join(frontendDirectory, "package.json"),
      JSON.stringify({ name: "aplikasi-lain", scripts: {} }),
    );
    assert.throws(
      () => resolveFrontendDirectory({}, backendDirectory),
      /tidak menunjuk repository frontend/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("environment release memakai credential admin dan satu build frontend", () => {
  const sourceEnv = {
    PORT: "7111",
    API_TEST_ADMIN_USERNAME: "admin-test",
    API_TEST_ADMIN_PASSWORD: "password-test",
  };
  const result = createReleaseEnvironment(sourceEnv, {
    backendDirectory: "C:\\backend-production",
    frontendDirectory: "C:\\frontend-production",
  });

  assert.equal(result.E2E_USERNAME, "admin-test");
  assert.equal(result.API_TEST_ADMIN_USERNAME, "admin-test");
  assert.equal(result.NEXT_PUBLIC_API_URL, "http://localhost:7111/api/v1");
  assert.equal(result.RUWANG_API_HOSTNAME, "localhost");
  assert.equal(result.RUWANG_ALLOW_LOOPBACK_API, "true");
  assert.equal(result.FULLSTACK_FRONTEND_URL, "http://localhost:3000");
  assert.equal(result.QUALITY_GATE_FRONTEND_PORT, "3000");
  assert.equal(result.E2E_REUSE_FRONTEND_BUILD, "true");
  assert.equal(result.FULLSTACK_REUSE_FRONTEND_BUILD, "true");
  assert.equal(sourceEnv.E2E_USERNAME, undefined);
  assert.throws(
    () =>
      createReleaseEnvironment(
        { ...sourceEnv, FULLSTACK_FRONTEND_URL: "https://example.com" },
        {
          backendDirectory: "C:\\backend-production",
          frontendDirectory: "C:\\frontend-production",
        },
      ),
    /loopback/,
  );
});

test("health URL harus memakai port backend yang sama", () => {
  assert.equal(
    resolveBackendHealthUrl({ PORT: "7111" }).href,
    "http://127.0.0.1:7111/health",
  );
  assert.throws(
    () =>
      resolveBackendHealthUrl({
        PORT: "7111",
        FULLSTACK_BACKEND_HEALTH_URL: "http://127.0.0.1:7000/health",
      }),
    /port yang sama/,
  );
});

test("timeout dan direktori laporan divalidasi ketat", () => {
  const backendDirectory = path.resolve("backend");
  assert.equal(parseDurationMs(undefined, "TIMEOUT", 1234), 1234);
  assert.equal(parseDurationMs("5000", "TIMEOUT", 1234), 5000);
  assert.throws(() => parseDurationMs("999", "TIMEOUT", 1234), /1000/);
  assert.throws(() => parseDurationMs("abc", "TIMEOUT", 1234), /bilangan/);
  assert.throws(
    () =>
      resolveReportDirectory(
        { QUALITY_GATE_REPORT_DIR: "." },
        backendDirectory,
      ),
    /tidak aman/,
  );
  assert.equal(
    resolveReportDirectory({}, backendDirectory),
    path.resolve(backendDirectory, "quality-reports"),
  );
});

test("nilai secret disaring dari log quality gate", () => {
  const env = {
    API_TEST_ADMIN_PASSWORD: "password-super-rahasia",
    DATABASE_URL: "postgresql://user:secret@localhost/db",
    RESEND_API_KEY: "resend-api-key-rahasia",
    RESEND_FROM_NAME: "Ruwang Arsip",
    NORMAL_VALUE: "boleh-terlihat",
  };
  const secretValues = collectSecretValues(env);
  const redacted = redactText(
    `login password-super-rahasia ${env.DATABASE_URL} ${env.RESEND_API_KEY} ${env.RESEND_FROM_NAME} boleh-terlihat`,
    secretValues,
  );
  assert.equal(redacted.includes("password-super-rahasia"), false);
  assert.equal(redacted.includes("postgresql://"), false);
  assert.equal(redacted.includes("resend-api-key-rahasia"), false);
  assert.match(redacted, /Ruwang Arsip/);
  assert.match(redacted, /boleh-terlihat/);
});

test("runner menghentikan proses yang melewati timeout", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ruwang-timeout-"));
  try {
    const logPath = path.join(root, "stage.log");
    const gateLogPath = path.join(root, "gate.log");
    fs.writeFileSync(logPath, "");
    fs.writeFileSync(gateLogPath, "");
    const sink = { write() {} };
    const result = await runCommandStep({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: root,
      env: { ...process.env },
      timeoutMs: 150,
      heartbeatMs: 5000,
      logPath,
      gateLogPath,
      output: sink,
      errorOutput: sink,
    });

    assert.equal(result.timedOut, true);
    assert.notEqual(result.exitCode, 0);
    assert.match(fs.readFileSync(logPath, "utf8"), /TIMEOUT/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("quality gate fail-fast dan menyimpan JSON, JUnit, serta log", async () => {
  const fixture = createGateFixture();
  const calls = [];
  try {
    const output = { write() {} };
    await assert.rejects(
      runReleaseQualityGate({
        backendDirectory: fixture.backendDirectory,
        env: {
          npm_execpath: fixture.npmExecPath,
          PORT: "7111",
          API_TEST_ADMIN_USERNAME: "admin-test",
          API_TEST_ADMIN_PASSWORD: "password-test",
          QUALITY_GATE_REPORT_DIR: fixture.reportRoot,
        },
        output,
        errorOutput: output,
        async stepRunner(options) {
          calls.push(options);
          fs.appendFileSync(options.logPath, "fake stage output\n");
          return {
            exitCode: calls.length === 2 ? 1 : 0,
            signal: null,
            timedOut: false,
            durationMs: 25,
          };
        },
      }),
      /frontend quality/,
    );

    assert.equal(calls.length, 2);
    assert.equal(calls[1].env.NODE_ENV, undefined);
    assert.equal(calls[1].env.PORT, "3000");
    const latest = path.join(fixture.reportRoot, "latest");
    const report = JSON.parse(
      fs.readFileSync(path.join(latest, "report.json"), "utf8"),
    );
    assert.equal(report.status, "failed");
    assert.equal(report.stages.length, 2);
    assert.equal(report.stages[0].status, "passed");
    assert.equal(report.stages[1].status, "failed");
    assert.match(fs.readFileSync(path.join(latest, "junit.xml"), "utf8"), /<failure/);
    assert.ok(fs.existsSync(path.join(latest, "gate.log")));
    assert.ok(fs.existsSync(path.join(latest, "01-backend-quality.log")));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("kegagalan preflight juga menghasilkan laporan permanen", async () => {
  const fixture = createGateFixture();
  try {
    const output = { write() {} };
    await assert.rejects(
      runReleaseQualityGate({
        backendDirectory: fixture.backendDirectory,
        env: {
          npm_execpath: fixture.npmExecPath,
          PORT: "7111",
          QUALITY_GATE_REPORT_DIR: fixture.reportRoot,
        },
        output,
        errorOutput: output,
      }),
      /credential admin/,
    );

    const latest = path.join(fixture.reportRoot, "latest");
    const report = JSON.parse(
      fs.readFileSync(path.join(latest, "report.json"), "utf8"),
    );
    assert.equal(report.status, "failed");
    assert.match(report.error, /credential admin/);
    assert.equal(report.stages.length, 1);
    assert.equal(report.stages[0].id, "preflight");
    assert.match(
      fs.readFileSync(path.join(latest, "junit.xml"), "utf8"),
      /<failure/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("quality gate sukses mencatat empat tahap secara berurutan", async () => {
  const fixture = createGateFixture();
  const calls = [];
  try {
    const output = { write() {} };
    const report = await runReleaseQualityGate({
      backendDirectory: fixture.backendDirectory,
      env: {
        npm_execpath: fixture.npmExecPath,
        PORT: "7111",
        API_TEST_ADMIN_USERNAME: "admin-test",
        API_TEST_ADMIN_PASSWORD: "password-test",
        QUALITY_GATE_REPORT_DIR: fixture.reportRoot,
      },
      output,
      errorOutput: output,
      async stepRunner(options) {
        calls.push(options);
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          durationMs: 10,
        };
      },
    });

    assert.deepEqual(
      calls.map((call) => call.args.at(-1)),
      ["quality", "quality:release", "test:fullstack", "test:load-smoke"],
    );
    assert.equal(report.status, "passed");
    assert.equal(report.stages.length, 4);
    assert.ok(report.stages.every((stage) => stage.status === "passed"));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("manifest release mencakup seluruh gate dengan batas waktu", () => {
  const steps = buildReleaseSteps("C:\\backend", "C:\\frontend", {});
  assert.equal(DEFAULT_TIMEOUTS.frontend, 45 * 60 * 1000);
  assert.equal(DEFAULT_TIMEOUTS.fullstack, 20 * 60 * 1000);
  assert.deepEqual(
    steps.map((step) => step.script),
    ["quality", "quality:release", "test:fullstack", "test:load-smoke"],
  );
  assert.match(steps[1].label, /CSP, E2E, visual, dan accessibility/);
  assert.deepEqual(steps[1].unsetEnv, ["NODE_ENV"]);
  assert.deepEqual(
    steps.map((step) => step.timeoutMs),
    [
      DEFAULT_TIMEOUTS.backend,
      DEFAULT_TIMEOUTS.frontend,
      DEFAULT_TIMEOUTS.fullstack,
      DEFAULT_TIMEOUTS.performance,
    ],
  );
});
