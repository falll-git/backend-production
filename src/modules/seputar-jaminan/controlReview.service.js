const crypto = require("node:crypto");

const {getReviewDatabase} = require('./reviewDatabase');
const { AppError } = require("../../utils/errors");
const { createMediaStorage } = require("./mediaStorage");
const profileContactService = require("./profileContact.service");
const publicationService = require("./seputarJaminan.service");
const changeRequestService = require("./changeRequest.service");
const {
  UUID_PATTERN,
  canonicalJson,
  headerNames,
  payloadDigest,
  signTransport,
  signingMessage,
  validateCommand,
  validateResultLookup,
  validateAcknowledgment,
  verifyTransport,
} = require("./controlReview.contract");

const COMMAND_PATH = "/api/v1/internal/ruwang-control/sj-review/commands";
const RESULT_PATH = "/api/v1/internal/ruwang-control/sj-review/command-results";
const MEDIA_PATH_PREFIX = "/api/v1/internal/ruwang-control/sj-review/media/";
const EMPTY_CHECKSUM = "0".repeat(64);

function readPositiveInteger(key, fallback) {
  const value = Number(process.env[key] || fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new AppError(`Konfigurasi ${key} tidak valid.`, 503);
  }
  return value;
}

function adapterConfig() {
  const authority = String(process.env.SJ_CONTROL_REVIEW_AUTHORITY || "local")
    .trim()
    .toLowerCase();
  if (authority !== "central") {
    throw new AppError("Pemeriksaan pusat belum diaktifkan.", 409);
  }
  const config = {
    instanceId: String(process.env.SJ_CONTROL_INSTANCE_ID || "").trim(),
    keyId: String(process.env.SJ_CONTROL_KEY_ID || "").trim(),
    publicKey: String(process.env.SJ_CONTROL_PUBLIC_KEY || "").trim(),
    acknowledgmentKeyId: String(process.env.SJ_CONTROL_ACK_KEY_ID || "").trim(),
    acknowledgmentPrivateKey: String(
      process.env.SJ_CONTROL_ACK_PRIVATE_KEY || "",
    ).trim(),
    audience: String(process.env.SJ_CONTROL_AUDIENCE || "").trim(),
    maxClockSkewSeconds: readPositiveInteger(
      "SJ_CONTROL_MAX_CLOCK_SKEW_SECONDS",
      300,
    ),
    nonceTtlSeconds: readPositiveInteger("SJ_CONTROL_NONCE_TTL_SECONDS", 600),
  };
  if (
    !UUID_PATTERN.test(config.instanceId) ||
    !config.keyId ||
    !config.publicKey ||
    !config.acknowledgmentKeyId ||
    !config.acknowledgmentPrivateKey ||
    !config.audience
  ) {
    throw new AppError("Konfigurasi pemeriksaan pusat belum lengkap.", 503);
  }
  return config;
}

function requestHeaders(request) {
  return {
    instanceId: String(request.get(headerNames.instanceId) || "").trim(),
    keyId: String(request.get(headerNames.keyId) || "").trim(),
    timestamp: String(request.get(headerNames.timestamp) || "").trim(),
    nonce: String(request.get(headerNames.nonce) || "").trim(),
    contentSha256: String(
      request.get(headerNames.contentSha256) || "",
    ).trim(),
    signature: String(request.get(headerNames.signature) || "").trim(),
  };
}

