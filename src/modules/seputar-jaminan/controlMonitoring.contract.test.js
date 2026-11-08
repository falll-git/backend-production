const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const contract = require("./controlMonitoring.contract");

const instanceId = "50000000-0000-4000-8000-000000000001";

test("kontrak snapshot monitoring Ruwang hanya menerima data operasional minimal", () => {
  const snapshot = {
    contract_version: 1,
    instance_id: instanceId,
    source_kind: "ruwang",
    observed_at: "2026-09-10T10:00:00.000Z",
    services: [
      { key: "frontend", status: "healthy" },
      { key: "api", status: "healthy" },
      { key: "worker", status: "degraded", detail_code: "SJ_WORKER_HEARTBEAT_MISSING" },
    ],
    queues: [{ key: "outbox", status: "healthy", depth: 0 }],
  };
  assert.equal(contract.validateSnapshot(snapshot), true);
  assert.equal(contract.validateSnapshot({ ...snapshot, uptime: 100 }), false);
  assert.equal(contract.validateSnapshot({ ...snapshot, environment: { DATABASE_URL: "blocked" } }), false);
  assert.equal(contract.validateSnapshot({ ...snapshot, instance_id: "bukan-uuid" }), false);
});

test("signature snapshot monitoring terikat method, path, nonce, dan digest", () => {
  const pair = crypto.generateKeyPairSync("ed25519");
  const fields = { method: "GET", path: contract.PATH, timestamp: "2026-09-10T10:00:00.000Z",
    nonce: crypto.randomUUID(), contentSha256: contract.EMPTY_DIGEST };
  const message = contract.signingMessage(fields);
  const signature = contract.signTransport(message, pair.privateKey);
  assert.equal(contract.verifyTransport(message, signature, pair.publicKey), true);
  assert.equal(contract.verifyTransport(contract.signingMessage({ ...fields, path: contract.PATH + "/lain" }), signature, pair.publicKey), false);
});
