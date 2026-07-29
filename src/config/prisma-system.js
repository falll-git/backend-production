const { loadEnv } = require("./env");
const prisma = require("./prisma");
const { createBasePrismaClient } = require("./prisma-client-factory");
const { usesSystemDatabase } = require("./prisma-runtime");

loadEnv();

const systemDatabaseUrl = String(process.env.DATABASE_SYSTEM_URL || "").trim();

if (
  usesSystemDatabase ||
  !systemDatabaseUrl ||
  systemDatabaseUrl === process.env.DATABASE_URL
) {
  module.exports = prisma;
} else {
  module.exports = createBasePrismaClient({
    applicationName: "ruwang-arsip-api-system",
    connectionString: systemDatabaseUrl,
    maxKey: "DB_SYSTEM_POOL_MAX",
  });
}