function verifyRequest(request, now) {
  const config = adapterConfig();
  const command = request.body;
  const validation = validateCommand(command);
  if (!validation.valid) {
    throw new AppError("Perintah pemeriksaan tidak valid.", 422);
  }
  const headers = requestHeaders(request);
  const digest = payloadDigest(command);
  if (
    headers.instanceId !== config.instanceId ||
    command.instance_id !== config.instanceId ||
    headers.keyId !== config.keyId ||
    command.audience !== config.audience ||
    !UUID_PATTERN.test(headers.nonce) ||
    headers.contentSha256 !== digest
  ) {
    throw new AppError("Identitas adapter pemeriksaan ditolak.", 401);
  }
  const transportTime = Date.parse(headers.timestamp);
  const issuedAt = Date.parse(command.issued_at);
  const expiresAt = Date.parse(command.expires_at);
  const skewMs = config.maxClockSkewSeconds * 1000;
  if (
    !Number.isFinite(transportTime) ||
    Math.abs(now.getTime() - transportTime) > skewMs ||
    issuedAt > now.getTime() + skewMs ||
    expiresAt < now.getTime() ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > config.nonceTtlSeconds * 1000
  ) {
    throw new AppError("Perintah pemeriksaan sudah kedaluwarsa.", 401);
  }
  const message = signingMessage({
    method: "POST",
    path: COMMAND_PATH,
    timestamp: headers.timestamp,
    nonce: headers.nonce,
    contentSha256: digest,
  });
  if (!verifyTransport(message, headers.signature, config.publicKey)) {
    throw new AppError("Signature adapter pemeriksaan ditolak.", 401);
  }
  return { command, config, digest, headers };
}

function bankSubject(userId) {
  return `ruwang-bank:${userId}`;
}

function normalizeSubjects(subjects) {
  return [...new Set(subjects)].sort();
}

function sameSubjects(left, right) {
  return (
    left.length === right.length &&
    left.every((subject, index) => subject === right[index])
  );
}

async function resourceSnapshot(client, command) {
  if (command.resource.kind === "change_request") {
    const request = await client.sj_control_change_requests.findUnique({
      where: { id: command.resource.id },
    });
    return {
      aggregate: request,
      version: request,
      state: request?.state,
      versionState: request?.state,
      lockVersion: request?.request_version ?? 0,
      checksum: request?.impact_checksum || EMPTY_CHECKSUM,
      contributors: request ? [bankSubject(request.submitted_by)] : [],
    };
  }
  if (command.resource.kind === "publication") {
    const aggregate = await client.sj_publications.findUnique({
      where: { id: command.resource.id },
      include: { current_version: true },
    });
    const version = aggregate?.current_version;
    return {
      aggregate,
      version,
      state: aggregate?.state,
      versionState: version?.state,
      lockVersion: aggregate?.lock_version ?? 0,
      checksum: version?.payload_checksum || EMPTY_CHECKSUM,
      contributors: version
        ? normalizeSubjects(
            [version.last_edited_by, version.submitted_by]
              .filter(Boolean)
              .map(bankSubject),
          )
        : [],
    };
  }
  if (command.resource.kind === "profile") {
    const aggregate = await client.sj_public_profiles.findUnique({
      where: { id: command.resource.id },
      include: {
        versions: { orderBy: { version_number: "desc" }, take: 1 },
      },
    });
    const version = aggregate?.versions?.[0];
    return {
      aggregate,
      version,
      state: aggregate?.state,
      versionState: version?.state,
      lockVersion: aggregate?.lock_version ?? 0,
      checksum: version?.payload_checksum || EMPTY_CHECKSUM,
      contributors: version ? normalizeSubjects([version.created_by, aggregate.updated_by].filter(Boolean).map(bankSubject)) : [],
    };
  }
  const aggregate = await client.sj_whatsapp_contacts.findUnique({
    where: { id: command.resource.id },
    include: { versions: { orderBy: { version_number: "desc" }, take: 1 } },
  });
  const version = aggregate?.versions?.[0];
  return {
    aggregate,
    version,
    state: aggregate?.state,
    versionState: version?.state,
    lockVersion: aggregate?.lock_version ?? 0,
    checksum: version?.checksum || EMPTY_CHECKSUM,
    contributors: version ? normalizeSubjects([version.created_by, aggregate.updated_by].filter(Boolean).map(bankSubject)) : [],
  };
}

