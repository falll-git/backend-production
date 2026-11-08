const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const test = require("node:test");

const { getContracts } = require("./contracts");
const {
  deliverControlSnapshot,
  mediaRetryState,
  safeLocalErrorCode,
  signedRequest,
  syncAttemptResult,
} = require("./syncWorker.service");
const controlContract = require("./controlReview.contract");

test('old or missing snapshot installation is rejected before signing or network access', async (t) => {
  const oldFetch=global.fetch;
  let calls=0;
  global.fetch=async()=>{calls++;throw Error('Network must not be reached');};
  t.after(()=>{global.fetch=oldFetch;});
  for(const [payload,settings,code] of [
    [{instance_id:crypto.randomUUID()},{installation_id:crypto.randomUUID()},'CONTROL_SNAPSHOT_INSTANCE_MISMATCH'],
    [{},{installation_id:crypto.randomUUID()},'CONTROL_SNAPSHOT_INSTANCE_MISSING'],
    [{instance_id:crypto.randomUUID()},null,'CONTROL_SNAPSHOT_INSTANCE_MISSING'],
  ]) {
    const original=JSON.stringify(payload);
    await assert.rejects(deliverControlSnapshot({payload_json:payload,payload_checksum:controlContract.payloadDigest(payload)},settings),e=>e.code===code&&e.retryable===false);
    assert.equal(JSON.stringify(payload),original);
  }
  assert.equal(calls,0);
});

test('ingest ACK validates actual SJ fields and does not fabricate checksum echoes',()=>{
  const {validateIngestAcknowledgment:validate}=require('./syncWorker.service');
  const row={event_id:crypto.randomUUID(),aggregate_version:3};
  const ack={request_id:crypto.randomUUID(),event_id:row.event_id,status:'APPLIED',active_aggregate_version:3,acknowledged_at:new Date().toISOString()};
  assert.equal(validate(ack,row),ack);
  assert.equal(validate({...ack,status:'DUPLICATE',active_aggregate_version:4},row).active_aggregate_version,4);
  for(const broken of [{},null,[],{...ack,event_id:crypto.randomUUID()},{...ack,active_aggregate_version:2},{...ack,active_aggregate_version:4},{...ack,status:'RECEIVED'},{...ack,acknowledged_at:'invalid'},{...ack,request_id:null}])assert.throws(()=>validate(broken,row),/tidak sesuai/);
});
test('HTTP retry policy respects explicit SJ retryability without retrying authority conflicts',()=>{
  const {retryableResponse:r}=require('./syncWorker.service');
  assert.equal(r(503,{retryable:false}),false);assert.equal(r(503,{retryable:true}),true);
  assert.equal(r(429,{}),true);assert.equal(r(409,{retryable:true}),false);assert.equal(r(401,{}),false);
});

test('connection lost while reading the response remains retryable, malformed JSON does not',async t=>{
  const oldFetch=global.fetch,oldKey=process.env.SJ_INTEGRATION_PRIVATE_KEY;
  process.env.SJ_INTEGRATION_PRIVATE_KEY=crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'});
  t.after(()=>{global.fetch=oldFetch;if(oldKey===undefined)delete process.env.SJ_INTEGRATION_PRIVATE_KEY;else process.env.SJ_INTEGRATION_PRIVATE_KEY=oldKey;});
  const settings={central_base_url:'http://127.0.0.1:1',institution_id:crypto.randomUUID(),key_id:crypto.randomUUID()};
  for(const [error,retryable] of [[new TypeError('terminated'),true],[new SyntaxError('bad JSON'),false]]){
    global.fetch=async()=>({ok:true,status:200,json:async()=>{throw error;}});
    await assert.rejects(signedRequest(settings,'POST','/v1/ingest/events',{}),e=>e.retryable===retryable);
  }
});

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

