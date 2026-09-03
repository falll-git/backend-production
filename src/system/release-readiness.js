const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPOSITORY_DIRECTORY = path.resolve(__dirname, "..", "..");
const TOPOLOGY_PATH = path.join(
  REPOSITORY_DIRECTORY,
  "ops",
  "deployment",
  "runtime-topology.json",
);
const RELEASE_LAYOUT_PATH = path.join(
  REPOSITORY_DIRECTORY,
  "ops",
  "deployment",
  "release-layout.json",
);
const EXPECTED_PROCESS_CONTRACT = Object.freeze({
  frontend: {
    repository: "frontend",
    packageScript: "start",
    runtimeRole: null,
    command: "next start",
  },
  api: {
    repository: "backend",
    packageScript: "start",
    runtimeRole: "api",
    command: "node src/server.js",
  },
  "slik-import-worker": {
    repository: "backend",
    packageScript: "worker:slik-import",
    runtimeRole: "slik-import-worker",
    command: "node src/workers/slik-import.worker.js",
  },
  "watermark-worker": {
    repository: "backend",
    packageScript: "worker:watermark",
    runtimeRole: "watermark-worker",
    command: "node src/workers/watermark.worker.js",
  },
  "seputar-jaminan-worker": {
    repository: "backend",
    packageScript: "worker:seputar-jaminan",
    runtimeRole: "seputar-jaminan-worker",
    command: "node src/workers/seputar-jaminan.worker.js",
  },
});
const EXPECTED_STARTUP_RECOVERY_CONTRACT = Object.freeze({
  "slik-import-worker": Object.freeze({
    taskName: "debtor-import-job-recovery",
    entrypoint: "src/workers/slik-import.worker.js",
  }),
  "watermark-worker": Object.freeze({
    taskName: "watermark-job-recovery",
    entrypoint: "src/workers/watermark.worker.js",
  }),
});
const REQUIRED_DEPENDENCIES = Object.freeze([
  "persistent-storage",
  "postgresql",
  "redis",
]);
const REQUIRED_PREFLIGHT_ENV = Object.freeze([
  "DEPLOY_RELEASE_ID",
  "RELEASE_FRONTEND_DIR",
]);
const REQUIRED_VERIFY_ENV = Object.freeze([
  "RELEASE_VERIFY_API_HEALTH_URL",
  "RELEASE_VERIFY_API_READY_URL",
  "RELEASE_VERIFY_FRONTEND_URL",
]);
const REQUIRED_RELEASE_ENV = Object.freeze([
  ...REQUIRED_PREFLIGHT_ENV,
  ...REQUIRED_VERIFY_ENV,
]);
const EXPECTED_RELEASE_SEQUENCE = Object.freeze([
  ["backend-dependencies", "backend", null, "npm ci"],
  ["frontend-dependencies", "frontend", null, "npm ci"],
  ["release-contract", "backend", "release:contract", null],
  ["frontend-build", "frontend", "build", null],
  ["database-migration", "backend", "migrate:deploy", null],
  ["production-preflight", "backend", "release:preflight", null],
  ["release-manifest", "backend", "release:atomic:manifest", null],
  ["atomic-preflight", "backend", "release:atomic:preflight", null],
  ["atomic-symlink-switch", "backend", "release:atomic:switch", null],
  ["process-start-or-restart", "vps", null, null],
  ["pm2-process-verification", "backend", "release:pm2:verify", null],
  ["post-deploy-verification", "backend", "release:verify", null],
]);
const MAX_PROBE_BODY_BYTES = 1024 * 1024;
const NODE_ENGINE_RANGE_ALLOWED_CHARS = new Set(
  "^0123456789.xX>=< ".split(""),
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isEnabled(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase(),
  );
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized.startsWith("127.")
  );
}

function parseEnvExampleKeys(source) {
  const keys = new Set();
  for (const line of String(source || "").split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (match) keys.add(match[1]);
  }
  return keys;
}

function isValidNodeEngineSegment(segment) {
  const value = String(segment || "").trim();
  if (!value || value.length > 32) return false;
  let hasDigit = false;
  for (const char of value) {
    if (!NODE_ENGINE_RANGE_ALLOWED_CHARS.has(char)) return false;
    if (char >= "0" && char <= "9") hasDigit = true;
  }
  return hasDigit && !value.includes("..");
}

function isValidNodeEngineRange(value) {
  const configured = String(value || "").trim();
  if (!configured || configured.length > 128) return false;
  const segments = configured.split("||").map((segment) => segment.trim());
  return segments.every(isValidNodeEngineSegment);
}