function rejectionCode(snapshot, command) {
  if (!snapshot.aggregate || !snapshot.version) return "RESOURCE_NOT_FOUND";
  if (snapshot.lockVersion !== command.expected_version) {
    return "VERSION_CONFLICT";
  }
  if (snapshot.checksum !== command.expected_checksum) {
    return "CHECKSUM_CONFLICT";
  }
  if (snapshot.versionState !== "IN_REVIEW") return "NOT_IN_REVIEW";
  const actual = normalizeSubjects(snapshot.contributors);
  const supplied = normalizeSubjects(command.contributor_subjects);
  if (!sameSubjects(actual, supplied)) return "CONTRIBUTOR_MISMATCH";
  if (supplied.includes(command.actor_subject)) return "SELF_REVIEW_FORBIDDEN";
  return null;
}

function acknowledgment(command, digest, snapshot, status, resultCode, now) {
  return {
    contract_version: 1,
    acknowledgment_id: crypto.randomUUID(),
    command_id: command.command_id,
    command_digest: digest,
    instance_id: command.instance_id,
    resource: command.resource,
    status,
    result_code: resultCode,
    observed_version: snapshot.lockVersion,
    observed_checksum: snapshot.checksum,
    processed_at: now.toISOString(),
  };
}

async function applyDecision(client, command) {
  if (command.resource.kind === "change_request") {
    return changeRequestService.applyControlChangeDecision(client, command);
  }
  if (command.resource.kind === "publication") {
    return publicationService.applyControlPublicationDecision(client, command);
  }
  if (command.resource.kind === "profile") {
    return profileContactService.applyControlProfileDecision(client, command);
  }
  return profileContactService.applyControlContactDecision(client, command);
}

function applicationErrorCode(error) {
  if (!(error instanceof AppError)) return "APPLICATION_REJECTED";
  if (error.statusCode === 404) return "RESOURCE_NOT_FOUND";
  if (error.statusCode === 409) return "BUSINESS_RULE_CONFLICT";
  if (error.statusCode === 422) return "BUSINESS_RULE_INVALID";
  return "APPLICATION_REJECTED";
}

async function recordNonce(client, verified, now) {
  await client.sj_control_request_nonces.deleteMany({
    where: { expires_at: { lte: now } },
  });
  try {
    await client.sj_control_request_nonces.create({
      data: {
        instance_id: verified.command.instance_id,
        key_id: verified.headers.keyId,
        nonce: verified.headers.nonce,
        expires_at: new Date(
          now.getTime() + verified.config.nonceTtlSeconds * 1000,
        ),
      },
    });
  } catch (error) {
    if (error?.code === "P2002") {
      throw new AppError("Nonce adapter sudah pernah digunakan.", 409);
    }
    throw error;
  }
}

