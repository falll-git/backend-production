const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const {
  parseOptions,
} = require("./atomic-release-cli");
const {
  runProductionPreflight,
  writeReleaseReport,
} = require("../src/system/release-readiness");

const MIGRATION_ENV_KEYS = Object.freeze([
  "MIGRATION_DATABASE_URL",
  "MIGRATION_DATABASE_URL_FILE",
]);

function readMigrationEnvironmentFile(filePath) {
  const configured = String(filePath || "").trim();
  if (!configured || !path.isAbsolute(configured)) {
    throw new Error("File environment migration wajib berupa absolute path.");
  }

  let descriptor;
  try {
    descriptor = fs.openSync(
      configured,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    if (!fs.fstatSync(descriptor).isFile()) {
      throw new Error("File environment migration wajib berupa file biasa.");
    }
    return dotenv.parse(fs.readFileSync(descriptor, "utf8"));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("File environment")) {
      throw error;
    }
    throw new Error("File environment migration tidak dapat dibaca.");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function loadMigrationEnvironment(filePath, env = process.env) {
  const parsed = readMigrationEnvironmentFile(filePath);
  for (const key of MIGRATION_ENV_KEYS) {
    const incoming = typeof parsed[key] === "string" ? parsed[key].trim() : "";
    if (!incoming) continue;
    const existing = typeof env[key] === "string" ? env[key].trim() : "";
    if (existing && existing !== incoming) {
      throw new Error(`${key} terisi berbeda pada environment preflight.`);
    }
    env[key] = incoming;
  }
  return env;
}

function resolveMigrationEnvironmentFile(options = {}, env = process.env) {
  const explicit = String(options["migration-env-file"] || "").trim();
  if (explicit) return explicit;

  const configured = String(env.RELEASE_MIGRATION_ENV_FILE || "").trim();
  if (configured) return configured;

  const deployRoot = String(env.RUWANG_DEPLOY_ROOT || "").trim();
  if (!deployRoot || !path.isAbsolute(deployRoot)) return "";
  const candidate = path.join(deployRoot, "shared", "env", "migration.env");
  return fs.existsSync(candidate) ? candidate : "";
}

async function run(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const migrationEnvFile = resolveMigrationEnvironmentFile(options);
  if (migrationEnvFile) loadMigrationEnvironment(migrationEnvFile);
  const report = await runProductionPreflight();
  const reportPath = writeReleaseReport("preflight", report);
  process.stdout.write(
    `${JSON.stringify({
      status: report.status,
      checks: report.checks.length,
      failed: report.checks.filter((check) => check.status === "failed").length,
      automatic_deployment: false,
      backup_automation: false,
      report: reportPath,
    })}\n`,
  );
  if (report.status !== "passed") process.exitCode = 1;
  return report;
}

if (require.main === module) {
  run().catch(() => {
    process.stdout.write(
      `${JSON.stringify({ status: "failed", reason: "preflight_internal" })}\n`,
    );
    process.exitCode = 1;
  });
}

module.exports = {
  MIGRATION_ENV_KEYS,
  loadMigrationEnvironment,
  readMigrationEnvironmentFile,
  resolveMigrationEnvironmentFile,
  run,
};
