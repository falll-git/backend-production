const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REPOSITORY_DIRECTORY,
  RELEASE_LAYOUT_PATH,
  TOPOLOGY_PATH,
  assertPostDeployEnvironment,
  assertProductionReleaseEnvironment,
  assertReleaseUrl,
  buildMigrationStatusEnvironment,
  buildReleaseReport,
  evaluateLivenessPayload,
  evaluateReadinessPayload,
  inspectFrontendProductionBuild,
  parseEnvExampleKeys,
  parseProbeTimeout,
  readProbeResponse,
  resolveReleaseReportDirectory,
  runNamedChecks,
  runPostDeployVerification,
  validateRuntimeTopology,
  verifyReleaseContract,
  verifyStartupRecoveryContract,
} = require("./release-readiness");

test("status migration child hanya mewariskan pointer file-backed", () => {
  const childEnv = buildMigrationStatusEnvironment({
    DATABASE_URL: "resolved-runtime-value",
    DATABASE_URL_FILE: "/run/credentials/runtime/DATABASE_URL",
    MIGRATION_DATABASE_URL: "resolved-migration-value",
    MIGRATION_DATABASE_URL_FILE: "/run/credentials/migration/MIGRATION_DATABASE_URL",
    NODE_ENV: "production",
  });

  assert.equal(childEnv.DATABASE_URL, undefined);
  assert.equal(childEnv.MIGRATION_DATABASE_URL, undefined);
  assert.equal(
    childEnv.DATABASE_URL_FILE,
    "/run/credentials/runtime/DATABASE_URL",
  );
  assert.equal(
    childEnv.MIGRATION_DATABASE_URL_FILE,
    "/run/credentials/migration/MIGRATION_DATABASE_URL",
  );
  assert.equal(childEnv.NODE_ENV, "production");
});

function validReadinessPayload() {
  return {
    status: true,
    success: true,
    data: {
      ready: true,
      state: "ready",
      checks: {
        database: { status: "up", required: true },
        storage: { status: "up", required: true },
        rate_limit_store: { status: "up", required: true },
        redis: {
          status: "up",
          details: { reachable: true, workers_available: true },
        },
        application_cache: { status: "up" },
        watermark_worker: {
          status: "up",
          details: { workers_available: true },
        },
        observability: { status: "disabled" },
      },
    },
  };
}

function productionReleaseEnv(frontendDirectory) {
  return {
    NODE_ENV: "production",
    DEPLOY_RELEASE_ID: "release-test",
    DATABASE_URL: "postgresql://runtime:secret@database/ruwang_arsip",
    MIGRATION_DATABASE_URL:
      "postgresql://migration:secret@database/ruwang_arsip",
    RELEASE_FRONTEND_DIR: frontendDirectory,
    RELEASE_VERIFY_ALLOW_LOOPBACK: "true",
    RELEASE_VERIFY_TIMEOUT_MS: "1000",
    RELEASE_VERIFY_FRONTEND_URL: "http://127.0.0.1:3000/",
    RELEASE_VERIFY_API_HEALTH_URL: "http://127.0.0.1:7111/health",
    RELEASE_VERIFY_API_READY_URL: "http://127.0.0.1:7111/ready",
    SLIK_IMPORT_QUEUE_ENABLED: "true",
    SLIK_IMPORT_REQUIRE_WORKER: "true",
    APP_CACHE_ENABLED: "true",
    WATERMARK_PROCESSING_MODE: "worker",
    OTEL_ENABLED: "false",
  };
}

test("kontrak release aktual cocok dengan lima proses production dan aktivasi manual-atomic", () => {
  const result = verifyReleaseContract();
  assert.equal(result.process_count, 5);
  assert.equal(result.required_dependency_count, 3);
  assert.equal(result.automatic_deployment, false);
  assert.equal(result.deployment_strategy, "manual-atomic-symlink");
  assert.equal(result.backup_automation, false);
  assert.equal(result.recovery_role_count, 2);
  assert.equal(result.recovery_task_count, 2);
  assert.equal(result.data_backup_restore_status, "deferred");
  assert.equal(result.rpo_rto_status, "pending-decision");
});