async function processVerifiedCommand(verified, now) {
  const database = await getReviewDatabase();
  return database.$transaction(async (client) => {
    // Same command with a fresh transport nonce must replay the persisted ACK,
    // not race the unique insert. Distinct commands then lock the same aggregate
    // before comparing version/checksum and applying any decision.
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ruwang:sj:control-command'), hashtext(${verified.command.command_id}))`;
    const settings = await client.sj_integration_settings.findFirst();
    if (
      !settings ||
      settings.review_authority !== "central" ||
      settings.installation_id !== verified.command.instance_id ||
      !settings.review_enabled
    ) {
      throw new AppError("Instansi tidak menerima pemeriksaan pusat.", 409);
    }

    await recordNonce(client, verified, now);
    const existing = await client.sj_control_review_commands.findUnique({
      where: { command_id: verified.command.command_id },
    });
    if (existing) {
      if (existing.command_digest !== verified.digest) {
        throw new AppError("Command ID sudah dipakai untuk payload berbeda.", 409);
      }
      if (!existing.acknowledgment_json) {
        throw new AppError("Status perintah belum dapat dipastikan.", 409);
      }
      return existing.acknowledgment_json;
    }

    await client.sj_control_review_commands.create({
      data: {
        command_id: verified.command.command_id,
        instance_id: verified.command.instance_id,
        key_id: verified.headers.keyId,
        command_digest: verified.digest,
        actor_subject: verified.command.actor_subject,
        resource_kind: verified.command.resource.kind,
        resource_id: verified.command.resource.id,
        decision: verified.command.decision,
        expected_version: verified.command.expected_version,
        expected_checksum: verified.command.expected_checksum,
        request_payload: verified.command,
        status: "PROCESSING",
      },
    });

    await require('./workflowLock').lockReviewResource(client, verified.command.resource);
    let snapshot = await resourceSnapshot(client, verified.command);
    let resultCode = rejectionCode(snapshot, verified.command);
    let status = "REJECTED";
    if (!resultCode) {
      await client.$executeRawUnsafe("SAVEPOINT control_review_apply");
      try {
        // Outbox INSERT captures this command in the same transaction. Reset the
        // context before any later work; a savepoint rollback also rolls it back.
        await client.$executeRaw`SELECT set_config('app.sj_decision_command_id', ${verified.command.decision === 'approve' ? verified.command.command_id : ''}, true)`;
        await applyDecision(client, verified.command);
        await client.$executeRaw`SELECT set_config('app.sj_decision_command_id', '', true)`;
        await client.$executeRawUnsafe("RELEASE SAVEPOINT control_review_apply");
        snapshot = await resourceSnapshot(client, verified.command);
        status = "APPLIED";
        resultCode = "DECISION_APPLIED";
      } catch (error) {
        await client.$executeRawUnsafe(
          "ROLLBACK TO SAVEPOINT control_review_apply",
        );
        resultCode = applicationErrorCode(error);
        snapshot = await resourceSnapshot(client, verified.command);
      }
    }
    const ack = acknowledgment(
      verified.command,
      verified.digest,
      snapshot,
      status,
      resultCode,
      now,
    );
    await client.sj_control_review_commands.update({
      where: { command_id: verified.command.command_id },
      data: {
        acknowledgment_json: ack,
        status,
        result_code: resultCode,
        processed_at: now,
      },
    });
    return ack;
  });
}

function signAcknowledgment(ack, config, now, path = COMMAND_PATH) {
  const body = canonicalJson(ack);
  const digest = payloadDigest(ack);
  const timestamp = now.toISOString();
  const nonce = crypto.randomUUID();
  const message = signingMessage({
    method: "POST",
    path,
    timestamp,
    nonce,
    contentSha256: digest,
  });
  return {
    body,
    headers: {
      [headerNames.acknowledgmentKeyId]: config.acknowledgmentKeyId,
      [headerNames.acknowledgmentTimestamp]: timestamp,
      [headerNames.acknowledgmentNonce]: nonce,
      [headerNames.acknowledgmentContentSha256]: digest,
      [headerNames.acknowledgmentSignature]: signTransport(
        message,
        config.acknowledgmentPrivateKey,
      ),
    },
  };
}

function verifyMediaRequest(request, mediaId, now) {
  if (!UUID_PATTERN.test(mediaId)) throw new AppError("Identitas media tidak valid.", 422);
  const snapshotId = request.params?.snapshotId;
  if (snapshotId !== undefined && !UUID_PATTERN.test(snapshotId)) throw new AppError("Identitas snapshot tidak valid.", 422);
  const config = adapterConfig();
  const headers = requestHeaders(request);
  const emptyDigest = crypto.createHash("sha256").update("").digest("hex");
  const path = snapshotId === undefined ? `${MEDIA_PATH_PREFIX}${mediaId}`
    : `/api/v1/internal/ruwang-control/sj-review/snapshots/${snapshotId}/media/${mediaId}`;
  const timestampMs = Date.parse(headers.timestamp);
  if (
    headers.instanceId !== config.instanceId ||
    headers.keyId !== config.keyId ||
    headers.contentSha256 !== emptyDigest ||
    !UUID_PATTERN.test(headers.nonce) ||
    !Number.isFinite(timestampMs) ||
    Math.abs(now.getTime() - timestampMs) > config.maxClockSkewSeconds * 1000 ||
    !verifyTransport(signingMessage({
      method: "GET",
      path,
      timestamp: headers.timestamp,
      nonce: headers.nonce,
      contentSha256: emptyDigest,
    }), headers.signature, config.publicKey)
  ) {
    throw new AppError("Permintaan media pemeriksaan ditolak.", 401);
  }
  return { config, headers, path, snapshotId };
}

