const { loadEnv, validateEnv } = require("../src/config/env");

loadEnv();
validateEnv();

const prisma = require("../src/config/prisma");
const {
  buildDatabaseMaintenanceReport,
} = require("../src/system/database-maintenance");

async function main() {
  const report = await buildDatabaseMaintenanceReport(prisma);
  const output = process.argv.includes("--summary")
    ? {
        generated_at: report.generated_at,
        read_only: report.read_only,
        health: report.health,
        invalid_index_count: report.invalid_indexes.length,
        unindexed_foreign_key_count: report.unindexed_foreign_keys.length,
        reported_tables: report.table_statistics.length,
        reported_indexes: report.index_statistics.length,
        slow_query_statistics_available: report.slow_query_statistics.available,
        automatic_vacuum_full: report.automatic_vacuum_full,
      }
    : report;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main()
  .catch((error) => {
    console.error("Database maintenance report gagal:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
