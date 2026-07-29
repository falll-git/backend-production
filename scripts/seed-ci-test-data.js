const CI_DEBTOR_NUMBER = "CI-DEBTOR-001";

function assertSafeCiDatabase(env = process.env) {
  if (String(env.CI || "").trim().toLowerCase() !== "true") {
    throw new Error("Seed data CI hanya boleh dijalankan saat CI=true.");
  }

  let databaseUrl;
  try {
    databaseUrl = new URL(String(env.DATABASE_URL || ""));
  } catch {
    throw new Error("DATABASE_URL CI tidak valid.");
  }

  const hostname = databaseUrl.hostname.toLowerCase();
  const loopback =
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.startsWith("127.");
  const githubService =
    hostname === "postgres" &&
    String(env.GITHUB_ACTIONS || "").trim().toLowerCase() === "true";
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));

  if (
    (!loopback && !githubService) ||
    !/(?:^|[_-])(?:ci|test|local)(?:$|[_-])/i.test(databaseName)
  ) {
    throw new Error(
      "Seed data CI ditolak: database wajib loopback atau service PostgreSQL GitHub Actions dan namanya harus memuat penanda ci/test/local.",
    );
  }

  return { databaseName, hostname };
}

async function seedCiTestData(env = process.env, client) {
  assertSafeCiDatabase(env);
  const prisma = client || require("../src/config/prisma");
  const adminUsername = String(
    env.SEED_ADMIN_USERNAME || env.API_TEST_ADMIN_USERNAME || "",
  )
    .trim()
    .toLowerCase();

  if (!adminUsername) {
    throw new Error("SEED_ADMIN_USERNAME atau API_TEST_ADMIN_USERNAME wajib diisi.");
  }

  const admin = await prisma.users.findUnique({
    where: { username: adminUsername },
    select: { id: true },
  });
  if (!admin) {
    throw new Error("Admin CI belum tersedia. Jalankan seed utama terlebih dahulu.");
  }

  await prisma.digital_debtors.upsert({
    where: { debtor_number: CI_DEBTOR_NUMBER },
    update: {
      name: "Debitur Fixture CI",
      status: "ACTIVE",
      description: "Data sementara untuk pengujian CI.",
      updated_by: admin.id,
      deleted_at: null,
      deleted_by: null,
    },
    create: {
      debtor_number: CI_DEBTOR_NUMBER,
      name: "Debitur Fixture CI",
      status: "ACTIVE",
      customer_type: "INDIVIDUAL",
      description: "Data sementara untuk pengujian CI.",
      created_by: admin.id,
    },
  });

  console.log("CI test fixture seeded.");
}

async function main() {
  const prisma = require("../src/config/prisma");
  try {
    await seedCiTestData(process.env, prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { CI_DEBTOR_NUMBER, assertSafeCiDatabase, seedCiTestData };
