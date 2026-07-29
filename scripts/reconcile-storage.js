const { loadEnv, validateEnv } = require("../src/config/env");

loadEnv();
validateEnv();

const prisma = require("../src/config/prisma");
const { ensureStorageReady } = require("../src/system/storage-runtime");
const { reconcileStorage } = require("../src/system/storage-reconciliation");

async function main() {
  await ensureStorageReady({ checkCapacity: false });
  const report = await reconcileStorage({
    prismaClient: prisma,
    verifyChecksums: !process.argv.includes("--no-checksum"),
  });
  const output = process.argv.includes("--summary")
    ? {
        dry_run: report.dry_run,
        generated_at: report.generated_at,
        summary: report.summary,
      }
    : report;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main()
  .catch((error) => {
    console.error("Storage reconciliation gagal:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
