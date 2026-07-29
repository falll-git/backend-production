const CI_DEBTOR_NUMBER = "CI-DEBTOR-001";
const CI_CONTRACT_NUMBER = "CI-CONTRACT-001";
const CI_MARKETING_ACTIVITY_ID = "00000000-0000-4000-8000-00000000c101";
const CI_NOTARY_CODE = "CI-NOTARY-001";
const CI_NOTARY_PROGRESS_ID = "00000000-0000-4000-8000-00000000c201";
const CI_DEPOSIT_ID = "00000000-0000-4000-8000-00000000c301";
const CI_DEPOSIT_TRANSACTION_ID = "00000000-0000-4000-8000-00000000c302";

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

  await prisma.$transaction(async (tx) => {
    const [product, contractType, kolLevel, depositType] = await Promise.all([
      tx.financing_products.findUnique({
        where: { code: "MODAL_KERJA" },
        select: { id: true },
      }),
      tx.contract_types.findUnique({
        where: { code: "MURABAHAH" },
        select: { id: true },
      }),
      tx.collectibility_levels.findUnique({
        where: { code: "KOL_1" },
        select: { id: true },
      }),
      tx.deposit_types.findUnique({
        where: { code: "NOTARIS" },
        select: { id: true },
      }),
    ]);

    if (!product || !contractType || !kolLevel || !depositType) {
      throw new Error(
        "Parameter CI belum lengkap. Jalankan seed utama sebelum seed data pengujian.",
      );
    }

    const debtor = await tx.digital_debtors.upsert({
      where: { debtor_number: CI_DEBTOR_NUMBER },
      update: {
        name: "Debitur Fixture CI",
        status: "ACTIVE",
        customer_type: "INDIVIDUAL",
        marketing_user_id: admin.id,
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
        marketing_user_id: admin.id,
        description: "Data sementara untuk pengujian CI.",
        created_by: admin.id,
      },
    });

    const contract = await tx.debtor_contracts.upsert({
      where: { no_kontrak: CI_CONTRACT_NUMBER },
      update: {
        debtor_id: debtor.id,
        product_id: product.id,
        akad_type_id: contractType.id,
        marketing_user_id: admin.id,
        tanggal_akad: new Date("2026-01-15T00:00:00.000Z"),
        tanggal_jatuh_tempo: new Date("2027-01-15T00:00:00.000Z"),
        plafond: 10000000,
        pokok: 10000000,
        outstanding_pokok: 7500000,
        status: "ACTIVE",
        updated_by: admin.id,
        deleted_at: null,
        deleted_by: null,
      },
      create: {
        no_kontrak: CI_CONTRACT_NUMBER,
        debtor_id: debtor.id,
        product_id: product.id,
        akad_type_id: contractType.id,
        marketing_user_id: admin.id,
        tanggal_akad: new Date("2026-01-15T00:00:00.000Z"),
        tanggal_jatuh_tempo: new Date("2027-01-15T00:00:00.000Z"),
        plafond: 10000000,
        pokok: 10000000,
        tenor: 12,
        outstanding_pokok: 7500000,
        status: "ACTIVE",
        created_by: admin.id,
      },
    });

    await tx.debtor_collectibilities.upsert({
      where: {
        contract_id_period_month: {
          contract_id: contract.id,
          period_month: "2026-04",
        },
      },
      update: {
        kol_level_id: kolLevel.id,
        outstanding_pokok: 7500000,
        outstanding_margin: 0,
        dpd: 0,
        notes: "Fixture kolektibilitas CI.",
        updated_by: admin.id,
        deleted_at: null,
        deleted_by: null,
      },
      create: {
        contract_id: contract.id,
        period_month: "2026-04",
        kol_level_id: kolLevel.id,
        outstanding_pokok: 7500000,
        outstanding_margin: 0,
        dpd: 0,
        notes: "Fixture kolektibilitas CI.",
        created_by: admin.id,
      },
    });

    await tx.debtor_marketing_activities.upsert({
      where: { id: CI_MARKETING_ACTIVITY_ID },
      update: {
        debtor_id: debtor.id,
        contract_id: contract.id,
        activity_kind: "HANDLING_STEP",
        activity_date: new Date("2026-04-20T00:00:00.000Z"),
        target_date: new Date("2026-04-27T00:00:00.000Z"),
        status: "PENDING",
        handling_step: "Tindak lanjut fixture CI.",
        notes: "Data sementara untuk pengujian modal dashboard.",
        updated_by: admin.id,
        deleted_at: null,
        deleted_by: null,
      },
      create: {
        id: CI_MARKETING_ACTIVITY_ID,
        debtor_id: debtor.id,
        contract_id: contract.id,
        activity_kind: "HANDLING_STEP",
        activity_date: new Date("2026-04-20T00:00:00.000Z"),
        target_date: new Date("2026-04-27T00:00:00.000Z"),
        status: "PENDING",
        handling_step: "Tindak lanjut fixture CI.",
        notes: "Data sementara untuk pengujian modal dashboard.",
        created_by: admin.id,
      },
    });

    const notary = await tx.third_parties.upsert({
      where: { code: CI_NOTARY_CODE },
      update: {
        name: "Notaris Fixture CI",
        category: "NOTARY",
        is_active: true,
        updated_by: admin.id,
        deleted_at: null,
        deleted_by: null,
      },
      create: {
        code: CI_NOTARY_CODE,
        name: "Notaris Fixture CI",
        category: "NOTARY",
        is_active: true,
        created_by: admin.id,
      },
    });

    await tx.legal_notary_progress.upsert({
      where: { id: CI_NOTARY_PROGRESS_ID },
      update: {
        contract_id: contract.id,
        third_party_id: notary.id,
        deed_type: "Akta Jaminan Fixture CI",
        received_at: new Date("2026-04-18T00:00:00.000Z"),
        estimated_completed_at: new Date("2026-05-18T00:00:00.000Z"),
        status: "PROSES",
        notes: "Data sementara untuk pengujian detail Notaris.",
        updated_by: admin.id,
        deleted_at: null,
        deleted_by: null,
      },
      create: {
        id: CI_NOTARY_PROGRESS_ID,
        contract_id: contract.id,
        third_party_id: notary.id,
        deed_type: "Akta Jaminan Fixture CI",
        received_at: new Date("2026-04-18T00:00:00.000Z"),
        estimated_completed_at: new Date("2026-05-18T00:00:00.000Z"),
        status: "PROSES",
        notes: "Data sementara untuk pengujian detail Notaris.",
        created_by: admin.id,
      },
    });

    await tx.legal_deposits.upsert({
      where: { id: CI_DEPOSIT_ID },
      update: {
        deposit_type_id: depositType.id,
        type: "NOTARIS",
        contract_id: contract.id,
        third_party_id: notary.id,
        nominal: 10000000,
        paid_amount: 5000000,
        processed_amount: 0,
        remaining_amount: 5000000,
        status: "ACTIVE",
        notes: "Data sementara untuk pengujian detail dana titipan.",
        updated_by: admin.id,
        deleted_at: null,
        deleted_by: null,
      },
      create: {
        id: CI_DEPOSIT_ID,
        deposit_type_id: depositType.id,
        type: "NOTARIS",
        contract_id: contract.id,
        third_party_id: notary.id,
        nominal: 10000000,
        paid_amount: 5000000,
        processed_amount: 0,
        remaining_amount: 5000000,
        status: "ACTIVE",
        notes: "Data sementara untuk pengujian detail dana titipan.",
        created_by: admin.id,
      },
    });

    await tx.legal_deposit_transactions.upsert({
      where: { id: CI_DEPOSIT_TRANSACTION_ID },
      update: {
        deposit_id: CI_DEPOSIT_ID,
        transaction_date: new Date("2026-04-19T00:00:00.000Z"),
        action: "PEMBAYARAN",
        amount: 5000000,
        notes: "Transaksi sementara untuk pengujian CI.",
      },
      create: {
        id: CI_DEPOSIT_TRANSACTION_ID,
        deposit_id: CI_DEPOSIT_ID,
        transaction_date: new Date("2026-04-19T00:00:00.000Z"),
        action: "PEMBAYARAN",
        amount: 5000000,
        notes: "Transaksi sementara untuk pengujian CI.",
        created_by: admin.id,
      },
    });
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

module.exports = {
  CI_CONTRACT_NUMBER,
  CI_DEBTOR_NUMBER,
  CI_DEPOSIT_ID,
  CI_DEPOSIT_TRANSACTION_ID,
  CI_MARKETING_ACTIVITY_ID,
  CI_NOTARY_CODE,
  CI_NOTARY_PROGRESS_ID,
  assertSafeCiDatabase,
  seedCiTestData,
};