test("kontrak release menolak layout yang menghapus persetujuan atau mencoba rollback database", () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "ruwang-release-layout-"),
  );
  try {
    const layout = JSON.parse(fs.readFileSync(RELEASE_LAYOUT_PATH, "utf8"));
    layout.approval_required = false;
    layout.rollback.database_migrations = "reverse";
    const layoutPath = path.join(temporaryDirectory, "release-layout.json");
    fs.writeFileSync(layoutPath, `${JSON.stringify(layout)}\n`, "utf8");
    assert.throws(
      () => verifyReleaseContract({ releaseLayoutPath: layoutPath }),
      /layout release manual-atomic tidak valid/,
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("kontrak recovery menolak task atau pemanggilan role worker yang salah", () => {
  const backendDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "ruwang-recovery-contract-"),
  );
  try {
    const workerDirectory = path.join(backendDirectory, "src", "workers");
    fs.mkdirSync(workerDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(workerDirectory, "slik-import.worker.js"),
      'runStartupTasks({ role: "slik-import-worker" });',
    );
    fs.writeFileSync(
      path.join(workerDirectory, "watermark.worker.js"),
      'runStartupTasks({ role: "watermark-worker" });',
    );
    const validTasks = (role) => [
      {
        name:
          role === "slik-import-worker"
            ? "debtor-import-job-recovery"
            : "watermark-job-recovery",
      },
    ];
    assert.deepEqual(
      verifyStartupRecoveryContract({ backendDirectory, getStartupTasks: validTasks }),
      { recovery_role_count: 2, recovery_task_count: 2 },
    );
    assert.throws(
      () =>
        verifyStartupRecoveryContract({
          backendDirectory,
          getStartupTasks: () => [{ name: "task-yang-salah" }],
        }),
      /tidak sesuai kontrak/,
    );

    fs.writeFileSync(
      path.join(workerDirectory, "watermark.worker.js"),
      'runStartupTasks({ role: "slik-import-worker" });',
    );
    assert.throws(
      () =>
        verifyStartupRecoveryContract({
          backendDirectory,
          getStartupTasks: validTasks,
        }),
      /tidak menjalankan recovery startup/,
    );
  } finally {
    fs.rmSync(backendDirectory, { recursive: true, force: true });
  }
});

