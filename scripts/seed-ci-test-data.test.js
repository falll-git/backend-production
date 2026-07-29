const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CI_CONTRACT_NUMBER,
  CI_DEBTOR_NUMBER,
  CI_DEPOSIT_ID,
  CI_MARKETING_ACTIVITY_ID,
  CI_NOTARY_CODE,
  CI_NOTARY_PROGRESS_ID,
  assertSafeCiDatabase,
  seedCiTestData,
} = require("./seed-ci-test-data");

const safeEnv = {
  CI: "true",
  DATABASE_URL:
    "postgresql://postgres:postgres@127.0.0.1:5432/ruwang_arsip_ci?schema=public",
  SEED_ADMIN_USERNAME: "CI-Admin",
};

test("seed CI menerima database loopback dengan nama khusus CI", () => {
  assert.deepEqual(
    assertSafeCiDatabase({
      CI: "true",
      DATABASE_URL:
        "postgresql://postgres:postgres@127.0.0.1:5432/ruwang_arsip_ci?schema=public",
    }),
    { databaseName: "ruwang_arsip_ci", hostname: "127.0.0.1" },
  );
});

test("seed CI menerima service PostgreSQL hanya di GitHub Actions", () => {
  assert.deepEqual(
    assertSafeCiDatabase({
      CI: "true",
      GITHUB_ACTIONS: "true",
      DATABASE_URL:
        "postgresql://postgres:postgres@postgres:5432/ruwang_arsip_ci?schema=public",
    }),
    { databaseName: "ruwang_arsip_ci", hostname: "postgres" },
  );
});

test("seed CI ditolak di luar proses CI", () => {
  assert.throws(
    () =>
      assertSafeCiDatabase({
        CI: "false",
        DATABASE_URL:
          "postgresql://postgres:postgres@127.0.0.1:5432/ruwang_arsip_ci",
      }),
    /CI=true/,
  );
});

test("seed CI menolak host non-loopback di luar service GitHub Actions", () => {
  assert.throws(
    () =>
      assertSafeCiDatabase({
        CI: "true",
        DATABASE_URL:
          "postgresql://postgres:postgres@db.internal:5432/ruwang_arsip_ci",
      }),
    /database wajib loopback/,
  );
});

test("seed CI menolak nama database tanpa penanda CI", () => {
  assert.throws(
    () =>
      assertSafeCiDatabase({
        CI: "true",
        DATABASE_URL:
          "postgresql://postgres:postgres@127.0.0.1:5432/ruwang_arsip",
      }),
    /database wajib loopback/,
  );
});

test("seed CI membuat fixture browser deterministik tanpa data geolocation", async () => {
  const payloads = {};
  const model = (name, result) => ({
    upsert: async (payload) => {
      payloads[name] = payload;
      return result;
    },
  });
  const client = {
    $transaction: async (callback) => callback(client),
    users: {
      findUnique: async (query) => {
        assert.equal(query.where.username, "ci-admin");
        return { id: "admin-ci" };
      },
    },
    financing_products: { findUnique: async () => ({ id: "product-ci" }) },
    contract_types: { findUnique: async () => ({ id: "contract-type-ci" }) },
    collectibility_levels: { findUnique: async () => ({ id: "kol-ci" }) },
    deposit_types: { findUnique: async () => ({ id: "deposit-type-ci" }) },
    digital_debtors: model("debtor", { id: "debtor-ci" }),
    debtor_contracts: model("contract", { id: "contract-ci" }),
    debtor_collectibilities: model("collectibility"),
    debtor_marketing_activities: model("marketing"),
    third_parties: model("thirdParty", { id: "notary-ci" }),
    legal_notary_progress: model("notaryProgress"),
    legal_deposits: model("deposit"),
    legal_deposit_transactions: model("depositTransaction"),
  };

  await seedCiTestData(safeEnv, client);

  assert.equal(payloads.debtor.where.debtor_number, CI_DEBTOR_NUMBER);
  assert.equal(payloads.debtor.create.created_by, "admin-ci");
  assert.equal(payloads.debtor.update.updated_by, "admin-ci");
  assert.equal(payloads.contract.where.no_kontrak, CI_CONTRACT_NUMBER);
  assert.equal(payloads.marketing.where.id, CI_MARKETING_ACTIVITY_ID);
  assert.equal(payloads.thirdParty.where.code, CI_NOTARY_CODE);
  assert.equal(payloads.notaryProgress.where.id, CI_NOTARY_PROGRESS_ID);
  assert.equal(payloads.deposit.where.id, CI_DEPOSIT_ID);
  assert.equal(payloads.depositTransaction.create.action, "PEMBAYARAN");
  assert.equal(
    Object.keys(payloads.marketing.create).some((key) =>
      /(?:lat|lon|geo|location)/i.test(key),
    ),
    false,
  );
});

test("seed CI berhenti jika parameter utama belum lengkap", async () => {
  const transactionClient = {
    financing_products: { findUnique: async () => null },
    contract_types: { findUnique: async () => ({ id: "contract-type-ci" }) },
    collectibility_levels: { findUnique: async () => ({ id: "kol-ci" }) },
    deposit_types: { findUnique: async () => ({ id: "deposit-type-ci" }) },
  };
  const client = {
    users: { findUnique: async () => ({ id: "admin-ci" }) },
    $transaction: async (callback) => callback(transactionClient),
  };

  await assert.rejects(
    () => seedCiTestData(safeEnv, client),
    /Parameter CI belum lengkap/,
  );
});

test("seed CI berhenti jika admin hasil seed utama tidak ditemukan", async () => {
  const client = {
    users: { findUnique: async () => null },
    digital_debtors: {
      upsert: async () => assert.fail("upsert tidak boleh dijalankan"),
    },
  };

  await assert.rejects(
    () => seedCiTestData(safeEnv, client),
    /Admin CI belum tersedia/,
  );
});
