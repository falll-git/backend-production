const crypto = require("node:crypto");
const prismaSystem = require("../../config/prisma-system");
const healthService = require("../../system/health.service");
const { checkSeputarJaminanWorkerHealth } = require("../../system/worker-heartbeat");
const { AppError } = require("../../utils/errors");
const contract = require("./controlMonitoring.contract");

function positive(key, fallback) {
  const value = Number(process.env[key] || fallback);
  if (!Number.isInteger(value) || value < 1) throw new AppError(`Konfigurasi ${key} tidak valid.`, 503);
  return value;
}
function config() {
  if (String(process.env.SJ_CONTROL_MONITORING_ENABLED || "false").toLowerCase() !== "true") throw new AppError("Monitoring Control belum diaktifkan.", 503);
  const value = {
    instanceId: String(process.env.SJ_CONTROL_INSTANCE_ID || "").trim(), keyId: String(process.env.SJ_CONTROL_KEY_ID || "").trim(),
    publicKey: String(process.env.SJ_CONTROL_PUBLIC_KEY || "").trim(), responseKeyId: String(process.env.SJ_CONTROL_ACK_KEY_ID || "").trim(),
    responsePrivateKey: String(process.env.SJ_CONTROL_ACK_PRIVATE_KEY || "").trim(), audience: String(process.env.SJ_CONTROL_AUDIENCE || "").trim(),
    frontendUrl: String(process.env.SJ_CONTROL_MONITORING_FRONTEND_URL || "").trim(), skewSeconds: positive("SJ_CONTROL_MAX_CLOCK_SKEW_SECONDS", 300),
    nonceTtlSeconds: positive("SJ_CONTROL_NONCE_TTL_SECONDS", 600), timeoutMs: positive("SJ_CONTROL_MONITORING_PROBE_TIMEOUT_MS", 2500),
  };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.instanceId) || !value.keyId || !value.publicKey || !value.responseKeyId || !value.responsePrivateKey || !value.audience || !value.frontendUrl) {
    throw new AppError("Konfigurasi monitoring Control belum lengkap.", 503);
  }
  return value;
}
function requestHeaders(request) {
  return { instanceId: String(request.get(contract.headerNames.instanceId) || "").trim(), keyId: String(request.get(contract.headerNames.keyId) || "").trim(),
    timestamp: String(request.get(contract.headerNames.timestamp) || "").trim(), nonce: String(request.get(contract.headerNames.nonce) || "").trim(),
    digest: String(request.get(contract.headerNames.contentSha256) || "").trim(), signature: String(request.get(contract.headerNames.signature) || "").trim(),
    audience: String(request.get("x-rc-audience") || "").trim() };
}
async function verifyRequest(request, now) {
  const settings = config();
  const headers = requestHeaders(request);
  const requestTime = Date.parse(headers.timestamp);
  if (headers.instanceId !== settings.instanceId || headers.keyId !== settings.keyId || headers.audience !== settings.audience ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(headers.nonce) || headers.digest !== contract.EMPTY_DIGEST || !Number.isFinite(requestTime) ||
      Math.abs(now.getTime() - requestTime) > settings.skewSeconds * 1000 || !contract.verifyTransport(contract.signingMessage({ method: "GET", path: contract.PATH,
        timestamp: headers.timestamp, nonce: headers.nonce, contentSha256: headers.digest }), headers.signature, settings.publicKey)) {
    throw new AppError("Koneksi monitoring Control ditolak.", 401);
  }
  await prismaSystem.$transaction(async client => {
    await client.sj_control_request_nonces.deleteMany({ where: { expires_at: { lte: now } } });
    try { await client.sj_control_request_nonces.create({ data: { instance_id: settings.instanceId, key_id: settings.keyId,
      nonce: headers.nonce, expires_at: new Date(now.getTime() + settings.nonceTtlSeconds * 1000) } }); }
    catch (error) { if (error?.code === "P2002") throw new AppError("Request monitoring sudah pernah diterima.", 409); throw error; }
  });
  return settings;
}
async function probeFrontend(settings) {
  let url;
  try { url = new URL(settings.frontendUrl); } catch { return { key: "frontend", status: "unknown", detail_code: "FRONTEND_PROBE_INVALID" }; }
  const loopback = ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (process.env.NODE_ENV === "production" ? url.protocol !== "https:" : url.protocol !== "https:" && !(loopback && url.protocol === "http:"))) {
    return { key: "frontend", status: "unknown", detail_code: "FRONTEND_PROBE_INVALID" };
  }
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), settings.timeoutMs);
  try { const response = await fetch(url, { method: "GET", redirect: "error", signal: controller.signal, headers: { accept: "text/html" } });
    return response.ok ? { key: "frontend", status: "healthy" } : { key: "frontend", status: "degraded", detail_code: "FRONTEND_HTTP_ERROR" }; }
  catch { return { key: "frontend", status: "degraded", detail_code: "FRONTEND_UNREACHABLE" }; }
  finally { clearTimeout(timeout); }
}
async function buildSnapshot(settings, now) {
  const [frontend, readiness, worker, integration, reviewCounts, outboxCounts, mediaCounts] = await Promise.all([
    probeFrontend(settings), healthService.checkReadiness({ force: true }), checkSeputarJaminanWorkerHealth().catch(() => null),
    prismaSystem.sj_integration_settings.findFirst({ select: { connection_state: true, sync_enabled: true } }),
    Promise.all([prismaSystem.sj_publication_versions.count({ where: { state: "IN_REVIEW" } }), prismaSystem.sj_public_profile_versions.count({ where: { state: "IN_REVIEW" } }), prismaSystem.sj_whatsapp_contact_versions.count({ where: { state: "IN_REVIEW" } })]),
    prismaSystem.sj_sync_outbox.groupBy({ by: ["state"], _count: { _all: true } }), prismaSystem.sj_media_assets.groupBy({ by: ["state"], _count: { _all: true } }),
  ]);
  const count = (rows, states) => rows.filter(row => states.includes(row.state)).reduce((sum, row) => sum + row._count._all, 0);
  const outboxPending = count(outboxCounts, ["QUEUED", "SENDING", "RETRYING"]); const outboxBad = count(outboxCounts, ["FAILED", "QUARANTINED"]);
  const mediaPending = count(mediaCounts, ["UPLOAD_PENDING", "UPLOADED", "PROCESSING"]); const mediaBad = count(mediaCounts, ["REJECTED"]);
  const snapshot = { contract_version: 1, instance_id: settings.instanceId, source_kind: "ruwang", observed_at: now.toISOString(),
    services: [frontend, { key: "api", status: "healthy" }, { key: "readiness", status: readiness.ready ? readiness.state === "degraded" ? "degraded" : "healthy" : "degraded", ...(readiness.ready ? {} : { detail_code: "API_NOT_READY" }) },
      worker?.workers_available ? { key: "worker", status: "healthy" } : { key: "worker", status: "degraded", detail_code: "SJ_WORKER_HEARTBEAT_MISSING" },
      !integration ? { key: "pipeline", status: "unknown", detail_code: "SJ_PIPELINE_NOT_CONFIGURED" } : integration.connection_state === "ACTIVE" && integration.sync_enabled ? { key: "pipeline", status: outboxBad || mediaBad ? "degraded" : "healthy" } : { key: "pipeline", status: "degraded", detail_code: "SJ_PIPELINE_INACTIVE" }],
    queues: [{ key: "review", status: "healthy", depth: reviewCounts.reduce((sum, value) => sum + value, 0) },
      { key: "outbox", status: outboxBad ? "degraded" : "healthy", depth: outboxPending, ...(outboxBad ? { detail_code: "OUTBOX_FAILED_ITEMS" } : {}) },
      { key: "media", status: mediaBad ? "degraded" : "healthy", depth: mediaPending, ...(mediaBad ? { detail_code: "MEDIA_REJECTED_ITEMS" } : {}) }],
  };
  if (!contract.validateSnapshot(snapshot)) throw new AppError("Snapshot monitoring tidak valid.", 500);
  return snapshot;
}
function signSnapshot(snapshot, settings) {
  const body = contract.canonicalJson(snapshot); const digest = contract.payloadDigest(snapshot); const timestamp = new Date().toISOString(); const nonce = crypto.randomUUID();
  const message = contract.signingMessage({ method: "GET", path: contract.PATH, timestamp, nonce, contentSha256: digest });
  return { body, headers: { [contract.headerNames.acknowledgmentKeyId]: settings.responseKeyId,
    [contract.headerNames.acknowledgmentTimestamp]: timestamp, [contract.headerNames.acknowledgmentNonce]: nonce,
    [contract.headerNames.acknowledgmentContentSha256]: digest, [contract.headerNames.acknowledgmentSignature]: contract.signTransport(message, settings.responsePrivateKey) } };
}
exports.snapshot = async (request, now = new Date()) => { const settings = await verifyRequest(request, now); return signSnapshot(await buildSnapshot(settings, now), settings); };
exports._private = { buildSnapshot, config, probeFrontend, requestHeaders, verifyRequest };
