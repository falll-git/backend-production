const crypto = require("node:crypto");

const prisma = require("../../config/prisma");
const { getContracts } = require("./contracts");
const { createMediaStorage } = require("./mediaStorage");
const { createOutbox } = require("./seputarJaminan.service");
const {
  canonicalJson: controlCanonicalJson,
  headerNames: controlHeaderNames,
  payloadDigest: controlPayloadDigest,
  signTransport: signControlTransport,
  signingMessage: controlSigningMessage,
  verifyTransport: verifyControlTransport,
} = require("./controlReview.contract");
const {
  SNAPSHOT_EVENT_TYPE,
} = require("./controlReviewSnapshot.service");

const MAX_ATTEMPTS = 8;
const lease = require('./outboxLease');
function requestTimeoutMs(){
  const ms=Number(process.env.SJ_CENTRAL_REQUEST_TIMEOUT_MS||30000);
  if(!Number.isInteger(ms)||ms<100||ms>120000)throw Error('SJ_CENTRAL_REQUEST_TIMEOUT_MS_INVALID');
  return ms;
}

function retryableResponse(status,body){
  if([401,403,404,409,422].includes(status))return false;
  return typeof body?.retryable==='boolean'?body.retryable:[408,425,429].includes(status)||status>=500;
}
function validateIngestAcknowledgment(body,row){
  // Exact fields returned by SJ apps/api/src/app.ts. SJ does not echo checksum
  // or aggregate ID: those are validated in the immutable outgoing envelope.
  const keys=['request_id','status','event_id','active_aggregate_version','acknowledged_at'];
  const valid=body && !Array.isArray(body) && typeof body==='object' && Object.keys(body).every(k=>keys.includes(k))
    && typeof body.request_id==='string' && body.request_id.length>0 && body.request_id.length<=200
    && ['APPLIED','DUPLICATE'].includes(body.status) && body.event_id===row.event_id
    && Number.isSafeInteger(body.active_aggregate_version) && body.active_aggregate_version>=row.aggregate_version
    && (body.status!=='APPLIED'||body.active_aggregate_version===row.aggregate_version)
    && typeof body.acknowledged_at==='string' && Number.isFinite(Date.parse(body.acknowledged_at));
  if(!valid)throw new CentralRequestError('Respons penerimaan SJ tidak sesuai.',{code:'CENTRAL_ACK_INVALID'});
  return body;
}

class CentralRequestError extends Error {
  constructor(message, { status = null, code = "CENTRAL_REQUEST_FAILED", retryable = false } = {}) {
    super(message);
    this.status = status;
    this.code = String(code || "CENTRAL_REQUEST_FAILED").replace(/[^A-Z0-9_]/g, "_").slice(0, 100);
    this.retryable = retryable;
  }
}

function safeLocalErrorCode(error) {
  if (error instanceof CentralRequestError) return error.code;
  const contractKeyword = error?.contractErrors?.[0]?.keyword;
  if (contractKeyword) {
    return `LOCAL_CONTRACT_${String(contractKeyword).replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`.slice(0, 100);
  }
  const source = ["PrismaClientKnownRequestError", "PrismaClientUnknownRequestError"].includes(error?.name)
    ? error?.code || error?.name
    : error?.name;
  const normalized = String(source || "EVENT_INVALID")
    .replace(/[^A-Za-z0-9]/g, "_")
    .toUpperCase()
    .slice(0, 80);
  return `LOCAL_${normalized}`;
}

function syncAttemptResult(outboxState) {
  if (outboxState === "ACKNOWLEDGED") return "ACKNOWLEDGED";
  if (outboxState === "RETRYING") return "RETRYABLE_ERROR";
  if (outboxState === "QUARANTINED") return "QUARANTINED";
  return "PERMANENT_ERROR";
}

function mediaRetryState(currentState) {
  return ["UPLOAD_PENDING", "PROCESSING"].includes(currentState)
    ? currentState
    : "UPLOADED";
}

