const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertSafeIntegrationDatabase,
  buildAuthorization,
  createIntegrationFixture,
  readAdminCredentials,
} = require("./integration-test-helpers");

test("guard integration menerima database loopback", () => {
  const result = assertSafeIntegrationDatabase("test", {
    DATABASE_URL: "postgresql://user:secret@127.0.0.1:5432/ruwang_arsip",
  });
  assert.equal(result.hostname, "127.0.0.1");
});

test("guard integration menerima service PostgreSQL khusus GitHub Actions", () => {
  const result = assertSafeIntegrationDatabase("test", {
    CI: "true",
    GITHUB_ACTIONS: "true",
    DATABASE_URL: "postgresql://postgres:5432/ruwang_arsip_ci",
  });
  assert.deepEqual(result, {
    databaseName: "ruwang_arsip_ci",
    hostname: "postgres",
  });
});

test("guard integration menolak service PostgreSQL di luar GitHub Actions", () => {
  assert.throws(
    () =>
      assertSafeIntegrationDatabase("test", {
        CI: "true",
        DATABASE_URL: "postgresql://postgres:5432/ruwang_arsip_ci",
      }),
    /ditolak/,
  );
});

test("guard integration menolak service GitHub Actions tanpa penanda ci/test/local", () => {
  assert.throws(
    () =>
      assertSafeIntegrationDatabase("test", {
        CI: "true",
        GITHUB_ACTIONS: "true",
        DATABASE_URL: "postgresql://postgres:5432/ruwang_arsip",
      }),
    /ditolak/,
  );
});

test("guard integration menolak database remote biasa walau bernama test", () => {
  assert.throws(
    () =>
      assertSafeIntegrationDatabase("test", {
        DATABASE_URL:
          "postgresql://db.example.invalid:5432/ruwang_arsip_test",
      }),
    /ditolak/,
  );
});

test("helper kredensial dan authorization menolak nilai kosong", () => {
  assert.throws(() => readAdminCredentials({}), /wajib diisi/);
  assert.throws(() => buildAuthorization(""), /tidak tersedia/);
  assert.deepEqual(
    readAdminCredentials({
      API_TEST_ADMIN_USERNAME: "admin-test",
      API_TEST_ADMIN_PASSWORD: "secret-test",
    }),
    { username: "admin-test", password: "secret-test" },
  );
  assert.deepEqual(buildAuthorization("access-token"), {
    Authorization: "Bearer access-token",
  });
});

test("cleanup fixture menghapus system activity log berdasarkan seluruh ID yang ditrack", async (t) => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL =
    "postgresql://user:secret@127.0.0.1:5432/ruwang_arsip_test";
  t.after(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });
  const systemActivityDeletes = [];
  const deleteMany = async () => ({ count: 0 });
  const prisma = new Proxy(
    {
      system_activity_logs: {
        async deleteMany(args) {
          systemActivityDeletes.push(args);
          return { count: 0 };
        },
      },
    },
    {
      get(target, property) {
        if (property in target) return target[property];
        return { deleteMany };
      },
    },
  );
  const fixture = createIntegrationFixture(prisma, "Cleanup system log", {
    runId: "00000000-0000-4000-8000-000000000001",
    userAgent: "RuwangArsipIntegration/cleanup-system-log/test",
  });
  fixture.track("digitalDocument", "document-fixture-id");
  fixture.track("incomingMail", "incoming-mail-fixture-id");
  fixture.track("division", "division-fixture-id");

  await fixture.cleanup();

  assert.deepEqual(systemActivityDeletes, [
    {
      where: {
        OR: [
          {
            user_agent:
              "RuwangArsipIntegration/cleanup-system-log/test",
          },
          {
            entity_id: {
              in: [
                "document-fixture-id",
                "incoming-mail-fixture-id",
                "division-fixture-id",
              ],
            },
          },
        ],
      },
    },
  ]);
});