test("retry polling media mempertahankan sesi pusat yang sudah dibuat", () => {
  assert.equal(mediaRetryState("PROCESSING"), "PROCESSING");
  assert.equal(mediaRetryState("UPLOAD_PENDING"), "UPLOAD_PENDING");
  assert.equal(mediaRetryState("UPLOADED"), "UPLOADED");
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

test("snapshot pemeriksaan memakai signature bank dan memverifikasi acknowledgment Control", async (t) => {
  let receivedAtOverride;
  const bankKeys = crypto.generateKeyPairSync("ed25519");
  const controlKeys = crypto.generateKeyPairSync("ed25519");
  const instanceId = "10000000-0000-4000-8000-000000000011";
  const snapshotId = "10000000-0000-4000-8000-000000000012";
  const payload = { contract_version: 1, snapshot_id: snapshotId, instance_id: instanceId };
  const previous = Object.fromEntries([
    "SJ_CONTROL_BASE_URL", "SJ_CONTROL_ACK_KEY_ID", "SJ_CONTROL_ACK_PRIVATE_KEY",
    "SJ_CONTROL_KEY_ID", "SJ_CONTROL_PUBLIC_KEY", "SJ_CONTROL_MAX_CLOCK_SKEW_SECONDS",
  ].map((key) => [key, process.env[key]]));
  process.env.SJ_CONTROL_ACK_KEY_ID = "bank-ack-v1";
  process.env.SJ_CONTROL_ACK_PRIVATE_KEY = bankKeys.privateKey.export({ type: "pkcs8", format: "pem" });
  process.env.SJ_CONTROL_KEY_ID = "control-v1";
  process.env.SJ_CONTROL_PUBLIC_KEY = controlKeys.publicKey.export({ type: "spki", format: "pem" });
  process.env.SJ_CONTROL_MAX_CLOCK_SKEW_SECONDS = "300";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const digest = controlContract.payloadDigest(JSON.parse(body));
    assert.equal(request.headers[controlContract.headerNames.instanceId], instanceId);
    assert.equal(request.headers[controlContract.headerNames.acknowledgmentContentSha256], digest);
    const requestMessage = controlContract.signingMessage({
      method: "POST",
      path: request.url,
      timestamp: request.headers[controlContract.headerNames.acknowledgmentTimestamp],
      nonce: request.headers[controlContract.headerNames.acknowledgmentNonce],
      contentSha256: digest,
    });
    assert.equal(controlContract.verifyTransport(
      requestMessage,
      request.headers[controlContract.headerNames.acknowledgmentSignature],
      bankKeys.publicKey,
    ), true);

    const acknowledgment = {
      contract_version: 1,
      snapshot_id: snapshotId,
      instance_id: instanceId,
      status: "ACCEPTED",
      received_at: receivedAtOverride === undefined ? new Date().toISOString() : receivedAtOverride,
    };
    const responseBody = controlContract.canonicalJson(acknowledgment);
    const responseDigest = controlContract.payloadDigest(acknowledgment);
    const timestamp = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const responseMessage = controlContract.signingMessage({
      method: "POST", path: request.url, timestamp, nonce, contentSha256: responseDigest,
    });
    response.writeHead(202, {
      "content-type": "application/json",
      [controlContract.headerNames.keyId]: "control-v1",
      [controlContract.headerNames.timestamp]: timestamp,
      [controlContract.headerNames.nonce]: nonce,
      [controlContract.headerNames.contentSha256]: responseDigest,
      [controlContract.headerNames.signature]: controlContract.signTransport(responseMessage, controlKeys.privateKey),
    });
    response.end(responseBody);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  process.env.SJ_CONTROL_BASE_URL = `http://127.0.0.1:${server.address().port}`;

  const result = await deliverControlSnapshot({
    aggregate_id: snapshotId,
    payload_json: payload,
    payload_checksum: controlContract.payloadDigest(payload),
  }, { installation_id: instanceId });
  assert.equal(result.http_status, 202);
  assert.equal(result.request_id, null);
  for (const invalid of [null, '', 'bukan-tanggal']) {
    receivedAtOverride = invalid;
    await assert.rejects(deliverControlSnapshot({
      aggregate_id: snapshotId, payload_json: payload,
      payload_checksum: controlContract.payloadDigest(payload),
    }, { installation_id: instanceId }), error => error.code === 'CONTROL_RESPONSE_SIGNATURE_INVALID');
  }
});
