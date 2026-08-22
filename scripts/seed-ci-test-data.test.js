const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CI_ACTION_PLAN_ACTIVITY_ID,
  CI_CLAIM_ID,
  CI_COLLATERAL_ID,
  CI_CONTRACT_NUMBER,
  CI_DEBTOR_NUMBER,
  CI_DEPOSIT_ID,
  CI_IDEB_FINGERPRINT,
  CI_IDEB_PENDING_FINGERPRINT,
  CI_IDEB_PENDING_UPLOAD_ID,
  CI_IDEB_UPLOAD_ID,
  CI_IMPORT_JOB_ID,
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
  const multiModel = (name) => ({
    upsert: async (payload) => {
      payloads[name] ||= [];
      payloads[name].push(payload);
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
    debtor_collaterals: model("collateral"),
    debtor_ideb_uploads: multiModel("idebUpload"),
    debtor_import_jobs: model("importJob"),
    debtor_marketing_activities: multiModel("marketing"),
    third_parties: model("thirdParty", { id: "notary-ci" }),
    legal_notary_progress: model("notaryProgress"),
    legal_claims: model("claim"),
    legal_deposits: model("deposit"),
    legal_deposit_transactions: model("depositTransaction"),
  };

  await seedCiTestData(safeEnv, client);
  await seedCiTestData(safeEnv, client);

  assert.equal(payloads.debtor.where.debtor_number, CI_DEBTOR_NUMBER);
  assert.equal(payloads.debtor.create.created_by, "admin-ci");
  assert.equal(payloads.debtor.update.updated_by, "admin-ci");
  assert.equal(payloads.contract.where.no_kontrak, CI_CONTRACT_NUMBER);
  assert.equal(payloads.collateral.where.id, CI_COLLATERAL_ID);
  const linkedIdebFixtures = payloads.idebUpload.filter(
    (payload) => payload.where.source_fingerprint === CI_IDEB_FINGERPRINT,
  );
  const pendingIdebFixtures = payloads.idebUpload.filter(
    (payload) => payload.where.source_fingerprint === CI_IDEB_PENDING_FINGERPRINT,
  );
  assert.equal(linkedIdebFixtures.length, 2);
  assert.equal(pendingIdebFixtures.length, 2);
  assert.equal(linkedIdebFixtures[0].create.id, CI_IDEB_UPLOAD_ID);
  assert.equal(linkedIdebFixtures[0].create.status, "COMPLETED");
  assert.equal(linkedIdebFixtures[0].create.debtor_id, "debtor-ci");
  assert.equal(pendingIdebFixtures[0].create.id, CI_IDEB_PENDING_UPLOAD_ID);
  assert.equal(pendingIdebFixtures[0].create.status, "MATCH_PENDING");
  assert.equal(pendingIdebFixtures[0].create.debtor_id, null);
  assert.equal(pendingIdebFixtures[0].create.contract_id, null);
  assert.notEqual(CI_IDEB_PENDING_UPLOAD_ID, CI_IDEB_UPLOAD_ID);
  assert.notEqual(CI_IDEB_PENDING_FINGERPRINT, CI_IDEB_FINGERPRINT);
  assert.equal(payloads.importJob.where.id, CI_IMPORT_JOB_ID);
  assert.equal(payloads.importJob.create.type, "SLIK");
  assert.equal(payloads.importJob.create.status, "COMPLETED");
  assert.equal(payloads.importJob.create.created_by, "admin-ci");
  const actionPlanFixture = payloads.marketing.find(
    (payload) => payload.where.id === CI_ACTION_PLAN_ACTIVITY_ID,
  );
  const handlingFixture = payloads.marketing.find(
    (payload) => payload.where.id === CI_MARKETING_ACTIVITY_ID,
  );
  assert.equal(actionPlanFixture.create.debtor_id, "debtor-ci");
  assert.equal(actionPlanFixture.create.activity_kind, "ACTION_PLAN");
  assert.equal(handlingFixture.create.activity_kind, "HANDLING_STEP");
  assert.equal(payloads.thirdParty.where.code, CI_NOTARY_CODE);
  assert.equal(payloads.notaryProgress.where.id, CI_NOTARY_PROGRESS_ID);
  assert.equal(payloads.claim.where.id, CI_CLAIM_ID);
  assert.equal(payloads.claim.create.collateral_id, CI_COLLATERAL_ID);
  assert.equal(payloads.deposit.where.id, CI_DEPOSIT_ID);
  assert.equal(payloads.depositTransaction.create.action, "PEMBAYARAN");
  assert.equal(
    payloads.marketing.some((payload) =>
      Object.keys(payload.create).some((key) =>
        /(?:lat|lon|geo|location)/i.test(key),
      ),
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
