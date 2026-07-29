const { loadEnv } = require("../../src/config/env");
const prisma = require("../../src/config/prisma");
const {
  assertSafeIntegrationDatabase,
} = require("../../src/integration/support/integration-test-helpers");

module.exports = async function globalTeardown() {
  loadEnv();
  const userAgent = String(process.env.FULLSTACK_TEST_USER_AGENT || "").trim();
  if (!userAgent) return;

  assertSafeIntegrationDatabase("Full-stack global teardown");
  await new Promise((resolve) => setTimeout(resolve, 100));
  try {
    await Promise.all([
      prisma.system_activity_logs.deleteMany({ where: { user_agent: userAgent } }),
      prisma.debtor_activity_logs.deleteMany({ where: { user_agent: userAgent } }),
      prisma.legal_activity_logs.deleteMany({ where: { user_agent: userAgent } }),
      prisma.refresh_tokens.deleteMany({ where: { user_agent: userAgent } }),
    ]);

    const runId = String(process.env.FULLSTACK_TEST_RUN_ID || "").trim();
    if (runId && /^[0-9a-f-]{36}$/i.test(runId)) {
      await prisma.users.deleteMany({
        where: {
          AND: [
            {
              email: {
                contains: `.${runId.replace(/-/g, "").slice(0, 12)}.`,
              },
            },
            { email: { endsWith: "@fullstack.example.com" } },
          ],
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
};
