const { loadEnv } = require("../src/config/env");
loadEnv();

const prisma = require("../src/config/prisma");
const systemPrisma = require("../src/config/prisma-system");
const {
  evaluateDatabaseSystemSecurity,
  evaluateDatabaseSecurity,
  inspectDatabaseSecurity,
} = require("../src/system/database-security");

async function main() {
  const report = await inspectDatabaseSecurity(prisma);
  const evaluation = evaluateDatabaseSecurity(report);
  const system = systemPrisma === prisma
    ? { configured: false }
    : {
        configured: true,
        report: await inspectDatabaseSecurity(systemPrisma),
      };
  if (system.configured) {
    system.evaluation = evaluateDatabaseSystemSecurity(system.report);
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        read_only: true,
        report,
        evaluation,
        system,
      },
      null,
      2,
    )}\n`,
  );
}

main()
  .catch((error) => {
    console.error("Database security report gagal:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (systemPrisma !== prisma) await systemPrisma.$disconnect();
    await prisma.$disconnect();
  });
