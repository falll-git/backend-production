const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const request = require("supertest");

const contract = require("./controlReview.contract");
const route = require("./controlReview.route");
const service = require("./controlReview.service");

const ids = Object.freeze({
  command: "10000000-0000-4000-8000-000000000001",
  instance: "10000000-0000-4000-8000-000000000002",
  operator: "10000000-0000-4000-8000-000000000003",
  resource: "10000000-0000-4000-8000-000000000004",
  nonce: "10000000-0000-4000-8000-000000000005",
  media: "10000000-0000-4000-8000-000000000007",
});

function command(now = new Date()) {
  return {
    contract_version: 1,
    command_id: ids.command,
    instance_id: ids.instance,
    actor_subject: `ruwang-control:${ids.operator}`,
    audience: "ruwang-bank:test",
    resource: { kind: "publication", id: ids.resource },
    decision: "approve",
    contributor_subjects: [
      "ruwang-bank:10000000-0000-4000-8000-000000000006",
    ],
    expected_version: 0,
    expected_checksum: "a".repeat(64),
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
  };
}

function withAdapterEnvironment(values, callback) {
  const keys = Object.keys(values);
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

test("command dan acknowledgment V1 memakai canonical Ed25519 yang sama", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const payload = command();
  assert.deepEqual(contract.validateCommand(payload), { valid: true, errors: [] });
  const digest = contract.payloadDigest(payload);
  const message = contract.signingMessage({
    method: "POST",
    path: service.COMMAND_PATH,
    timestamp: payload.issued_at,
    nonce: ids.nonce,
    contentSha256: digest,
  });
  const signature = contract.signTransport(message, privateKey);
  assert.equal(contract.verifyTransport(message, signature, publicKey), true);
  assert.equal(
    contract.verifyTransport(`${message}x`, signature, publicKey),
    false,
  );
});

test("validator menolak reason pada approve dan mewajibkannya pada revisi", () => {
  assert.equal(
    contract.validateCommand({ ...command(), reason: "tidak boleh" }).valid,
    false,
  );
  assert.equal(
    contract.validateCommand({ ...command(), decision: "request_revision" })
      .valid,
    false,
  );
  assert.equal(
    contract.validateCommand({
      ...command(),
      decision: "request_revision",
      reason: "Lengkapi foto.",
    }).valid,
    true,
  );
});

test("permintaan perubahan mewajibkan catatan dan mendukung keputusan tolak", () => {
  const lifecycle = {
    ...command(),
    resource: { kind: "change_request", id: ids.resource },
  };
  assert.equal(contract.validateCommand(lifecycle).valid, false);
  assert.equal(contract.validateCommand({ ...lifecycle, reason: "Dampak sudah diperiksa." }).valid, true);
  assert.equal(contract.validateCommand({ ...lifecycle, decision: "reject", reason: "Permintaan belum dapat dilaksanakan." }).valid, true);
  assert.equal(contract.validateCommand({ ...command(), decision: "reject", reason: "Tidak sah." }).valid, false);
});

test("request adapter mengikat instance, audience, expiry, digest dan signature", async () => {
  const control = crypto.generateKeyPairSync("ed25519");
  const bank = crypto.generateKeyPairSync("ed25519");
  const publicKey = control.publicKey.export({ type: "spki", format: "pem" });
  const acknowledgmentPrivateKey = bank.privateKey.export({
    type: "pkcs8",
    format: "pem",
  });
  const now = new Date();
  const payload = command(now);
  const digest = contract.payloadDigest(payload);
  const timestamp = now.toISOString();
  const message = contract.signingMessage({
    method: "POST",
    path: service.COMMAND_PATH,
    timestamp,
    nonce: ids.nonce,
    contentSha256: digest,
  });
  const headers = {
    [contract.headerNames.instanceId]: ids.instance,
    [contract.headerNames.keyId]: "control-test-key",
    [contract.headerNames.timestamp]: timestamp,
    [contract.headerNames.nonce]: ids.nonce,
    [contract.headerNames.contentSha256]: digest,
    [contract.headerNames.signature]: contract.signTransport(
      message,
      control.privateKey,
    ),
  };
  await withAdapterEnvironment(
    {
      SJ_CONTROL_REVIEW_AUTHORITY: "central",
      SJ_CONTROL_INSTANCE_ID: ids.instance,
      SJ_CONTROL_KEY_ID: "control-test-key",
      SJ_CONTROL_PUBLIC_KEY: publicKey,
      SJ_CONTROL_ACK_KEY_ID: "bank-test-key",
      SJ_CONTROL_ACK_PRIVATE_KEY: acknowledgmentPrivateKey,
      SJ_CONTROL_AUDIENCE: "ruwang-bank:test",
      SJ_CONTROL_MAX_CLOCK_SKEW_SECONDS: "300",
      SJ_CONTROL_NONCE_TTL_SECONDS: "600",
    },
    () => {
      const verified = service._private.verifyRequest(
        { body: payload, get: (name) => headers[name] },
        now,
      );
      assert.equal(verified.digest, digest);
      assert.throws(
        () =>
          service._private.verifyRequest(
            {
              body: payload,
              get: (name) =>
                name === contract.headerNames.signature
                  ? "invalid"
                  : headers[name],
            },
            now,
          ),
        /Signature adapter pemeriksaan ditolak/,
      );
    },
  );
});