test("topologi menolak auto-deploy, backup otomatis, dan runtime development", () => {
  const topology = JSON.parse(fs.readFileSync(TOPOLOGY_PATH, "utf8"));
  const backendPackage = JSON.parse(
    fs.readFileSync(path.join(REPOSITORY_DIRECTORY, "package.json"), "utf8"),
  );
  const frontendDirectory = path.resolve(
    REPOSITORY_DIRECTORY,
    "..",
    "frontend-production",
  );
  const frontendPackage = JSON.parse(
    fs.readFileSync(path.join(frontendDirectory, "package.json"), "utf8"),
  );
  const envExampleKeys = parseEnvExampleKeys(
    fs.readFileSync(path.join(REPOSITORY_DIRECTORY, ".env.example"), "utf8"),
  );
  const changed = structuredClone(topology);
  const changedBackend = structuredClone(backendPackage);
  changed.orchestration.automatic_deployment = true;
  changed.orchestration.implementation = "vps-choice-pending";
  changed.orchestration.deployment_strategy = "git-pull-in-place";
  changed.orchestration.approval_required = false;
  changed.recovery.backup_automation = true;
  changed.operations.data_backup_restore_status = "enabled";
  changed.operations.rpo_rto_status = "assumed";
  const changedFrontend = structuredClone(frontendPackage);
  changedFrontend.scripts.start = "next dev";
  changedBackend.engines.node = "22.x";

  const result = validateRuntimeTopology({
    topology: changed,
    backendPackage: changedBackend,
    frontendPackage: changedFrontend,
    envExampleKeys,
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /automatic deployment/i);
  assert.match(result.errors.join(" "), /PM2 dengan aktivasi manual-atomic/i);
  assert.match(result.errors.join(" "), /symlink manual-atomic/i);
  assert.match(result.errors.join(" "), /Backup automation/i);
  assert.match(result.errors.join(" "), /Backup dan restore data/i);
  assert.match(result.errors.join(" "), /RPO dan RTO/i);
  assert.match(result.errors.join(" "), /runtime development/i);
  assert.match(result.errors.join(" "), /Engine Node.js backend wajib \^22\.12 \|\| 24\.x/i);
});

test("topologi menolak range engine Node.js yang tidak valid", () => {
  const topology = JSON.parse(fs.readFileSync(TOPOLOGY_PATH, "utf8"));
  const backendPackage = JSON.parse(
    fs.readFileSync(path.join(REPOSITORY_DIRECTORY, "package.json"), "utf8"),
  );
  const frontendPackage = JSON.parse(
    fs.readFileSync(
      path.resolve(REPOSITORY_DIRECTORY, "..", "frontend-production", "package.json"),
      "utf8",
    ),
  );
  const changed = structuredClone(topology);
  changed.node.supported_engine_range = "^22.12 || (a+)+";

  const result = validateRuntimeTopology({
    topology: changed,
    backendPackage,
    frontendPackage,
    envExampleKeys: parseEnvExampleKeys(
      fs.readFileSync(path.join(REPOSITORY_DIRECTORY, ".env.example"), "utf8"),
    ),
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /Range engine Node\.js topologi tidak valid/i);
});

test("seluruh environment topologi wajib terdokumentasi", () => {
  const topology = JSON.parse(fs.readFileSync(TOPOLOGY_PATH, "utf8"));
  const backendPackage = JSON.parse(
    fs.readFileSync(path.join(REPOSITORY_DIRECTORY, "package.json"), "utf8"),
  );
  const frontendPackage = JSON.parse(
    fs.readFileSync(
      path.resolve(REPOSITORY_DIRECTORY, "..", "frontend-production", "package.json"),
      "utf8",
    ),
  );
  const result = validateRuntimeTopology({
    topology,
    backendPackage,
    frontendPackage,
    envExampleKeys: new Set(),
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /.env.example belum mendokumentasikan/);
});

test("urutan release mewajibkan npm ci dari lockfile pada kedua repository", () => {
  const topology = JSON.parse(fs.readFileSync(TOPOLOGY_PATH, "utf8"));
  const backendPackage = JSON.parse(
    fs.readFileSync(path.join(REPOSITORY_DIRECTORY, "package.json"), "utf8"),
  );
  const frontendPackage = JSON.parse(
    fs.readFileSync(
      path.resolve(REPOSITORY_DIRECTORY, "..", "frontend-production", "package.json"),
      "utf8",
    ),
  );
  const envExampleKeys = parseEnvExampleKeys(
    fs.readFileSync(path.join(REPOSITORY_DIRECTORY, ".env.example"), "utf8"),
  );
  const changed = structuredClone(topology);
  changed.release_sequence[0].command = "npm install";

  const result = validateRuntimeTopology({
    topology: changed,
    backendPackage,
    frontendPackage,
    envExampleKeys,
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /backend-dependencies/);
});

test("target release wajib HTTPS kecuali loopback diizinkan eksplisit", () => {
  assert.equal(
    assertReleaseUrl(
      "https://ruwangarsip.com/health",
      "health",
      "/health",
    ).pathname,
    "/health",
  );
  assert.throws(
    () => assertReleaseUrl("http://ruwangarsip.com/health", "health", "/health"),
    /HTTPS/,
  );
  assert.throws(
    () => assertReleaseUrl("https://user:secret@ruwangarsip.com/health", "health", "/health"),
    /credential/,
  );
  assert.throws(
    () => assertReleaseUrl("https://ruwangarsip.com/ready", "health", "/health"),
    /path \/health/,
  );
  assert.equal(
    assertReleaseUrl(
      "http://127.0.0.1:7111/ready",
      "ready",
      "/ready",
      { allowLoopback: true },
    ).hostname,
    "127.0.0.1",
  );
});

test("production release memerlukan migration credential dan frontend absolut terpisah", () => {
  const frontendDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "ruwang-release-front-"),
  );
  try {
    const env = productionReleaseEnv(frontendDirectory);
    assert.equal(
      assertProductionReleaseEnvironment(env),
      path.resolve(frontendDirectory),
    );
    assert.throws(
      () =>
        assertProductionReleaseEnvironment({
          ...env,
          MIGRATION_DATABASE_URL: env.DATABASE_URL,
        }),
      /terpisah/,
    );
    assert.throws(
      () =>
        assertProductionReleaseEnvironment({
          ...env,
          RELEASE_FRONTEND_DIR: "frontend-relative",
        }),
      /absolute path/,
    );
    assert.throws(
      () =>
        assertProductionReleaseEnvironment({
          ...env,
          MIGRATION_DATABASE_URL:
            "postgresql://GANTI_OWNER:GANTI_PASSWORD@database/ruwang_arsip",
        }),
      /wajib diisi/,
    );
    assert.throws(
      () =>
        assertProductionReleaseEnvironment({
          ...env,
          DEPLOY_RELEASE_ID: "../release",
        }),
      /format release ID yang aman/,
    );
    assert.throws(
      () =>
        assertProductionReleaseEnvironment({
          ...env,
          MIGRATION_DATABASE_URL: "https://migration:secret@database/app",
        }),
      /PostgreSQL lengkap/,
    );
  } finally {
    fs.rmSync(frontendDirectory, { recursive: true, force: true });
  }
});

test("verifier pascadeploy hanya memerlukan target runtime, bukan source atau akses migrasi", () => {
  const env = productionReleaseEnv("unused");
  delete env.RELEASE_FRONTEND_DIR;
  delete env.MIGRATION_DATABASE_URL;
  assert.doesNotThrow(() => assertPostDeployEnvironment(env));
  assert.throws(
    () =>
      assertPostDeployEnvironment({
        ...env,
        RELEASE_VERIFY_API_READY_URL: "",
      }),
    /Target verifikasi release belum lengkap/,
  );
});

test("build frontend production diverifikasi dari artefak Next yang nyata", () => {
  const frontendDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "ruwang-release-build-"),
  );
  try {
    fs.mkdirSync(path.join(frontendDirectory, ".next"));
    fs.writeFileSync(
      path.join(frontendDirectory, "package.json"),
      JSON.stringify({ scripts: { start: "next start" } }),
    );
    fs.writeFileSync(path.join(frontendDirectory, ".next", "BUILD_ID"), "build_1234\n");
    fs.writeFileSync(
      path.join(frontendDirectory, ".next", "required-server-files.json"),
      JSON.stringify({ version: 1, config: {}, files: [] }),
    );
    fs.writeFileSync(
      path.join(frontendDirectory, ".next", "routes-manifest.json"),
      JSON.stringify({
        version: 3,
        staticRoutes: [],
        dynamicRoutes: [],
        dataRoutes: [],
      }),
    );
    assert.equal(
      inspectFrontendProductionBuild(frontendDirectory).build_artifacts,
      3,
    );
    fs.rmSync(path.join(frontendDirectory, ".next", "BUILD_ID"));
    assert.throws(
      () => inspectFrontendProductionBuild(frontendDirectory),
      /ENOENT/,
    );
    fs.writeFileSync(path.join(frontendDirectory, ".next", "BUILD_ID"), "build_1234\n");
    fs.writeFileSync(
      path.join(frontendDirectory, ".next", "routes-manifest.json"),
      "bukan-json",
    );
    assert.throws(
      () => inspectFrontendProductionBuild(frontendDirectory),
      /bukan JSON valid/,
    );
  } finally {
    fs.rmSync(frontendDirectory, { recursive: true, force: true });
  }
});