function resolveExpectedNodeEngine(topology) {
  const configured = String(topology.node?.supported_engine_range || "").trim();
  if (configured) {
    if (!isValidNodeEngineRange(configured)) {
      return {
        valid: false,
        value: null,
        error: "Range engine Node.js topologi tidak valid.",
      };
    }
    return { valid: true, value: configured, error: null };
  }
  return {
    valid: true,
    value: topology.node.supported_major_versions
      .map((major) => `${major}.x`)
      .join(" || "),
    error: null,
  };
}

function validateRuntimeTopology({
  topology,
  backendPackage,
  frontendPackage,
  envExampleKeys,
} = {}) {
  const errors = [];
  if (!topology || typeof topology !== "object") {
    return { valid: false, errors: ["Topologi runtime wajib berupa object."] };
  }
  if (topology.schema_version !== 1) {
    errors.push("schema_version topologi runtime wajib 1.");
  }

  const supportedNodeMajors = topology.node?.supported_major_versions;
  if (
    !Array.isArray(supportedNodeMajors) ||
    supportedNodeMajors.length === 0 ||
    !supportedNodeMajors.every(
      (major) => Number.isInteger(major) && major >= 20 && major <= 30,
    )
  ) {
    errors.push("Versi mayor Node.js yang didukung wajib dinyatakan eksplisit.");
  } else {
    const expectedNodeEngine = resolveExpectedNodeEngine(topology);
    if (!expectedNodeEngine.valid) {
      errors.push(expectedNodeEngine.error);
    }
    for (const [repository, packageJson] of [
      ["backend", backendPackage],
      ["frontend", frontendPackage],
    ]) {
      if (
        expectedNodeEngine.valid &&
        String(packageJson?.engines?.node || "").trim() !== expectedNodeEngine.value
      ) {
        errors.push(
          `Engine Node.js ${repository} wajib ${expectedNodeEngine.value} sesuai topologi runtime.`,
        );
      }
    }
  }
  if (topology.orchestration?.automatic_deployment !== false) {
    errors.push("Topologi wajib menonaktifkan automatic deployment.");
  }
  if (topology.orchestration?.implementation !== "pm2-manual-atomic") {
    errors.push("Process manager wajib PM2 dengan aktivasi manual-atomic.");
  }
  if (
    topology.orchestration?.deployment_strategy !== "manual-atomic-symlink" ||
    topology.orchestration?.approval_required !== true
  ) {
    errors.push("Deployment wajib memakai symlink manual-atomic setelah persetujuan.");
  }
  if (topology.recovery?.backup_automation !== false) {
    errors.push("Backup automation harus tetap di luar STEP 10.");
  }
  if (topology.recovery?.startup_job_recovery_required !== true) {
    errors.push("Recovery job saat startup wajib dinyatakan.");
  }
  if (topology.operations?.data_backup_restore_status !== "deferred") {
    errors.push("Backup dan restore data harus tetap ditandai ditunda.");
  }
  if (topology.operations?.rpo_rto_status !== "pending-decision") {
    errors.push("RPO dan RTO harus tetap ditandai menunggu keputusan.");
  }
  if (
    typeof backendPackage?.scripts?.quality !== "string" ||
    !backendPackage.scripts.quality.includes("npm run release:contract")
  ) {
    errors.push("Release contract wajib menjadi bagian backend quality gate.");
  }

  const processes = Array.isArray(topology.processes)
    ? topology.processes
    : [];
  const seenProcessIds = new Set();
  for (const processConfig of processes) {
    if (!processConfig || typeof processConfig !== "object") {
      errors.push("Setiap proses runtime wajib berupa object.");
      continue;
    }
    const processId = String(processConfig.id || "");
    if (!processId || seenProcessIds.has(processId)) {
      errors.push("ID proses runtime wajib unik dan tidak kosong.");
      continue;
    }
    seenProcessIds.add(processId);
    const expected = EXPECTED_PROCESS_CONTRACT[processId];
    if (!expected) {
      errors.push(`Proses runtime tidak dikenal: ${processId}.`);
      continue;
    }
    if (
      processConfig.repository !== expected.repository ||
      processConfig.package_script !== expected.packageScript ||
      processConfig.runtime_role !== expected.runtimeRole
    ) {
      errors.push(`Kontrak proses ${processId} tidak sesuai runtime aplikasi.`);
    }
    if (
      processConfig.required !== true ||
      !Number.isInteger(processConfig.minimum_instances) ||
      processConfig.minimum_instances < 1
    ) {
      errors.push(`Proses ${processId} wajib memiliki minimal satu instance.`);
    }

    const packageJson =
      processConfig.repository === "frontend"
        ? frontendPackage
        : backendPackage;
    const command = packageJson?.scripts?.[processConfig.package_script];
    if (!command) {
      errors.push(
        `Script ${processConfig.package_script} untuk ${processId} tidak tersedia.`,
      );
    } else if (String(command).trim().replace(/\s+/g, " ") !== expected.command) {
      if (/\b(?:nodemon|next\s+dev|tsx\s+watch)\b/i.test(command)) {
        errors.push(`Proses ${processId} tidak boleh memakai runtime development.`);
      } else {
        errors.push(`Command production ${processId} tidak sesuai kontrak.`);
      }
    }
  }
  for (const processId of Object.keys(EXPECTED_PROCESS_CONTRACT)) {
    if (!seenProcessIds.has(processId)) {
      errors.push(`Proses wajib belum terdaftar: ${processId}.`);
    }
  }

  const dependencies = Array.isArray(topology.dependencies)
    ? topology.dependencies
    : [];
  const dependencyIds = dependencies
    .filter((entry) => entry?.required === true)
    .map((entry) => String(entry.id || ""))
    .sort();
  if (JSON.stringify(dependencyIds) !== JSON.stringify(REQUIRED_DEPENDENCIES)) {
    errors.push("Dependency wajib harus PostgreSQL, Redis, dan persistent storage.");
  }
  if (
    topology.probes?.api_liveness_path !== "/health" ||
    topology.probes?.api_readiness_path !== "/ready" ||
    topology.probes?.frontend_path !== "/"
  ) {
    errors.push("Path probe runtime tidak sesuai endpoint aplikasi.");
  }

  const releaseSequence = Array.isArray(topology.release_sequence)
    ? topology.release_sequence
    : [];
  if (releaseSequence.length !== EXPECTED_RELEASE_SEQUENCE.length) {
    errors.push("Urutan release manual belum lengkap.");
  } else {
    for (let index = 0; index < EXPECTED_RELEASE_SEQUENCE.length; index += 1) {
      const [id, repository, packageScript, command] =
        EXPECTED_RELEASE_SEQUENCE[index];
      const step = releaseSequence[index];
      if (
        step?.id !== id ||
        step?.repository !== repository ||
        step?.package_script !== packageScript ||
        (command !== null && step?.command !== command) ||
        step?.automatic !== false
      ) {
        errors.push(`Urutan release tidak sesuai pada langkah ${id}.`);
        continue;
      }
      if (packageScript) {
        const packageJson = repository === "frontend" ? frontendPackage : backendPackage;
        if (!packageJson?.scripts?.[packageScript]) {
          errors.push(`Script release belum tersedia: ${packageScript}.`);
        }
      }
    }
  }

  const requiredEnvironment = new Set(
    Array.isArray(topology.required_environment)
      ? topology.required_environment
      : [],
  );
  for (const key of REQUIRED_RELEASE_ENV) {
    if (!requiredEnvironment.has(key)) {
      errors.push(`Topologi belum mewajibkan environment ${key}.`);
    }
  }
  if (envExampleKeys instanceof Set) {
    for (const key of requiredEnvironment) {
      if (!envExampleKeys.has(key)) {
        errors.push(`.env.example belum mendokumentasikan ${key}.`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    process_count: seenProcessIds.size,
    required_dependency_count: dependencyIds.length,
  };
}

function resolveContractFrontendDirectory(env = process.env) {
  const configured = String(
    env.RELEASE_FRONTEND_DIR || env.FULLSTACK_FRONTEND_DIR || "",
  ).trim();
  return configured
    ? path.resolve(configured)
    : path.resolve(REPOSITORY_DIRECTORY, "..", "frontend-production");
}

function verifyStartupRecoveryContract({
  backendDirectory = REPOSITORY_DIRECTORY,
  getStartupTasks,
} = {}) {
  const readStartupTasks =
    getStartupTasks || require("../startup-tasks").getStartupTasks;
  let taskCount = 0;

  for (const [role, expected] of Object.entries(
    EXPECTED_STARTUP_RECOVERY_CONTRACT,
  )) {
    const taskNames = readStartupTasks(role).map((task) => task.name);
    if (
      taskNames.length !== 1 ||
      taskNames[0] !== expected.taskName
    ) {
      throw new Error(`Recovery startup ${role} tidak sesuai kontrak.`);
    }

    const entrypointPath = path.join(backendDirectory, expected.entrypoint);
    const entrypointSource = fs.readFileSync(entrypointPath, "utf8");
    const escapedRole = role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const startupCall = new RegExp(
      `runStartupTasks\\s*\\(\\s*\\{\\s*role\\s*:\\s*["']${escapedRole}["']\\s*\\}\\s*\\)`,
    );
    if (!startupCall.test(entrypointSource)) {
      throw new Error(
        `Entrypoint ${role} tidak menjalankan recovery startup yang diwajibkan.`,
      );
    }
    taskCount += taskNames.length;
  }

  return {
    recovery_role_count: Object.keys(EXPECTED_STARTUP_RECOVERY_CONTRACT).length,
    recovery_task_count: taskCount,
  };
}

function verifyReleaseContract({
  backendDirectory = REPOSITORY_DIRECTORY,
  frontendDirectory = resolveContractFrontendDirectory(),
  topologyPath = TOPOLOGY_PATH,
  releaseLayoutPath = RELEASE_LAYOUT_PATH,
} = {}) {
  const backendPackage = readJson(path.join(backendDirectory, "package.json"));
  const frontendPackage = readJson(path.join(frontendDirectory, "package.json"));
  const topology = readJson(topologyPath);
  const releaseLayout = readJson(releaseLayoutPath);
  const envExampleKeys = parseEnvExampleKeys(
    fs.readFileSync(path.join(backendDirectory, ".env.example"), "utf8"),
  );
  const evaluation = validateRuntimeTopology({
    topology,
    backendPackage,
    frontendPackage,
    envExampleKeys,
  });
  if (!evaluation.valid) {
    throw new Error(`Kontrak release tidak valid: ${evaluation.errors.join(" ")}`);
  }
  if (
    releaseLayout.schema_version !== 1 ||
    releaseLayout.strategy !== "manual-atomic-symlink" ||
    releaseLayout.production_platform !== "linux" ||
    releaseLayout.automatic_deployment !== false ||
    releaseLayout.approval_required !== true ||
    JSON.stringify(releaseLayout.post_activation_checks) !==
      JSON.stringify([
        "pm2-five-processes-online",
        "api-health-ready",
        "frontend-http-ok",
      ]) ||
    releaseLayout.rollback?.scope !== "application-release-only" ||
    releaseLayout.rollback?.database_migrations !== "forward-only" ||
    releaseLayout.rollback?.deletes_release !== false
  ) {
    throw new Error("Kontrak layout release manual-atomic tidak valid.");
  }

  const currentNodeMajor = Number(process.versions.node.split(".")[0]);
  if (!topology.node.supported_major_versions.includes(currentNodeMajor)) {
    throw new Error("Versi Node.js saat ini belum termasuk runtime yang diuji.");
  }

  const recovery = verifyStartupRecoveryContract({ backendDirectory });

  return {
    schema_version: topology.schema_version,
    process_count: evaluation.process_count,
    required_dependency_count: evaluation.required_dependency_count,
    automatic_deployment: false,
    deployment_strategy: releaseLayout.strategy,
    backup_automation: false,
    node_major: currentNodeMajor,
    data_backup_restore_status:
      topology.operations.data_backup_restore_status,
    rpo_rto_status: topology.operations.rpo_rto_status,
    ...recovery,
  };
}

function assertProductionReleaseEnvironment(
  env = process.env,
  repositoryDirectory = REPOSITORY_DIRECTORY,
) {
  if (String(env.NODE_ENV || "").trim() !== "production") {
    throw new Error("Production preflight wajib memakai NODE_ENV=production.");
  }
  const missing = REQUIRED_PREFLIGHT_ENV.filter(
    (key) => !String(env[key] || "").trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `Environment release wajib belum lengkap: ${missing.join(", ")}.`,
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{5,95}$/.test(String(env.DEPLOY_RELEASE_ID))) {
    throw new Error("DEPLOY_RELEASE_ID tidak memenuhi format release ID yang aman.");
  }
  const migrationUrl = String(env.MIGRATION_DATABASE_URL || "").trim();
  let parsedMigrationUrl;
  try {
    parsedMigrationUrl = new URL(migrationUrl);
  } catch {
    throw new Error("MIGRATION_DATABASE_URL wajib berupa URL PostgreSQL valid.");
  }
  if (
    !["postgresql:", "postgres:"].includes(parsedMigrationUrl.protocol) ||
    !parsedMigrationUrl.username ||
    !parsedMigrationUrl.password ||
    !parsedMigrationUrl.hostname ||
    parsedMigrationUrl.pathname.length <= 1
  ) {
    throw new Error("MIGRATION_DATABASE_URL wajib berupa URL PostgreSQL lengkap.");
  }
  const migrationComponents = [
    parsedMigrationUrl.username,
    parsedMigrationUrl.password,
    parsedMigrationUrl.hostname,
    ...parsedMigrationUrl.pathname.split("/").filter(Boolean),
  ];
  if (
    migrationComponents.some((component) =>
      /^(?:GANTI|ISI|CHANGE|YOUR)(?:_|-|$)/i.test(component),
    )
  ) {
    throw new Error("MIGRATION_DATABASE_URL wajib diisi untuk production release.");
  }
  if (migrationUrl === String(env.DATABASE_URL || "").trim()) {
    throw new Error(
      "MIGRATION_DATABASE_URL harus terpisah dari DATABASE_URL runtime.",
    );
  }

  const frontendDirectory = String(env.RELEASE_FRONTEND_DIR).trim();
  if (!path.isAbsolute(frontendDirectory)) {
    throw new Error("RELEASE_FRONTEND_DIR wajib memakai absolute path.");
  }
  const relativeToBackend = path.relative(
    repositoryDirectory,
    path.resolve(frontendDirectory),
  );
  if (
    relativeToBackend === "" ||
    (!relativeToBackend.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativeToBackend))
  ) {
    throw new Error("RELEASE_FRONTEND_DIR tidak boleh berada di dalam backend.");
  }
  return path.resolve(frontendDirectory);
}

function assertPostDeployEnvironment(env = process.env) {
  if (String(env.NODE_ENV || "").trim() !== "production") {
    throw new Error("Verifikasi pascadeploy wajib memakai NODE_ENV=production.");
  }
  const missing = REQUIRED_VERIFY_ENV.filter(
    (key) => !String(env[key] || "").trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `Target verifikasi release belum lengkap: ${missing.join(", ")}.`,
    );
  }
}

function inspectFrontendProductionBuild(frontendDirectory) {
  const packageJson = readJson(path.join(frontendDirectory, "package.json"));
  if (packageJson.scripts?.start !== "next start") {
    throw new Error("Frontend production wajib dijalankan dengan next start.");
  }
  const requiredFiles = [
    path.join(frontendDirectory, ".next", "BUILD_ID"),
    path.join(frontendDirectory, ".next", "required-server-files.json"),
    path.join(frontendDirectory, ".next", "routes-manifest.json"),
  ];
  for (const filePath of requiredFiles) {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size < 1) {
      throw new Error("Artefak build frontend production belum lengkap.");
    }
  }
  const buildId = fs
    .readFileSync(requiredFiles[0], "utf8")
    .trim();
  if (!/^[a-zA-Z0-9_-]{4,128}$/.test(buildId)) {
    throw new Error("BUILD_ID frontend tidak valid.");
  }
  let requiredServerFiles;
  let routesManifest;
  try {
    requiredServerFiles = readJson(requiredFiles[1]);
    routesManifest = readJson(requiredFiles[2]);
  } catch {
    throw new Error("Manifest build frontend production bukan JSON valid.");
  }
  if (
    requiredServerFiles?.version !== 1 ||
    !requiredServerFiles.config ||
    typeof requiredServerFiles.config !== "object" ||
    !Array.isArray(requiredServerFiles.files)
  ) {
    throw new Error("Manifest required-server-files frontend tidak valid.");
  }
  if (
    !Number.isInteger(routesManifest?.version) ||
    routesManifest.version < 1 ||
    !Array.isArray(routesManifest.staticRoutes) ||
    !Array.isArray(routesManifest.dynamicRoutes) ||
    !Array.isArray(routesManifest.dataRoutes)
  ) {
    throw new Error("Manifest routes frontend tidak valid.");
  }
  return { build_artifacts: requiredFiles.length };
}