function privateKey() {
  const value = String(process.env.SJ_INTEGRATION_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
  if (!value) throw new Error("SJ_INTEGRATION_PRIVATE_KEY belum diisi.");
  return value;
}

function baseUrl(settings) {
  return String(settings.central_base_url).replace(/\/+$/, "");
}

async function signedRequest(settings, method, requestPath, payload) {
  const contracts = await getContracts();
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomBytes(24).toString("base64url");
  const digest = contracts.createContentSha256(body);
  const message = contracts.createSigningMessage({
    method,
    path: requestPath,
    timestamp,
    nonce,
    contentSha256: digest,
  });
  const signature = contracts.signIntegrationMessage(message, privateKey());
  let response;
  try {
    response = await fetch(`${baseUrl(settings)}${requestPath}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-SJ-Institution-Id": settings.institution_id,
        "X-SJ-Key-Id": settings.key_id,
        "X-SJ-Timestamp": timestamp,
        "X-SJ-Nonce": nonce,
        "X-SJ-Content-SHA256": digest,
        "X-SJ-Signature": signature,
      },
      body: body || undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(requestTimeoutMs()),
    });
  } catch {
    throw new CentralRequestError("Pusat belum dapat dihubungi.", {
      code: "CENTRAL_UNREACHABLE",
      retryable: true,
    });
  }
  let responseBody;
  try{responseBody=requestPath==='/v1/integration/delivery-evidence'
    ? await require('./deliveryEvidence').readEvidenceBody(response) : await response.json();}catch(error){
    if(error.name!=='SyntaxError')throw new CentralRequestError('Pusat tidak selesai merespons.',{code:'CENTRAL_RESPONSE_INTERRUPTED',retryable:true});
    responseBody=null;
  }
  if (!response.ok) {
    const code = responseBody?.error?.code || responseBody?.code || `HTTP_${response.status}`;
    throw new CentralRequestError("Pusat menolak permintaan sinkronisasi.", {
      status: response.status,
      code,
      retryable: retryableResponse(response.status,responseBody),
    });
  }
  if(!responseBody || typeof responseBody!=='object' || Array.isArray(responseBody))throw new CentralRequestError('Respons pusat bukan JSON object.',{code:'CENTRAL_RESPONSE_INVALID'});
  return responseBody;
}

function controlBaseUrl() {
  const raw = String(process.env.SJ_CONTROL_BASE_URL || "").trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CentralRequestError("Alamat Ruwang Control tidak valid.", {
      code: "CONTROL_URL_INVALID",
    });
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new CentralRequestError("Alamat Ruwang Control tidak aman.", {
      code: "CONTROL_URL_INVALID",
    });
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/+$/, "");
}

function controlAcknowledgmentPrivateKey() {
  const value = String(process.env.SJ_CONTROL_ACK_PRIVATE_KEY || "")
    .replace(/\\n/g, "\n")
    .trim();
  if (!value.includes("PRIVATE KEY")) {
    throw new CentralRequestError("Kunci pengiriman snapshot tidak valid.", {
      code: "CONTROL_ACK_PRIVATE_KEY_INVALID",
    });
  }
  return value;
}

function controlPublicKey() {
  const value = String(process.env.SJ_CONTROL_PUBLIC_KEY || "")
    .replace(/\\n/g, "\n")
    .trim();
  if (!value.includes("PUBLIC KEY")) {
    throw new CentralRequestError("Kunci verifikasi Control tidak valid.", {
      code: "CONTROL_PUBLIC_KEY_INVALID",
    });
  }
  return value;
}

async function deliverControlSnapshot(row, activeSettings) {
  const targetBlock = require('./controlSnapshotTarget').controlSnapshotTargetBlock(
    { ...row, event_type: SNAPSHOT_EVENT_TYPE }, activeSettings,
  );
  if (targetBlock) throw new CentralRequestError(targetBlock.reason, { code: targetBlock.code });
  const requestPath = "/api/internal/sj-review/snapshots";
  const body = controlCanonicalJson(row.payload_json);
  const digest = controlPayloadDigest(row.payload_json);
  if (digest !== row.payload_checksum) {
    throw new CentralRequestError("Checksum snapshot lokal tidak sesuai.", {
      code: "CONTROL_SNAPSHOT_CHECKSUM_INVALID",
    });
  }
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const signature = signControlTransport(
    controlSigningMessage({ method: "POST", path: requestPath, timestamp, nonce, contentSha256: digest }),
    controlAcknowledgmentPrivateKey(),
  );
  let response;
  try {
    response = await fetch(`${controlBaseUrl()}${requestPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [controlHeaderNames.instanceId]: activeSettings.installation_id,
        [controlHeaderNames.acknowledgmentKeyId]: String(process.env.SJ_CONTROL_ACK_KEY_ID || "").trim(),
        [controlHeaderNames.acknowledgmentTimestamp]: timestamp,
        [controlHeaderNames.acknowledgmentNonce]: nonce,
        [controlHeaderNames.acknowledgmentContentSha256]: digest,
        [controlHeaderNames.acknowledgmentSignature]: signature,
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new CentralRequestError("Ruwang Control belum dapat dihubungi.", {
      code: "CONTROL_UNREACHABLE",
      retryable: true,
    });
  }
  let responseText;
  try { responseText = await response.text(); }
  catch {
    throw new CentralRequestError('Respons Ruwang Control terputus.', {
      code: 'CONTROL_RESPONSE_INTERRUPTED', retryable: true,
    });
  }
  let acknowledgment;
  try {
    acknowledgment = JSON.parse(responseText);
  } catch {
    throw new CentralRequestError("Respons Ruwang Control bukan JSON yang valid.", {
      status: response.status,
      code: "CONTROL_RESPONSE_INVALID",
      retryable: response.status >= 500,
    });
  }
  if (!response.ok) {
    throw new CentralRequestError("Ruwang Control menolak snapshot.", {
      status: response.status,
      code: acknowledgment?.error?.code || `CONTROL_HTTP_${response.status}`,
      retryable: [408, 425, 429].includes(response.status) || response.status >= 500,
    });
  }
  if (controlCanonicalJson(acknowledgment) !== responseText) {
    throw new CentralRequestError("Respons Ruwang Control tidak kanonis.", {
      status: response.status,
      code: "CONTROL_RESPONSE_INVALID",
    });
  }
  const responseDigest = controlPayloadDigest(acknowledgment);
  const responseTimestamp = String(response.headers.get(controlHeaderNames.timestamp) || "").trim();
  const responseNonce = String(response.headers.get(controlHeaderNames.nonce) || "").trim();
  const responseKeyId = String(response.headers.get(controlHeaderNames.keyId) || "").trim();
  const responseContentSha256 = String(response.headers.get(controlHeaderNames.contentSha256) || "").trim();
  const responseSignature = String(response.headers.get(controlHeaderNames.signature) || "").trim();
  const responseTime = Date.parse(responseTimestamp);
  const maxClockSkewMs = (Number(process.env.SJ_CONTROL_MAX_CLOCK_SKEW_SECONDS) || 300) * 1000;
  if (
    responseKeyId !== String(process.env.SJ_CONTROL_KEY_ID || "").trim() ||
    responseContentSha256 !== responseDigest ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(responseNonce) ||
    !Number.isFinite(responseTime) ||
    Math.abs(Date.now() - responseTime) > maxClockSkewMs ||
    !responseSignature
  ) {
    throw new CentralRequestError("Signature respons Ruwang Control ditolak.", {
      status: response.status,
      code: "CONTROL_RESPONSE_SIGNATURE_INVALID",
    });
  }
  const responseMessage = controlSigningMessage({
    method: "POST",
    path: requestPath,
    timestamp: responseTimestamp,
    nonce: responseNonce,
    contentSha256: responseDigest,
  });
  if (
    !verifyControlTransport(responseMessage, responseSignature, controlPublicKey()) ||
    acknowledgment?.contract_version !== 1 ||
    acknowledgment?.snapshot_id !== row.aggregate_id ||
    acknowledgment?.instance_id !== activeSettings.installation_id ||
    acknowledgment?.status !== "ACCEPTED" ||
    typeof acknowledgment?.received_at !== 'string' ||
    !Number.isFinite(Date.parse(acknowledgment.received_at))
  ) {
    throw new CentralRequestError("Signature respons Ruwang Control ditolak.", {
      status: response.status,
      code: "CONTROL_RESPONSE_SIGNATURE_INVALID",
    });
  }
  return {
    acknowledged_at: acknowledgment.received_at,
    request_id: null,
    http_status: response.status,
  };
}

async function settings() {
  const row = await prisma.sj_integration_settings.findFirst();
  if (
    !row ||
    !row.sync_enabled ||
    ["SUSPENDED", "REVOKED"].includes(row.connection_state)
  ) return null;
  return row;
}

async function uploadMedia(row, activeSettings) {
  if (row.state === "PROCESSING") {
    const status = await signedRequest(
      activeSettings,
      "GET",
      `/v1/media/${row.central_media_id}/status`,
    );
    require('./mediaReadiness').validateMediaStatus(status,row.central_media_id);
    if (status.status === "READY") {
      await prisma.sj_media_assets.updateMany({
        where: { id: row.id,state:'PROCESSING',central_media_id:row.central_media_id,revoked_at:null },
        data: { state: "READY", rejection_code: null },
      });
    } else if (["REJECTED", "REVOKED", "QUARANTINED", "EXPIRED"].includes(status.status)) {
      await prisma.sj_media_assets.updateMany({
        where: { id: row.id,state:'PROCESSING',central_media_id:row.central_media_id,revoked_at:null },
        data: { state: "REJECTED", rejection_code: status.rejection_code || "CENTRAL_MEDIA_REJECTED" },
      });
    }
    return true;
  }

  if (row.state === "UPLOAD_PENDING") {
    // Another worker may be uploading. Only recover an abandoned reservation
    // after the maximum three bounded network calls have had time to finish.
    const recovered=await prisma.sj_media_assets.updateMany({
      where: { id: row.id,state:'UPLOAD_PENDING',updated_at:{lt:new Date(Date.now()-Math.max(300000,2*requestTimeoutMs()+120000))},revoked_at:null },
      data: { state: "UPLOADED", upload_session_id: null },
    });
    return recovered.count===1;
  }

  let publicationId = null;
  if (row.purpose === "PUBLICATION_IMAGE") {
    const link = await prisma.sj_publication_version_media.findFirst({
      where: { media_asset_id: row.id },
      include: { publication_version: { select: { publication_id: true } } },
    });
    publicationId = link?.publication_version?.publication_id || null;
    if (!publicationId) return false;
  }

  const reservedAt=new Date();
  const reservation=await prisma.sj_media_assets.updateMany({where:{id:row.id,state:'UPLOADED',revoked_at:null,updated_at:row.updated_at},data:{state:'UPLOAD_PENDING',updated_at:reservedAt}});
  if(!reservation.count)return false;
  row.state='UPLOAD_PENDING';
  row.updated_at=reservedAt;
  const session = await signedRequest(activeSettings, "POST", "/v1/media/upload-sessions", {
    institution_id: activeSettings.institution_id,
    publication_id: publicationId,
    source_media_id: row.id,
    sha256: row.sha256,
    detected_mime: row.detected_mime,
    size_bytes: Number(row.size_bytes),
    width: row.width,
    height: row.height,
    purpose: row.purpose,
    requested_ttl_seconds: Number(process.env.SJ_MEDIA_UPLOAD_TTL_SECONDS) || 900,
  });
  require('./mediaReadiness').validateUploadSession(session, Number(row.size_bytes));
  const reserved=await prisma.sj_media_assets.updateMany({
    where: { id: row.id,state:'UPLOAD_PENDING',revoked_at:null,upload_session_id:row.upload_session_id,updated_at:reservedAt },
    data: {
      state: "UPLOAD_PENDING",
      central_media_id: session.media_id,
      upload_session_id: session.upload_session_id,
      updated_at:reservedAt,
    },
  });
  if(!reserved.count)return false;
  row.upload_session_id=session.upload_session_id;
  const storage = createMediaStorage({
    ...process.env,
    SJ_MEDIA_STORAGE_PROVIDER: row.storage_backend,
  });
  const content = await storage.read(row.logical_object_key);
  let uploadResponse;
  try {
    uploadResponse = await fetch(session.upload_url, {
      method: "PUT",
      headers: session.headers,
      body: content,
      redirect:'error',
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new CentralRequestError("Upload gambar ke pusat terputus.", {
      code: "MEDIA_UPLOAD_UNREACHABLE",
      retryable: true,
    });
  }
  if (!uploadResponse.ok) {
    throw new CentralRequestError("Upload gambar ke pusat gagal.", {
      status: uploadResponse.status,
      code: `MEDIA_UPLOAD_HTTP_${uploadResponse.status}`,
      retryable: uploadResponse.status === 408 || uploadResponse.status === 429 || uploadResponse.status >= 500,
    });
  }
  const completed = await signedRequest(
    activeSettings,
    "POST",
    `/v1/media/upload-sessions/${session.upload_session_id}/complete`,
    { media_id: session.media_id },
  );
  require('./mediaReadiness').validateMediaStatus(completed,session.media_id);
  await prisma.sj_media_assets.updateMany({
    where: { id: row.id,state:'UPLOAD_PENDING',upload_session_id:session.upload_session_id,revoked_at:null },
    data: {
      state: completed.status === "READY" ? "READY" : ["REJECTED", "REVOKED", "QUARANTINED", "EXPIRED"].includes(completed.status) ? "REJECTED" : "PROCESSING",
      rejection_code: completed.rejection_code || null,
    },
  });
  return true;
}

async function processMediaBatch(activeSettings, limit) {
  const rows = await prisma.sj_media_assets.findMany({
    where: { state: { in: ["UPLOADED", "UPLOAD_PENDING", "PROCESSING"] }, revoked_at: null },
    orderBy: { created_at: "asc" },
    take: limit,
  });
  let processed = 0;
  for (const row of rows) {
    try {
      if (await uploadMedia(row, activeSettings)) {
        processed += 1;
        await prisma.sj_integration_settings.updateMany({
          where:{connection_state:{notIn:['SUSPENDED','REVOKED']}},
          data: {
            connection_state: "ACTIVE",
            last_success_at: new Date(),
            last_error_code: null,
          },
        });
      }
    } catch (error) {
      const code = error instanceof CentralRequestError ? error.code : safeLocalErrorCode(error);
      await prisma.sj_media_assets.updateMany({
        where: { id: row.id,state:row.state,upload_session_id:row.upload_session_id,revoked_at:null,updated_at:row.updated_at },
        data: {
          state: error instanceof CentralRequestError && error.retryable
            ? mediaRetryState(row.state)
            : "REJECTED",
          rejection_code: code,
        },
      });
    }
  }
  return processed;
}

async function claimOutbox(workerId, limit) {
  await lease.recoverExpired();
  return lease.claim(workerId,limit);
}

async function acknowledgeAggregate(client, row, response) {
  if(row.event_type===SNAPSHOT_EVENT_TYPE)return response;
  // A duplicate whose central cursor is newer confirms this event only.
  if(response.active_aggregate_version!==row.aggregate_version)return response;
  if (row.aggregate_type === "PUBLICATION") {
    await client.sj_publications.updateMany({
      where: { id: row.aggregate_id, aggregate_version: row.aggregate_version },
      data: {
        sync_state: "ACKNOWLEDGED",
        last_sync_error_code: null,
      },
    });
    if(row.event_type==='UPSERT_PUBLICATION_SNAPSHOT')await client.sj_publications.updateMany({
      where:{id:row.aggregate_id,aggregate_version:row.aggregate_version,state:'APPROVED'},data:{state:'PUBLISHED'}});
  } else if (row.aggregate_type === "WHATSAPP_CONTACT") {
    await client.sj_whatsapp_contacts.updateMany({
      where: { id: row.aggregate_id, aggregate_version: row.aggregate_version },
      data: { sync_state: "ACKNOWLEDGED" },
    });
  } else if (row.aggregate_type === "BPRS_PROFILE") {
    await client.sj_public_profiles.updateMany({
      where: { aggregate_version: row.aggregate_version },
      data: { sync_state: "ACKNOWLEDGED" },
    });
  }
  await client.sj_integration_settings.updateMany({
    where:{connection_state:{notIn:['SUSPENDED','REVOKED']}},
    data: { last_success_at: new Date(), last_error_code: null, connection_state: "ACTIVE" },
  });
  return response;
}

async function deliverOutbox(row, _batchSettings) {
  if(!await lease.renew(row))return false;
  // Settings may change between jobs in one batch. Never use the stale batch
  // configuration to authorize a delivery under an earlier installation.
  const activeSettings = await prisma.sj_integration_settings.findFirst();
  const targetBlock = require('./outboxTarget').outboxTargetBlock(row, activeSettings);
  if (targetBlock) throw new CentralRequestError(targetBlock.reason, { code: targetBlock.code });
  const envelope = {
    event_id: row.event_id,
    schema_version: row.schema_version,
    event_type: row.event_type,
    institution_id: activeSettings.institution_id,
    aggregate_id: row.aggregate_id,
    aggregate_version: row.aggregate_version,
    occurred_at: row.created_at.toISOString(),
    payload_checksum: row.payload_checksum,
    payload: row.payload_json,
  };
  let response;
  if (row.event_type === SNAPSHOT_EVENT_TYPE) {
    response = await deliverControlSnapshot(row, activeSettings);
  } else {
    const contracts = await getContracts();
    contracts.assertValidIntegrationEvent(envelope);
    response = validateIngestAcknowledgment(await signedRequest(activeSettings, "POST", "/v1/ingest/events", envelope),row);
  }
  await prisma.$transaction(async (client) => {
    if(!await lease.owns(client,row))return;
    await client.sj_sync_attempts.create({
      data: {
        outbox_id: row.id,
        attempt_number: row.attempt_count,
        finished_at: new Date(),
        result: syncAttemptResult("ACKNOWLEDGED"),
        http_status: response.http_status || 200,
        request_id: response.request_id || null,
      },
    });
    await client.sj_sync_outbox.update({
      where: { id: row.id },
      data: {
        state: "ACKNOWLEDGED",
        acknowledged_at: new Date(response.acknowledged_at || Date.now()),
        last_error_code: null,
        locked_at: null,
        locked_by: null,
      },
    });
    await client.sj_control_change_requests.updateMany({
      where: { sync_event_id: row.event_id, state: "APPLIED" },
      data: { state: "COMPLETED", completed_at: new Date(), failure_code: null },
    });
    await acknowledgeAggregate(client, row, response);
  });
}

async function failOutbox(row, error) {
  const retryable = error instanceof CentralRequestError ? error.retryable
    : ['P1001','P1002','P1008','P1017','P2024','P2028','P2034','ECONNRESET','ECONNREFUSED','ETIMEDOUT'].includes(error?.code);
  const exhausted = row.attempt_count >= MAX_ATTEMPTS;
  const nextState = retryable && !exhausted ? "RETRYING" : exhausted ? "FAILED" : "QUARANTINED";
  const delaySeconds = Math.min(3600, 2 ** Math.min(row.attempt_count, 10) * 15);
  const code = safeLocalErrorCode(error);
  await prisma.$transaction(async (client) => {
    if(!await lease.owns(client,row))return;
    await client.sj_sync_attempts.create({
      data: {
        outbox_id: row.id,
        attempt_number: row.attempt_count,
        finished_at: new Date(),
        result: syncAttemptResult(nextState),
        http_status: error.status || null,
        error_code: code,
      },
    });
    await client.sj_sync_outbox.update({
      where: { id: row.id },
      data: {
        state: nextState,
        available_at: new Date(Date.now() + delaySeconds * 1000),
        last_error_code: code,
        locked_at: null,
        locked_by: null,
      },
    });
    if (["FAILED", "QUARANTINED"].includes(nextState)) {
      await client.sj_control_change_requests.updateMany({
        where: { sync_event_id: row.event_id, state: "APPLIED" },
        data: { state: "FAILED", failure_code: code },
      });
    }
    await lease.updateAggregateFailure(client,row,nextState,code);
    await client.sj_integration_settings.updateMany({
      data: { last_error_at: new Date(), last_error_code: code },
    });
  });
}

async function processOutboxBatch(activeSettings, workerId, limit) {
  let processed=0;
  for(let index=0;index<limit;index++){
    // Claim just in time; queued batch items must not spend their lease waiting.
    const [row]=await claimOutbox(workerId,1);if(!row)break;
    let pending;
    const timer=setInterval(()=>{if(!pending)pending=lease.renew(row).catch(()=>false).finally(()=>{pending=null;});},Math.max(250,Math.floor(lease.leaseMs()/3)));
    timer.unref();
    try {
      await deliverOutbox(row, activeSettings);
    } catch (error) {
      await failOutbox(row, error);
    }finally{clearInterval(timer);if(pending)await pending;}
    processed++;
    }
  return processed;
}

async function unpublishExpired(activeSettings, limit) {
  const due = await prisma.sj_publications.findMany({
    where: { state: "PUBLISHED", next_reconfirmation_at: { lte: new Date() } },
    orderBy: { next_reconfirmation_at: "asc" },
    take: limit,
  });
  for (const item of due) {
    await prisma.$transaction(async (client) => {
      await require('./workflowLock').lockPublication(client,item.id);
      const current = await client.sj_publications.findUnique({ where: { id: item.id } });
      if (!current || current.state !== "PUBLISHED" || current.next_reconfirmation_at > new Date()) return;
      const now = new Date();
      const aggregateVersion = current.aggregate_version + 1;
      await client.sj_publications.update({
        where: { id: current.id },
        data: {
          state: "UNPUBLISHED",
          sync_state: "QUEUED",
          aggregate_version: aggregateVersion,
          lock_version: { increment: 1 },
          last_sync_error_code: null,
        },
      });
      await createOutbox(client, activeSettings, {
        eventType: "UNPUBLISH_PUBLICATION",
        aggregateType: "PUBLICATION",
        aggregateId: current.id,
        aggregateVersion,
        payload: {
          publication_id: current.id,
          institution_id: activeSettings.institution_id,
          reason_code: "RECONFIRMATION_EXPIRED",
          unpublished_at: now.toISOString(),
        },
        priority: 1,
      });
    });
  }
  return due.length;
}

async function processReconciliation(activeSettings) {
  const running = await prisma.sj_reconciliation_runs.findFirst({
    where: { state: "RUNNING" },
    orderBy: { started_at: "asc" },
  });
  if (running) {
    const stored = running.safe_report_json || {};
    const centralRunId = stored.central_run_id;
    if (!centralRunId) {
      await prisma.sj_reconciliation_runs.update({
        where: { id: running.id },
        data: {
          state: "FAILED",
          finished_at: new Date(),
          safe_report_json: {
            manifest: stored.manifest || null,
            error_code: "CENTRAL_RUN_ID_MISSING",
          },
        },
      });
      return 1;
    }
    try {
      const result = await signedRequest(
        activeSettings,
        "GET",
        `/v1/reconciliation/runs/${encodeURIComponent(centralRunId)}`,
      );
      require('./reconciliationResponse').validateReconciliationResponse(result,stored.manifest,centralRunId);
      if (["PENDING", "RUNNING"].includes(result.status)) return 1;
      if (result.status === "COMPLETED") {
        const contracts = await getContracts();
        const mismatches = result.mismatches;
        const countChecked = result.count_checked;
        const countMismatch = result.count_mismatch;
        const centralReport = {
          run_id: centralRunId,
          status: result.status,
          count_checked: countChecked,
          count_mismatch: countMismatch,
          mismatches,
        };
        await prisma.sj_reconciliation_runs.update({
          where: { id: running.id },
          data: {
            state: countMismatch > 0 ? "MISMATCH" : "MATCHED",
            central_manifest_checksum: contracts.payloadChecksum(centralReport),
            count_checked: countChecked,
            count_mismatch: countMismatch,
            safe_report_json: { manifest: stored.manifest, central_run_id: centralRunId, result: centralReport },
            finished_at: new Date(),
          },
        });
        return 1;
      }
      await prisma.sj_reconciliation_runs.update({
        where: { id: running.id },
        data: {
          state: "FAILED",
          finished_at: new Date(),
          safe_report_json: {
            manifest: stored.manifest,
            central_run_id: centralRunId,
            error_code: result.status === "FAILED" ? "CENTRAL_RECONCILIATION_FAILED" : "CENTRAL_STATUS_UNKNOWN",
          },
        },
      });
    } catch (error) {
      if (!(error instanceof CentralRequestError) || !error.retryable) {
        await prisma.sj_reconciliation_runs.update({
          where: { id: running.id },
          data: {
            state: "FAILED",
            finished_at: new Date(),
            safe_report_json: {
              manifest: stored.manifest,
              central_run_id: centralRunId,
              error_code: error.code || "CENTRAL_RECONCILIATION_FAILED",
            },
          },
        });
      }
    }
    return 1;
  }

  const run = await prisma.sj_reconciliation_runs.findFirst({
    where: { state: "PENDING" },
    orderBy: { started_at: "asc" },
  });
  if (!run) return 0;
  const manifest = run.safe_report_json;
  try {
    const result = await signedRequest(activeSettings, "POST", "/v1/reconciliation/manifests", manifest);
    require('./reconciliationResponse').validateReconciliationResponse(result,manifest);
    await prisma.sj_reconciliation_runs.update({
      where: { id: run.id },
      data: {
        state: "RUNNING",
        safe_report_json: { manifest, central_run_id: result.run_id },
      },
    });
  } catch (error) {
    if (!(error instanceof CentralRequestError) || !error.retryable) {
      await prisma.sj_reconciliation_runs.update({
        where: { id: run.id },
        data: { state: "FAILED", finished_at: new Date() },
      });
    }
  }
  return 1;
}

exports.runSyncCycle = async ({ workerId = `sj-worker-${process.pid}`, batchSize = 10 } = {}) => {
  const activeSettings = await settings();
  if (!activeSettings) return { processed_count: 0, connection_active: false };
  const media = await processMediaBatch(activeSettings, batchSize);
  const expired = await unpublishExpired(activeSettings, batchSize);
  const outbox = await processOutboxBatch(activeSettings, workerId, batchSize);
  const reconciliation = await processReconciliation(activeSettings);
  return {
    processed_count: media + expired + outbox + reconciliation,
    media,
    expired,
    outbox,
    reconciliation,
    connection_active: true,
  };
};

exports.claimOutbox = claimOutbox;
exports.deliverOutbox = deliverOutbox;
exports.failOutbox = failOutbox;
exports.processOutboxBatch = processOutboxBatch;
exports.processMediaBatch = processMediaBatch;
exports.validateIngestAcknowledgment = validateIngestAcknowledgment;
exports.retryableResponse = retryableResponse;
exports.deliverControlSnapshot = deliverControlSnapshot;
exports.mediaRetryState = mediaRetryState;
exports.safeLocalErrorCode = safeLocalErrorCode;
exports.signedRequest = signedRequest;
exports.syncAttemptResult = syncAttemptResult;
exports.uploadMedia = uploadMedia;
