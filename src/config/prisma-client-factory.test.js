const assert = require("node:assert/strict");
const test = require("node:test");

const {
  runWithDatabaseAccessPurpose,
  runWithDatabaseTransactionClient,
  runWithDatabaseUserContext,
} = require("./database-context");
const {
  createContextualPrismaProxy,
  createRlsQueryHandler,
} = require("./prisma-client-factory");

const USER_ID = "11111111-1111-4111-8111-111111111111";

test("query beridentitas memasang kedua GUC dan query dalam satu batch transaction", async () => {
  const calls = [];
  const baseClient = {
    $executeRaw(strings, ...values) {
      calls.push({ type: "context", sql: strings.join("?"), values });
      return Promise.resolve("context-set");
    },
    async $transaction(queries) {
      calls.push({ type: "transaction", size: queries.length });
      return Promise.all(queries);
    },
  };
  const handler = createRlsQueryHandler(baseClient);

  const result = await runWithDatabaseUserContext(USER_ID, () =>
    runWithDatabaseAccessPurpose("digital_document_requestable", () =>
      handler({
        args: { where: { id: "document-1" } },
        query: async () => "row",
      }),
    ),
  );

  assert.equal(result, "row");
  assert.equal(calls[0].type, "context");
  assert.match(calls[0].sql, /app\.current_user_id/);
  assert.match(calls[0].sql, /app\.access_purpose/);
  assert.deepEqual(calls[0].values, [
    USER_ID,
    "digital_document_requestable",
  ]);
  assert.deepEqual(calls[1], { type: "transaction", size: 2 });
});

test("query tanpa user atau di dalam transaction tidak membuat batch baru", async () => {
  let transactionCount = 0;
  const handler = createRlsQueryHandler({
    $executeRaw() {
      throw new Error("tidak boleh dipanggil");
    },
    async $transaction() {
      transactionCount += 1;
      return [];
    },
  });

  assert.equal(await handler({ args: {}, query: async () => "public" }), "public");

  await runWithDatabaseUserContext(USER_ID, () =>
    runWithDatabaseTransactionClient({ marker: "tx" }, async () => {
      assert.equal(
        await handler({ args: {}, query: async () => "inside" }),
        "inside",
      );
    }),
  );
  assert.equal(transactionCount, 0);
});

test("proxy mengarahkan delegate ke transaction client aktif", async () => {
  const defaultClient = {
    records: { source: "default" },
    marker() {
      return "default";
    },
  };
  const transactionClient = {
    records: { source: "transaction" },
    marker() {
      return "transaction";
    },
  };
  const proxy = createContextualPrismaProxy(defaultClient);

  assert.equal(proxy.records.source, "default");
  assert.equal(proxy.marker(), "default");
  await runWithDatabaseTransactionClient(transactionClient, () => {
    assert.equal(proxy.records.source, "transaction");
    assert.equal(proxy.marker(), "transaction");
  });
});