async function loadReviewMedia(request, mediaId, now) {
  const verified = verifyMediaRequest(request, mediaId, now);
  const database = await getReviewDatabase();
  const row = await database.$transaction(async (client) => {
    const settings = await client.sj_integration_settings.findFirst();
    if (!settings || settings.review_authority !== "central" || settings.installation_id !== verified.config.instanceId || !settings.review_enabled) {
      throw new AppError("Instansi tidak menerima pemeriksaan pusat.", 409);
    }
    await recordNonce(client, {
      command: { instance_id: verified.config.instanceId },
      config: verified.config,
      headers: verified.headers,
    }, now);
    const media = await client.sj_media_assets.findFirst({
      where: { id: mediaId, state: "READY", revoked_at: null },
    });
    if (!media) throw new AppError("Media pemeriksaan tidak ditemukan.", 404);
    if (verified.snapshotId !== undefined) {
      const snapshot = await client.sj_sync_outbox.findFirst({
        where: { event_type: 'CONTROL_REVIEW_SNAPSHOT', aggregate_type: 'CONTROL_REVIEW',
          aggregate_id: verified.snapshotId },
      });
      const { snapshotContainsMedia } = require('./controlReviewMedia');
      const { outboxTargetBlock } = require('./outboxTarget');
      if (!snapshotContainsMedia(snapshot, verified.config.instanceId, verified.snapshotId, mediaId) ||
          outboxTargetBlock(snapshot, settings)) {
        throw new AppError("Media tidak tersedia untuk snapshot ini.", 404);
      }
      return media;
    }
    const [profile, publication, changeRequest] = await Promise.all([
      client.sj_public_profiles.findFirst({
        where: { state: "IN_REVIEW", logo_media_id: mediaId },
        select: { id: true },
      }),
      client.sj_publication_version_media.findFirst({
        where: {
          media_asset_id: mediaId,
          publication_version: { state: "IN_REVIEW" },
        },
        select: { publication_version_id: true },
      }),
      client.$queryRawUnsafe(
        `SELECT request.id
           FROM public.sj_control_change_requests request
           CROSS JOIN LATERAL jsonb_array_elements(
             COALESCE(request.impact_json->'media', '[]'::jsonb)
           ) media
          WHERE request.state IN ('IN_REVIEW', 'REVISION_REQUIRED')
            AND media->>'source_media_id' = $1
          LIMIT 1`,
        mediaId,
      ),
    ]);
    if (!profile && !publication && changeRequest.length === 0) {
      throw new AppError("Media tidak termasuk snapshot yang sedang diperiksa.", 404);
    }
    return media;
  });
  const storage = createMediaStorage({
    ...process.env,
    SJ_MEDIA_STORAGE_PROVIDER: row.storage_backend,
  });
  const buffer = await storage.read(row.logical_object_key);
  const digest = crypto.createHash("sha256").update(buffer).digest("hex");
  if (digest !== row.sha256) throw new AppError("Integritas media pemeriksaan tidak sesuai.", 409);
  const responseTimestamp = new Date().toISOString();
  const responseNonce = crypto.randomUUID();
  const responseMessage = signingMessage({
    method: "GET",
    path: verified.path,
    timestamp: responseTimestamp,
    nonce: responseNonce,
    contentSha256: digest,
  });
  return {
    buffer,
    mime: row.detected_mime,
    headers: {
      [headerNames.acknowledgmentKeyId]: verified.config.acknowledgmentKeyId,
      [headerNames.acknowledgmentTimestamp]: responseTimestamp,
      [headerNames.acknowledgmentNonce]: responseNonce,
      [headerNames.acknowledgmentContentSha256]: digest,
      [headerNames.acknowledgmentSignature]: signTransport(
        responseMessage,
        verified.config.acknowledgmentPrivateKey,
      ),
    },
  };
}

