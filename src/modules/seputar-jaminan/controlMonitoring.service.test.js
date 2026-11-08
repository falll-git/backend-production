const assert = require("node:assert/strict");
const { generateKeyPairSync, randomUUID } = require("node:crypto");
const test = require("node:test");
const prismaSystem = require("../../config/prisma-system");
const healthService = require("../../system/health.service");
const heartbeat = require("../../system/worker-heartbeat");
const contract = require("./controlMonitoring.contract");

test("endpoint monitoring Ruwang memverifikasi Control, menolak replay, dan menandatangani proyeksi minimum", async (t) => {
  const originalEnvironment = { ...process.env };
  const originalFetch = global.fetch;
  const replacements = [
    [prismaSystem, "$transaction", prismaSystem.$transaction],
    [healthService, "checkReadiness", healthService.checkReadiness],
    [heartbeat, "checkSeputarJaminanWorkerHealth", heartbeat.checkSeputarJaminanWorkerHealth],
    [prismaSystem.sj_integration_settings, "findFirst", prismaSystem.sj_integration_settings.findFirst],
    [prismaSystem.sj_publication_versions, "count", prismaSystem.sj_publication_versions.count],
    [prismaSystem.sj_public_profile_versions, "count", prismaSystem.sj_public_profile_versions.count],
    [prismaSystem.sj_whatsapp_contact_versions, "count", prismaSystem.sj_whatsapp_contact_versions.count],
    [prismaSystem.sj_sync_outbox, "groupBy", prismaSystem.sj_sync_outbox.groupBy],
    [prismaSystem.sj_media_assets, "groupBy", prismaSystem.sj_media_assets.groupBy],
  ];
  t.after(() => {
    process.env = originalEnvironment;
    global.fetch = originalFetch;
    for (const [target, key, value] of replacements) target[key] = value;
    delete require.cache[require.resolve("./controlMonitoring.service")];
  });

  const controlKeys = generateKeyPairSync("ed25519");
  const responseKeys = generateKeyPairSync("ed25519");
  const instanceId = randomUUID();
  Object.assign(process.env, {
    NODE_ENV: "test",
    SJ_CONTROL_MONITORING_ENABLED: "true",
    SJ_CONTROL_INSTANCE_ID: instanceId,
    SJ_CONTROL_KEY_ID: "control-monitor-key",
    SJ_CONTROL_PUBLIC_KEY: controlKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    SJ_CONTROL_ACK_KEY_ID: "bank-monitor-response",
    SJ_CONTROL_ACK_PRIVATE_KEY: responseKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    SJ_CONTROL_AUDIENCE: "ruwang-control-test",
    SJ_CONTROL_MONITORING_FRONTEND_URL: "http://127.0.0.1:3000",
    SJ_CONTROL_MONITORING_PROBE_TIMEOUT_MS: "100",
    SJ_CONTROL_MAX_CLOCK_SKEW_SECONDS: "300",
    SJ_CONTROL_NONCE_TTL_SECONDS: "600",
  });
  global.fetch = async () => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } });
  healthService.checkReadiness = async () => ({ ready: true, state: "ready" });
  heartbeat.checkSeputarJaminanWorkerHealth = async () => ({ workers_available: true });
  const seenNonces = new Set();
  prismaSystem.$transaction = async work => work({ sj_control_request_nonces: {
    deleteMany: async () => ({ count: 0 }),
    create: async ({ data }) => {
      if (seenNonces.has(data.nonce)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
      seenNonces.add(data.nonce);
      return data;
    },
  } });
  prismaSystem.sj_integration_settings.findFirst = async () => ({ connection_state: "ACTIVE", sync_enabled: true });
  prismaSystem.sj_publication_versions.count = async () => 1;
  prismaSystem.sj_public_profile_versions.count = async () => 0;
  prismaSystem.sj_whatsapp_contact_versions.count = async () => 0;
  prismaSystem.sj_sync_outbox.groupBy = async () => [];
  prismaSystem.sj_media_assets.groupBy = async () => [];
  delete require.cache[require.resolve("./controlMonitoring.service")];
  const service = require("./controlMonitoring.service");

  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  const message = contract.signingMessage({ method: "GET", path: contract.PATH, timestamp, nonce, contentSha256: contract.EMPTY_DIGEST });
  const headers = {
    [contract.headerNames.instanceId]: instanceId,
    [contract.headerNames.keyId]: "control-monitor-key",
    [contract.headerNames.timestamp]: timestamp,
    [contract.headerNames.nonce]: nonce,
    [contract.headerNames.contentSha256]: contract.EMPTY_DIGEST,
    [contract.headerNames.signature]: contract.signTransport(message, controlKeys.privateKey),
    "x-rc-audience": "ruwang-control-test",
  };
  const request = { get: name => headers[String(name).toLowerCase()] ?? "" };
  const result = await service.snapshot(request);
  const snapshot = JSON.parse(result.body);
  assert.equal(contract.validateSnapshot(snapshot), true);
  assert.equal(snapshot.instance_id, instanceId);
  assert.equal(snapshot.services.length, 5);
  assert.deepEqual(Object.keys(snapshot).sort(), ["contract_version", "instance_id", "observed_at", "queues", "services", "source_kind"]);
  const responseMessage = contract.signingMessage({ method: "GET", path: contract.PATH,
    timestamp: result.headers[contract.headerNames.acknowledgmentTimestamp],
    nonce: result.headers[contract.headerNames.acknowledgmentNonce],
    contentSha256: result.headers[contract.headerNames.acknowledgmentContentSha256] });
  assert.equal(contract.verifyTransport(responseMessage,
    result.headers[contract.headerNames.acknowledgmentSignature], responseKeys.publicKey), true);
  await assert.rejects(() => service.snapshot(request), error => error.statusCode === 409);
  await assert.rejects(() => service.snapshot({ get: () => "" }), error => error.statusCode === 401);
});
