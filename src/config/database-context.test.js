const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getDatabaseContext,
  requireDatabaseAccessPurpose,
  requireDatabaseUserId,
  runWithDatabaseAccessPurpose,
  runWithDatabaseTransactionClient,
  runWithDatabaseUserContext,
} = require("./database-context");

const USER_ID = "11111111-1111-4111-8111-111111111111";

test("konteks database memvalidasi UUID dan tidak bocor keluar callback", async () => {
  assert.throws(() => requireDatabaseUserId("bukan-uuid"), /UUID yang valid/);

  await runWithDatabaseUserContext(USER_ID, async () => {
    assert.equal(getDatabaseContext().userId, USER_ID);
    await Promise.resolve();
    assert.equal(getDatabaseContext().userId, USER_ID);
  });

  assert.deepEqual(getDatabaseContext(), {});
});

test("transaction client dapat ditumpuk tanpa menghilangkan user database", async () => {
  const transactionClient = { marker: "tx" };

  await runWithDatabaseUserContext(USER_ID, () =>
    runWithDatabaseTransactionClient(transactionClient, () => {
      assert.equal(getDatabaseContext().userId, USER_ID);
      assert.equal(getDatabaseContext().transactionClient, transactionClient);
    }),
  );
});

test("tujuan akses database dibatasi allowlist dan tetap terisolasi", async () => {
  assert.throws(
    () => requireDatabaseAccessPurpose("arbitrary_bypass"),
    /tidak dikenal/,
  );

  await runWithDatabaseUserContext(USER_ID, () =>
    runWithDatabaseAccessPurpose("digital_document_requestable", () => {
      assert.equal(getDatabaseContext().userId, USER_ID);
      assert.equal(
        getDatabaseContext().accessPurpose,
        "digital_document_requestable",
      );
    }),
  );

  assert.deepEqual(getDatabaseContext(), {});
});