exports.handleCommand = async (request, now = new Date()) => {
  const verified = verifyRequest(request, now);
  const ack = await processVerifiedCommand(verified, now);
  return signAcknowledgment(ack, verified.config, new Date());
};
function verifyResultRequest(request, now, requestPath = RESULT_PATH, validator = validateResultLookup) {
  const config = adapterConfig();
  const lookup = request.body;
  if (!validator(lookup)) throw new AppError("Permintaan hasil pemeriksaan tidak valid.", 422);
  const headers = requestHeaders(request);
  const digest = payloadDigest(lookup);
  const timestamp = Date.parse(headers.timestamp);
  if (headers.instanceId !== config.instanceId || lookup.instance_id !== config.instanceId ||
      lookup.audience !== config.audience || headers.keyId !== config.keyId || !UUID_PATTERN.test(headers.nonce) ||
      headers.contentSha256 !== digest || !Number.isFinite(timestamp) ||
      Math.abs(now.getTime() - timestamp) > config.maxClockSkewSeconds * 1000 ||
      !verifyTransport(signingMessage({ method: "POST", path: requestPath, timestamp: headers.timestamp,
        nonce: headers.nonce, contentSha256: digest }), headers.signature, config.publicKey)) {
    throw new AppError("Permintaan hasil pemeriksaan ditolak.", 401);
  }
  return { config, headers, lookup };
}

