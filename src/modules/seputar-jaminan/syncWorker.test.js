const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const test = require("node:test");

const { getContracts } = require("./contracts");
const {
  safeLocalErrorCode,
  signedRequest,
  syncAttemptResult,
} = require("./syncWorker.service");

test("worker menyimpan kode kegagalan lokal yang aman tanpa pesan sensitif", () => {
  const contractError = new Error("payload rahasia tidak boleh disalin");
  contractError.contractErrors = [{ keyword: "payloadChecksum" }];
  assert.equal(safeLocalErrorCode(contractError), "LOCAL_CONTRACT_PAYLOADCHECKSUM");

  const prismaError = new Error("query rahasia tidak boleh disalin");
  prismaError.name = "PrismaClientKnownRequestError";
  prismaError.code = "P2039";
  assert.equal(safeLocalErrorCode(prismaError), "LOCAL_P2039");
  assert.equal(safeLocalErrorCode(new TypeError("nilai sensitif")), "LOCAL_TYPEERROR");
});

test("status pusat dan outbox dipetakan ke vocabulary audit database", () => {
  assert.equal(syncAttemptResult("ACKNOWLEDGED"), "ACKNOWLEDGED");
  assert.equal(syncAttemptResult("RETRYING"), "RETRYABLE_ERROR");
  assert.equal(syncAttemptResult("QUARANTINED"), "QUARANTINED");
  assert.equal(syncAttemptResult("FAILED"), "PERMANENT_ERROR");
});

test("request worker memakai signature Ed25519 kanonik yang dapat diverifikasi", async (t) => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const oldKey = process.env.SJ_INTEGRATION_PRIVATE_KEY;
  process.env.SJ_INTEGRATION_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
  t.after(() => {
    if (oldKey === undefined) delete process.env.SJ_INTEGRATION_PRIVATE_KEY;
    else process.env.SJ_INTEGRATION_PRIVATE_KEY = oldKey;
  });
  const contracts = await getContracts();
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const digest = contracts.createContentSha256(body);
    assert.equal(request.headers["x-sj-content-sha256"], digest);
    const message = contracts.createSigningMessage({
      method: request.method,
      path: request.url,
      timestamp: request.headers["x-sj-timestamp"],
      nonce: request.headers["x-sj-nonce"],
      contentSha256: digest,
    });
    assert.equal(
      contracts.verifyIntegrationMessage(
        message,
        request.headers["x-sj-signature"],
        publicKey,
      ),
      true,
    );
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ status: "APPLIED" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const result = await signedRequest(
    {
      institution_id: "00000000-0000-4000-8000-000000000001",
      key_id: "00000000-0000-4000-8000-000000000002",
      central_base_url: `http://127.0.0.1:${address.port}`,
    },
    "POST",
    "/v1/ingest/events",
    { safe: true },
  );
  assert.equal(result.status, "APPLIED");
});