test("endpoint internal menolak akses langsung tanpa signature sebelum database", async () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  await withAdapterEnvironment(
    {
      SJ_CONTROL_REVIEW_AUTHORITY: "central",
      SJ_CONTROL_INSTANCE_ID: ids.instance,
      SJ_CONTROL_KEY_ID: "control-test-key",
      SJ_CONTROL_PUBLIC_KEY: keys.publicKey.export({ type: "spki", format: "pem" }),
      SJ_CONTROL_ACK_KEY_ID: "bank-test-key",
      SJ_CONTROL_ACK_PRIVATE_KEY: keys.privateKey.export({ type: "pkcs8", format: "pem" }),
      SJ_CONTROL_AUDIENCE: "ruwang-bank:test",
      SJ_CONTROL_MAX_CLOCK_SKEW_SECONDS: "300",
      SJ_CONTROL_NONCE_TTL_SECONDS: "600",
    },
    async () => {
      const app = express();
      app.use(express.json());
      app.use(route);
      const response = await request(app).post("/commands").send(command());
      assert.equal(response.status, 401);
      assert.equal(response.body.success, false);
    },
  );
});

test("permintaan media reviewer mengikat metode, path, instance dan digest kosong", async () => {
  const control = crypto.generateKeyPairSync("ed25519");
  const bank = crypto.generateKeyPairSync("ed25519");
  const now = new Date();
  const digest = crypto.createHash("sha256").update("").digest("hex");
  const path = `${service.MEDIA_PATH_PREFIX}${ids.media}`;
  const message = contract.signingMessage({
    method: "GET",
    path,
    timestamp: now.toISOString(),
    nonce: ids.nonce,
    contentSha256: digest,
  });
  const headers = {
    [contract.headerNames.instanceId]: ids.instance,
    [contract.headerNames.keyId]: "control-test-key",
    [contract.headerNames.timestamp]: now.toISOString(),
    [contract.headerNames.nonce]: ids.nonce,
    [contract.headerNames.contentSha256]: digest,
    [contract.headerNames.signature]: contract.signTransport(message, control.privateKey),
  };
  await withAdapterEnvironment({
    SJ_CONTROL_REVIEW_AUTHORITY: "central",
    SJ_CONTROL_INSTANCE_ID: ids.instance,
    SJ_CONTROL_KEY_ID: "control-test-key",
    SJ_CONTROL_PUBLIC_KEY: control.publicKey.export({ type: "spki", format: "pem" }),
    SJ_CONTROL_ACK_KEY_ID: "bank-test-key",
    SJ_CONTROL_ACK_PRIVATE_KEY: bank.privateKey.export({ type: "pkcs8", format: "pem" }),
    SJ_CONTROL_AUDIENCE: "ruwang-bank:test",
    SJ_CONTROL_MAX_CLOCK_SKEW_SECONDS: "300",
    SJ_CONTROL_NONCE_TTL_SECONDS: "600",
  }, () => {
    const verified = service._private.verifyMediaRequest(
      { get: (name) => headers[name] },
      ids.media,
      now,
    );
    assert.equal(verified.path, path);
    assert.throws(() => service._private.verifyMediaRequest(
      { get: (name) => name === contract.headerNames.signature ? "invalid" : headers[name] },
      ids.media,
      now,
    ), /Permintaan media pemeriksaan ditolak/);
  });
});

