const { loadEnv, validateEnv } = require("../src/config/env");

loadEnv();
validateEnv();

const prisma = require("../src/config/prisma");
const { buildRetentionReport } = require("../src/system/retention-report");

async function main() {
  const report = await buildRetentionReport(prisma);
  const output = process.argv.includes("--summary")
    ? {
        generated_at: report.generated_at,
        dry_run: report.dry_run,
        deletion_enabled: report.deletion_enabled,
        policy_status: report.policy_status,
        bucket_days: report.bucket_days,
        dataset_count: report.datasets.length,
        categories: Object.fromEntries(
          [...new Set(report.datasets.map((item) => item.category))].map((category) => [
            category,
            report.datasets.filter((item) => item.category === category).length,
          ]),
        ),
      }
    : report;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main()
  .catch((error) => {
    console.error("Retention report gagal:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
