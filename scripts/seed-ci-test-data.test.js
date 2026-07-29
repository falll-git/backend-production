const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CI_DEBTOR_NUMBER,
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

test("seed CI membuat fixture minimal tanpa data geolocation", async () => {
  let upsertPayload;
  const client = {
    users: {
      findUnique: async (query) => {
        assert.equal(query.where.username, "ci-admin");
        return { id: "admin-ci" };
      },
    },
    digital_debtors: {
      upsert: async (payload) => {
        upsertPayload = payload;
      },
    },
  };

  await seedCiTestData(safeEnv, client);

  assert.equal(upsertPayload.where.debtor_number, CI_DEBTOR_NUMBER);
  assert.equal(upsertPayload.create.created_by, "admin-ci");
  assert.equal(upsertPayload.update.updated_by, "admin-ci");
  assert.equal(
    Object.keys(upsertPayload.create).some((key) => /(?:lat|lon|geo|location)/i.test(key)),
    false,
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
