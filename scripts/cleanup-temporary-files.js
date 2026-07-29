const { loadEnv, validateEnv } = require("../src/config/env");

loadEnv();
validateEnv();

const prisma = require("../src/config/prisma");
const { ensureStorageReady } = require("../src/system/storage-runtime");
const {
  cleanupExpiredUploadTempFiles,
} = require("../src/system/temporary-file-cleanup");

async function main() {
  const apply = process.argv.includes("--apply");
  await ensureStorageReady({ checkCapacity: false });
  const report = await cleanupExpiredUploadTempFiles({
    dryRun: !apply,
    prismaClient: prisma,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main()
  .catch((error) => {
    console.error("Temporary file cleanup gagal:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