test("conflict detection menolak versi, checksum, contributor dan self-review", () => {
  const payload = command();
  const validSnapshot = {
    aggregate: { id: ids.resource },
    version: { id: "version" },
    versionState: "IN_REVIEW",
    lockVersion: payload.expected_version,
    checksum: payload.expected_checksum,
    contributors: [...payload.contributor_subjects],
  };
  assert.equal(service._private.rejectionCode(validSnapshot, payload), null);
  assert.equal(
    service._private.rejectionCode(
      { ...validSnapshot, lockVersion: payload.expected_version + 1 },
      payload,
    ),
    "VERSION_CONFLICT",
  );
  assert.equal(
    service._private.rejectionCode(
      { ...validSnapshot, checksum: "b".repeat(64) },
      payload,
    ),
    "CHECKSUM_CONFLICT",
  );
  assert.equal(
    service._private.rejectionCode(
      { ...validSnapshot, contributors: ["ruwang-bank:different"] },
      payload,
    ),
    "CONTRIBUTOR_MISMATCH",
  );
  assert.equal(
    service._private.rejectionCode(
      { ...validSnapshot, contributors: [payload.actor_subject] },
      { ...payload, contributor_subjects: [payload.actor_subject] },
    ),
    "SELF_REVIEW_FORBIDDEN",
  );
});

test("baca hasil mengikat path, scope, digest dan waktu tanpa menjalankan keputusan", async () => {
  const keys = crypto.generateKeyPairSync("ed25519"), now = new Date();
  const body = { contract_version: 1, command_id: ids.command, command_digest: "a".repeat(64),
    instance_id: ids.instance, audience: "ruwang-bank:test", resource: { kind: "contact", id: ids.resource } };
  assert.equal(contract.validateResultLookup(body), true);
  for (const invalid of [{...body, decision:"approve"},{...body,command_digest:"bad"},{...body,resource:{...body.resource,hidden:true}}]) {
    assert.equal(contract.validateResultLookup(invalid),false);
  }
  const digest = contract.payloadDigest(body), timestamp = now.toISOString();
  const headers = { [contract.headerNames.instanceId]:ids.instance, [contract.headerNames.keyId]:"control-test-key",
    [contract.headerNames.timestamp]:timestamp, [contract.headerNames.nonce]:ids.nonce, [contract.headerNames.contentSha256]:digest,
    [contract.headerNames.signature]:contract.signTransport(contract.signingMessage({method:"POST",path:service.RESULT_PATH,timestamp,nonce:ids.nonce,contentSha256:digest}),keys.privateKey) };
  await withAdapterEnvironment({SJ_CONTROL_REVIEW_AUTHORITY:"central",SJ_CONTROL_INSTANCE_ID:ids.instance,SJ_CONTROL_KEY_ID:"control-test-key",
    SJ_CONTROL_PUBLIC_KEY:keys.publicKey.export({type:"spki",format:"pem"}),SJ_CONTROL_ACK_KEY_ID:"bank-test-key",
    SJ_CONTROL_ACK_PRIVATE_KEY:keys.privateKey.export({type:"pkcs8",format:"pem"}),SJ_CONTROL_AUDIENCE:"ruwang-bank:test"},async()=>{
    assert.equal(service._private.verifyResultRequest({body,get:name=>headers[name]},now).lookup.command_id,ids.command);
    assert.throws(()=>service._private.verifyResultRequest({body,get:name=>headers[name]},new Date(now.getTime()+600001)));
    assert.throws(()=>service._private.verifyResultRequest({body:{...body,instance_id:crypto.randomUUID()},get:name=>headers[name]},now));
    const wrongPath=contract.signTransport(contract.signingMessage({method:"POST",path:service.COMMAND_PATH,timestamp,nonce:ids.nonce,contentSha256:digest}),keys.privateKey);
    assert.throws(()=>service._private.verifyResultRequest({body,get:name=>name===contract.headerNames.signature?wrongPath:headers[name]},now));
    const app=express();app.use(express.json());app.use(route);
    assert.equal((await request(app).post("/command-results").send(body)).status,401);
  });
});