function assertReleaseUrl(
  rawValue,
  label,
  expectedPath,
  { allowLoopback = false } = {},
) {
  let url;
  try {
    url = new URL(String(rawValue || "").trim());
  } catch {
    throw new Error(`${label} wajib berupa URL valid.`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} tidak boleh memuat credential.`);
  }
  if (url.search || url.hash) {
    throw new Error(`${label} tidak boleh memuat query atau fragment.`);
  }
  const loopback = isLoopbackHostname(url.hostname);
  if (url.protocol !== "https:" && !(allowLoopback && loopback && url.protocol === "http:")) {
    throw new Error(`${label} wajib memakai HTTPS.`);
  }
  if (loopback && !allowLoopback) {
    throw new Error(`${label} tidak boleh menunjuk loopback.`);
  }
  const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
  if (normalizedPath !== expectedPath) {
    throw new Error(`${label} wajib memakai path ${expectedPath}.`);
  }
  return url;
}

function parseProbeTimeout(value) {
  const parsed = Number(value || 5000);
  if (!Number.isInteger(parsed) || parsed < 500 || parsed > 60000) {
    throw new Error("RELEASE_VERIFY_TIMEOUT_MS harus antara 500 dan 60000.");
  }
  return parsed;
}

function evaluateLivenessPayload(payload) {
  const passed = Boolean(
    payload &&
      payload.status === true &&
      payload.success === true &&
      payload.data?.state === "alive" &&
      typeof payload.data?.version === "string" &&
      payload.data.version.length > 0,
  );
  return { passed, violations: passed ? [] : ["api_liveness"] };
}

function evaluateReadinessPayload(payload, env = process.env) {
  const violations = [];
  const data = payload?.data;
  const checks = data?.checks || {};
  if (
    !payload ||
    payload.status !== true ||
    payload.success !== true ||
    data?.ready !== true ||
    data?.state !== "ready"
  ) {
    violations.push("api_readiness");
  }
  for (const checkId of ["database", "storage", "rate_limit_store"]) {
    if (checks[checkId]?.status !== "up") violations.push(checkId);
  }
  if (isEnabled(env.SLIK_IMPORT_QUEUE_ENABLED)) {
    if (
      checks.redis?.status !== "up" ||
      checks.redis?.details?.reachable !== true
    ) {
      violations.push("redis_queue");
    }
    if (
      isEnabled(env.SLIK_IMPORT_REQUIRE_WORKER) &&
      checks.redis?.details?.workers_available !== true
    ) {
      violations.push("slik_import_worker");
    }
  }
  if (
    isEnabled(env.APP_CACHE_ENABLED) &&
    checks.application_cache?.status !== "up"
  ) {
    violations.push("application_cache");
  }
  if (
    String(env.WATERMARK_PROCESSING_MODE || "").trim().toLowerCase() ===
    "worker"
  ) {
    if (
      checks.watermark_worker?.status !== "up" ||
      checks.watermark_worker?.details?.workers_available !== true
    ) {
      violations.push("watermark_worker");
    }
  }
  if (
    isEnabled(env.OTEL_ENABLED) &&
    checks.observability?.status !== "up"
  ) {
    violations.push("observability");
  }
  return {
    passed: violations.length === 0,
    violations: [...new Set(violations)],
  };
}

async function readProbeBodyLimited(response) {
  if (!response.body || typeof response.body.getReader !== "function") {
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_PROBE_BODY_BYTES) {
      throw new Error("Respons probe melewati batas ukuran.");
    }
    return body;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_PROBE_BODY_BYTES) {
        await reader.cancel();
        throw new Error("Respons probe melewati batas ukuran.");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

async function readProbeResponse(
  url,
  { fetchImpl = fetch, timeoutMs = 5000, expectJson = false } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Accept: expectJson ? "application/json" : "text/html",
        "User-Agent": "RuwangArsipReleaseVerifier/1",
      },
    });
    if (response.status !== 200) {
      throw new Error("Probe production tidak mengembalikan HTTP 200.");
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_PROBE_BODY_BYTES) {
      throw new Error("Respons probe melewati batas ukuran.");
    }
    const contentType = String(response.headers.get("content-type") || "");
    if (!expectJson) {
      if (!contentType.toLowerCase().includes("text/html")) {
        throw new Error("Frontend probe tidak mengembalikan HTML.");
      }
      const body = await readProbeBodyLimited(response);
      if (!/(?:<!doctype\s+html\b|<html\b)/i.test(body)) {
        throw new Error("Frontend probe tidak mengembalikan dokumen HTML valid.");
      }
      return { status: response.status };
    }
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new Error("API probe tidak mengembalikan JSON.");
    }
    const body = await readProbeBodyLimited(response);
    return { status: response.status, body: JSON.parse(body) };
  } finally {
    clearTimeout(timer);
  }
}

async function runNamedChecks(definitions) {
  const results = [];
  for (const definition of definitions) {
    const startedAt = Date.now();
    try {
      await definition.run();
      results.push({
        id: definition.id,
        status: "passed",
        duration_ms: Date.now() - startedAt,
      });
    } catch {
      results.push({
        id: definition.id,
        status: "failed",
        duration_ms: Date.now() - startedAt,
      });
      if (definition.stop_on_failure) break;
    }
  }
  return results;
}

function buildReleaseReport(kind, startedAt, checks, { releaseId = null } = {}) {
  const passed = checks.length > 0 && checks.every((check) => check.status === "passed");
  const normalizedReleaseId = String(releaseId || "").trim();
  if (
    normalizedReleaseId &&
    !/^[A-Za-z0-9][A-Za-z0-9._-]{5,95}$/.test(normalizedReleaseId)
  ) {
    throw new Error("Release ID pada report tidak valid.");
  }
  return {
    schema_version: 1,
    kind,
    status: passed ? "passed" : "failed",
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    automatic_deployment: false,
    backup_automation: false,
    ...(normalizedReleaseId ? { release_id: normalizedReleaseId } : {}),
    checks,
  };
}

function resolveReleaseReportDirectory(
  value,
  repositoryDirectory = REPOSITORY_DIRECTORY,
) {
  const reportRoot = path.resolve(
    repositoryDirectory,
    String(value || "release-reports").trim(),
  );
  const relative = path.relative(repositoryDirectory, reportRoot);
  if (
    reportRoot === repositoryDirectory ||
    reportRoot === path.parse(reportRoot).root ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("RELEASE_REPORT_DIR menunjuk direktori yang tidak aman.");
  }
  return path.join(reportRoot, "latest");
}

function writeReleaseReport(kind, report, env = process.env) {
  const reportDirectory = resolveReleaseReportDirectory(env.RELEASE_REPORT_DIR);
  fs.mkdirSync(reportDirectory, { recursive: true });
  const reportPath = path.join(reportDirectory, `${kind}.json`);
  const temporaryPath = `${reportPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.rmSync(reportPath, { force: true });
  fs.renameSync(temporaryPath, reportPath);
  return reportPath;
}

function assertMigrationStatus() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["run", "migrate:status", "--silent"], {
    cwd: REPOSITORY_DIRECTORY,
    env: process.env,
    encoding: "utf8",
    shell: false,
    timeout: 120000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error("Status migration Prisma belum siap untuk release.");
  }
}

async function runProductionPreflight() {
  const startedAt = new Date();
  const releaseId = String(process.env.DEPLOY_RELEASE_ID || "").trim();
  let frontendDirectory;
  const { loadEnv, validateEnv } = require("../config/env");
  loadEnv();
  const initialChecks = await runNamedChecks([
    {
      id: "release_contract",
      stop_on_failure: true,
      run: async () => verifyReleaseContract(),
    },
    {
      id: "production_environment",
      stop_on_failure: true,
      run: async () => {
        validateEnv();
        frontendDirectory = assertProductionReleaseEnvironment();
      },
    },
  ]);
  if (initialChecks.some((check) => check.status === "failed")) {
    return buildReleaseReport("preflight", startedAt, initialChecks, {
      releaseId: /^[A-Za-z0-9][A-Za-z0-9._-]{5,95}$/.test(releaseId)
        ? releaseId
        : null,
    });
  }

  let prisma;
  let systemPrisma;
  let assertRateLimitStoreReady;
  let closeSlikImportQueue = async () => {};
  let closeApplicationCache = async () => {};
  let closeRateLimitStore = async () => {};
  let runtimeChecks = [];
  try {
    prisma = require("../config/prisma");
    systemPrisma = require("../config/prisma-system");
    const { ensureStorageReady } = require("./storage-runtime");
    const {
      assertDatabaseRuntimeSecurity,
      assertDatabaseSystemSecurity,
    } = require("./database-security");
    ({
      assertRateLimitStoreReady,
      closeRateLimitStore,
    } = require("./rate-limit-store"));
    const {
      checkApplicationCacheHealth,
      isApplicationCacheEnabled,
    } = require("./application-cache");
    ({ closeApplicationCache } = require("./application-cache"));
    const { checkSlikImportQueueHealth } = require("../queues/slik-import.queue");
    ({ closeSlikImportQueue } = require("../queues/slik-import.queue"));

    runtimeChecks = await runNamedChecks([
      {
        id: "frontend_build",
        run: async () => inspectFrontendProductionBuild(frontendDirectory),
      },
      { id: "persistent_storage", run: async () => ensureStorageReady() },
      {
        id: "database_runtime_security",
        run: async () => {
          await prisma.$connect();
          await assertDatabaseRuntimeSecurity(prisma);
        },
      },
      {
        id: "database_system_security",
        run: async () => {
          await systemPrisma.$connect();
          await assertDatabaseSystemSecurity(systemPrisma);
        },
      },
      { id: "prisma_migration_status", run: async () => assertMigrationStatus() },
      { id: "redis_rate_limit", run: async () => assertRateLimitStoreReady() },
      {
        id: "redis_job_queue",
        run: async () => {
          const result = await checkSlikImportQueueHealth();
          if (!result.enabled || !result.reachable) {
            throw new Error("Redis queue belum siap.");
          }
        },
      },
      {
        id: "redis_application_cache",
        run: async () => {
          if (isApplicationCacheEnabled()) await checkApplicationCacheHealth();
        },
      },
    ]);
  } catch {
    runtimeChecks.push({
      id: "runtime_dependencies",
      status: "failed",
      duration_ms: 0,
    });
  } finally {
    await Promise.allSettled([
      closeSlikImportQueue(),
      closeApplicationCache(),
      closeRateLimitStore(),
      prisma?.$disconnect?.() || Promise.resolve(),
      systemPrisma && systemPrisma !== prisma
        ? systemPrisma.$disconnect()
        : Promise.resolve(),
    ]);
  }
  return buildReleaseReport(
    "preflight",
    startedAt,
    [...initialChecks, ...runtimeChecks],
    { releaseId },
  );
}

async function runPostDeployVerification({
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const startedAt = new Date();
  const allowLoopback = isEnabled(env.RELEASE_VERIFY_ALLOW_LOOPBACK);
  const timeoutMs = parseProbeTimeout(env.RELEASE_VERIFY_TIMEOUT_MS);
  let healthUrl;
  let readyUrl;
  let frontendUrl;
  const checks = await runNamedChecks([
    {
      id: "release_targets",
      stop_on_failure: true,
      run: async () => {
        assertPostDeployEnvironment(env);
        healthUrl = assertReleaseUrl(
          env.RELEASE_VERIFY_API_HEALTH_URL,
          "RELEASE_VERIFY_API_HEALTH_URL",
          "/health",
          { allowLoopback },
        );
        readyUrl = assertReleaseUrl(
          env.RELEASE_VERIFY_API_READY_URL,
          "RELEASE_VERIFY_API_READY_URL",
          "/ready",
          { allowLoopback },
        );
        frontendUrl = assertReleaseUrl(
          env.RELEASE_VERIFY_FRONTEND_URL,
          "RELEASE_VERIFY_FRONTEND_URL",
          "/",
          { allowLoopback },
        );
        if (healthUrl.origin !== readyUrl.origin) {
          throw new Error(
            "Target liveness dan readiness API wajib berasal dari origin yang sama.",
          );
        }
      },
    },
  ]);
  if (checks.some((check) => check.status === "failed")) {
    return buildReleaseReport("post-deploy", startedAt, checks);
  }
  const probeChecks = await runNamedChecks([
    {
      id: "api_liveness",
      run: async () => {
        const response = await readProbeResponse(healthUrl, {
          fetchImpl,
          timeoutMs,
          expectJson: true,
        });
        if (!evaluateLivenessPayload(response.body).passed) {
          throw new Error("Payload liveness tidak valid.");
        }
      },
    },
    {
      id: "api_readiness_and_workers",
      run: async () => {
        const response = await readProbeResponse(readyUrl, {
          fetchImpl,
          timeoutMs,
          expectJson: true,
        });
        if (!evaluateReadinessPayload(response.body, env).passed) {
          throw new Error("Payload readiness tidak memenuhi kontrak production.");
        }
      },
    },
    {
      id: "frontend_http",
      run: async () =>
        readProbeResponse(frontendUrl, {
          fetchImpl,
          timeoutMs,
          expectJson: false,
        }),
    },
  ]);
  return buildReleaseReport(
    "post-deploy",
    startedAt,
    [...checks, ...probeChecks],
  );
}

module.exports = {
  EXPECTED_PROCESS_CONTRACT,
  EXPECTED_RELEASE_SEQUENCE,
  EXPECTED_STARTUP_RECOVERY_CONTRACT,
  REQUIRED_DEPENDENCIES,
  REQUIRED_PREFLIGHT_ENV,
  REQUIRED_RELEASE_ENV,
  REQUIRED_VERIFY_ENV,
  RELEASE_LAYOUT_PATH,
  REPOSITORY_DIRECTORY,
  TOPOLOGY_PATH,
  assertPostDeployEnvironment,
  assertProductionReleaseEnvironment,
  assertReleaseUrl,
  buildReleaseReport,
  evaluateLivenessPayload,
  evaluateReadinessPayload,
  inspectFrontendProductionBuild,
  isEnabled,
  parseEnvExampleKeys,
  parseProbeTimeout,
  readProbeResponse,
  resolveContractFrontendDirectory,
  resolveReleaseReportDirectory,
  runNamedChecks,
  runPostDeployVerification,
  runProductionPreflight,
  validateRuntimeTopology,
  verifyReleaseContract,
  verifyStartupRecoveryContract,
  writeReleaseReport,
};
