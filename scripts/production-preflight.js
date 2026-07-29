const {
  runProductionPreflight,
  writeReleaseReport,
} = require("../src/system/release-readiness");

async function run() {
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

module.exports = { run };