// Read the immutable ledger only. An absent record is NOT proof that a command
// failed: its transaction may still be in flight. Never apply/resubmit here.
exports.getCommandResult = async (request, now = new Date()) => {
  const { config, headers, lookup } = verifyResultRequest(request, now);
  const database = await getReviewDatabase();
  const acknowledgment = await database.$transaction(async client => {
    const settings = await client.sj_integration_settings.findFirst();
    if (!settings || settings.review_authority !== "central" || settings.installation_id !== config.instanceId || !settings.review_enabled) {
      throw new AppError("Instansi tidak menerima pemeriksaan pusat.", 409);
    }
    await recordNonce(client, { command: { instance_id: config.instanceId }, config, headers }, now);
    const row = await client.sj_control_review_commands.findUnique({ where: { command_id: lookup.command_id } });
    if (!row) return null;
    if (row.instance_id !== lookup.instance_id || row.command_digest !== lookup.command_digest ||
        row.resource_kind !== lookup.resource.kind || row.resource_id !== lookup.resource.id) {
      throw new AppError("Identitas hasil pemeriksaan tidak sesuai.", 409);
    }
    const ack = row.acknowledgment_json;
    if (!validateAcknowledgment(ack) || ack.instance_id !== lookup.instance_id || ack.command_id !== lookup.command_id ||
        ack.command_digest !== lookup.command_digest || ack.resource.kind !== lookup.resource.kind || ack.resource.id !== lookup.resource.id ||
        ack.status !== row.status) throw new AppError("Hasil pemeriksaan belum dapat dipastikan.", 409);
    return ack;
  });
  return signAcknowledgment({ contract_version: 1, instance_id: lookup.instance_id, command_id: lookup.command_id,
    command_digest: lookup.command_digest, resource: lookup.resource, request_nonce: headers.nonce,
    checked_at: new Date().toISOString(), state: acknowledgment ? "RECORDED" : "NOT_RECORDED", acknowledgment }, config, new Date(), RESULT_PATH);
};
const DELIVERY_PATH = '/api/v1/internal/ruwang-control/sj-review/command-delivery';
exports.getCommandDelivery = async (request, now = new Date()) => {
  const {config,headers,lookup}=verifyResultRequest(request,now,DELIVERY_PATH);
  const database=await getReviewDatabase();
  const {settings,events}=await database.$transaction(async client=>{
    const settings=await client.sj_integration_settings.findFirst();
    if(!settings||settings.review_authority!=='central'||settings.installation_id!==config.instanceId||!settings.review_enabled) {
      throw new AppError('Instansi tidak menerima pemeriksaan pusat.',409);
    }
    await recordNonce(client,{command:{instance_id:config.instanceId},config,headers},now);
    const command=await client.sj_control_review_commands.findUnique({where:{command_id:lookup.command_id}});
    if(!command||command.instance_id!==lookup.instance_id||command.command_digest!==lookup.command_digest||
      command.resource_kind!==lookup.resource.kind||command.resource_id!==lookup.resource.id)throw new AppError('Bukti keputusan tidak tersedia.',404);
    const events=command.status==='APPLIED'&&command.decision==='approve'
      ? await client.sj_sync_outbox.findMany({where:{source_command_id:lookup.command_id},orderBy:[{created_at:'asc'},{id:'asc'}],take:11}) : [];
    if(events.length>10)throw new AppError('Bukti pengiriman belum dapat dimuat.',409);
    return {settings,events};
  });
  const deliveries=[];
  for(const event of events){
    const targetBlock=require('./outboxTarget').outboxTargetBlock(event,settings);
    let evidence=null,reason=targetBlock?.code||null;
    if(!reason&&['PUBLICATION','BPRS_PROFILE'].includes(event.aggregate_type)){
      const nonce=crypto.randomUUID();
      try{
        const result=await require('./syncWorker.service').signedRequest(settings,'POST','/v1/integration/delivery-evidence',{
          event_id:event.event_id,aggregate_id:event.aggregate_id,aggregate_version:event.aggregate_version,
          payload_checksum:event.payload_checksum,request_nonce:nonce,
        });
        if(!require('./deliveryEvidence').validateEvidence(result,event,settings,nonce))throw Error('EVIDENCE_INVALID');
        evidence=result;
      }catch{reason='PUBLIC_LINEAGE_UNAVAILABLE';}
    } else if(!reason)reason='NOT_A_PUBLIC_PAGE';
    deliveries.push({event_id:event.event_id,aggregate_id:event.aggregate_id,aggregate_type:event.aggregate_type,
      aggregate_version:event.aggregate_version,payload_checksum:event.payload_checksum,event_type:event.event_type,
      state:event.state,acknowledged_at:event.acknowledged_at?.toISOString()||null,evidence,reason});
  }
  return signAcknowledgment({contract_version:1,instance_id:lookup.instance_id,command_id:lookup.command_id,
    command_digest:lookup.command_digest,resource:lookup.resource,request_nonce:headers.nonce,
    checked_at:new Date().toISOString(),source_origin:settings.central_base_url.replace(/\/+$/,''),
    deliveries,scope:'DECISION_EVENT_LINEAGE'},config,new Date(),DELIVERY_PATH);
};
exports.DELIVERY_PATH=DELIVERY_PATH;
exports.handleRecovery = (request,now=new Date()) => require('./controlRecovery.service').handle(request,now,{
  verify:verifyResultRequest,sign:signAcknowledgment,recordNonce,
});
exports.getReviewMedia = async (request, mediaId, now = new Date()) =>
  loadReviewMedia(request, mediaId, now);

exports.COMMAND_PATH = COMMAND_PATH;
exports.RESULT_PATH = RESULT_PATH;
exports.MEDIA_PATH_PREFIX = MEDIA_PATH_PREFIX;
exports._private = {
  adapterConfig,
  rejectionCode,
  requestHeaders,
  resourceSnapshot,
  sameSubjects,
  verifyMediaRequest,
  verifyRequest,
  verifyResultRequest,
};
