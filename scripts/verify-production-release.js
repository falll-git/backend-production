const { loadEnv, validateEnv } = require("../src/config/env");
const {
  buildReleaseReport,
  runPostDeployVerification,
  writeReleaseReport,
} = require("../src/system/release-readiness");

async function run() {
  loadEnv();
  const startedAt = new Date();
  let report;
  try {
    validateEnv();
    report = await runPostDeployVerification();
  } catch {
    report = buildReleaseReport("post-deploy", startedAt, [
      {
        id: "production_environment",
        status: "failed",
        duration_ms: 0,
      },
    ]);
  }
  const reportPath = writeReleaseReport("post-deploy", report);
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
      `${JSON.stringify({ status: "failed", reason: "post_deploy_internal" })}\n`,
    );
    process.exitCode = 1;
  });
}

module.exports = { run };