test("readiness production mewajibkan dependency dan kedua worker", () => {
  const env = productionReleaseEnv(path.resolve(os.tmpdir(), "frontend"));
  assert.equal(evaluateReadinessPayload(validReadinessPayload(), env).passed, true);

  const missingWorker = validReadinessPayload();
  missingWorker.data.state = "degraded";
  missingWorker.data.checks.redis.status = "degraded";
  missingWorker.data.checks.redis.details.workers_available = false;
  const result = evaluateReadinessPayload(missingWorker, env);
  assert.equal(result.passed, false);
  assert.ok(result.violations.includes("slik_import_worker"));
  assert.ok(result.violations.includes("redis_queue"));
});

test("payload liveness wajib memiliki status alive dan versi", () => {
  assert.equal(
    evaluateLivenessPayload({
      status: true,
      success: true,
      data: { state: "alive", version: "v1" },
    }).passed,
    true,
  );
  assert.equal(
    evaluateLivenessPayload({
      status: true,
      success: true,
      data: { state: "alive" },
    }).passed,
    false,
  );
});

test("post-deploy verifier memeriksa API, worker, dan frontend tanpa menulis data", async () => {
  const frontendDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "ruwang-release-probe-"),
  );
  try {
    const env = productionReleaseEnv(frontendDirectory);
    const requested = [];
    const report = await runPostDeployVerification({
      env,
      async fetchImpl(url, options) {
        requested.push({ method: options.method, path: url.pathname });
        if (url.pathname === "/health") {
          return new Response(
            JSON.stringify({
              status: true,
              success: true,
              data: { state: "alive", version: "v1" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.pathname === "/ready") {
          return new Response(JSON.stringify(validReadinessPayload()), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("<!doctype html><html></html>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
    });
    assert.equal(report.status, "passed");
    assert.deepEqual(requested, [
      { method: "GET", path: "/health" },
      { method: "GET", path: "/ready" },
      { method: "GET", path: "/" },
    ]);
    assert.equal(JSON.stringify(report).includes("postgresql://"), false);
  } finally {
    fs.rmSync(frontendDirectory, { recursive: true, force: true });
  }
});

test("frontend probe menolak body kosong dan body aktual yang terlalu besar", async () => {
  const target = new URL("https://arsip.example.test/");
  await assert.rejects(
    readProbeResponse(target, {
      fetchImpl: async () =>
        new Response("", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    }),
    /dokumen HTML valid/,
  );
  let pulls = 0;
  let cancelled = false;
  await assert.rejects(
    readProbeResponse(target, {
      fetchImpl: async () =>
        new Response(new ReadableStream(
          {
            pull(controller) {
              pulls += 1;
              controller.enqueue(new Uint8Array(600 * 1024));
              if (pulls >= 3) controller.close();
            },
            cancel() {
              cancelled = true;
            },
          },
          { highWaterMark: 0 },
        ), {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    }),
    /batas ukuran/,
  );
  assert.equal(cancelled, true);
  assert.equal(pulls, 2);
});

test("post-deploy verifier menolak liveness dan readiness API beda origin", async () => {
  const frontendDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "ruwang-release-origin-"),
  );
  try {
    const env = productionReleaseEnv(frontendDirectory);
    env.RELEASE_VERIFY_API_READY_URL = "http://127.0.0.1:7112/ready";
    let requested = false;
    const report = await runPostDeployVerification({
      env,
      fetchImpl: async () => {
        requested = true;
        throw new Error("tidak boleh dipanggil");
      },
    });
    assert.equal(report.status, "failed");
    assert.equal(requested, false);
    assert.equal(
      report.checks.some(
        (check) => check.id === "release_targets" && check.status === "failed",
      ),
      true,
    );
  } finally {
    fs.rmSync(frontendDirectory, { recursive: true, force: true });
  }
});

test("hasil check dan report tidak menyimpan pesan error atau secret", async () => {
  const checks = await runNamedChecks([
    {
      id: "safe_failure",
      run: async () => {
        throw new Error("password=rahasia database_url=postgresql://secret");
      },
    },
  ]);
  const report = buildReleaseReport("preflight", new Date(), checks);
  assert.equal(report.status, "failed");
  assert.equal(JSON.stringify(report).includes("rahasia"), false);
  assert.equal(JSON.stringify(report).includes("postgresql://"), false);
});

test("direktori report, timeout, dan path repository dibatasi", () => {
  assert.match(
    resolveReleaseReportDirectory("release-reports"),
    /release-reports[\\/]latest$/,
  );
  assert.throws(() => resolveReleaseReportDirectory("."), /tidak aman/);
  assert.equal(parseProbeTimeout("5000"), 5000);
  assert.throws(() => parseProbeTimeout("100"), /500 dan 60000/);
});
