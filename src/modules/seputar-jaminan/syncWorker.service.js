const crypto = require("node:crypto");

const prisma = require("../../config/prisma");
const { getContracts } = require("./contracts");
const { createMediaStorage } = require("./mediaStorage");
const { createOutbox } = require("./seputarJaminan.service");

const MAX_ATTEMPTS = 8;

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
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new CentralRequestError("Pusat belum dapat dihubungi.", {
      code: "CENTRAL_UNREACHABLE",
      retryable: true,
    });
  }
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = responseBody?.error?.code || responseBody?.code || `HTTP_${response.status}`;
    throw new CentralRequestError("Pusat menolak permintaan sinkronisasi.", {
      status: response.status,
      code,
      retryable: response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500,
    });
  }
  return responseBody;
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
    if (status.status === "READY") {
      await prisma.sj_media_assets.update({
        where: { id: row.id },
        data: { state: "READY", rejection_code: null },
      });
    } else if (["REJECTED", "REVOKED", "EXPIRED"].includes(status.status)) {
      await prisma.sj_media_assets.update({
        where: { id: row.id },
        data: { state: "REJECTED", rejection_code: status.rejection_code || "CENTRAL_MEDIA_REJECTED" },
      });
    }
    return true;
  }

  if (row.state === "UPLOAD_PENDING") {
    await prisma.sj_media_assets.update({
      where: { id: row.id },
      data: { state: "UPLOADED", upload_session_id: null },
    });
    return true;
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
  await prisma.sj_media_assets.update({
    where: { id: row.id },
    data: {
      state: "UPLOAD_PENDING",
      central_media_id: session.media_id,
      upload_session_id: session.upload_session_id,
    },
  });
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
  await prisma.sj_media_assets.update({
    where: { id: row.id },
    data: {
      state: completed.status === "READY" ? "READY" : "PROCESSING",
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
          data: {
            connection_state: "ACTIVE",
            last_success_at: new Date(),
            last_error_code: null,
          },
        });
      }
    } catch (error) {
      const code = error instanceof CentralRequestError ? error.code : safeLocalErrorCode(error);
      await prisma.sj_media_assets.update({
        where: { id: row.id },
        data: {
          state: error instanceof CentralRequestError && error.retryable ? "UPLOADED" : "REJECTED",
          rejection_code: code,
        },
      });
    }
  }
  return processed;
}

async function claimOutbox(workerId, limit) {
  return prisma.$queryRawUnsafe(
    `WITH candidates AS (
       SELECT id
       FROM public.sj_sync_outbox
       WHERE state IN ('QUEUED', 'RETRYING')
         AND available_at <= CURRENT_TIMESTAMP
         AND (locked_at IS NULL OR locked_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes')
         AND NOT EXISTS (
           SELECT 1 FROM public.sj_sync_outbox earlier
           WHERE earlier.aggregate_id = sj_sync_outbox.aggregate_id
             AND earlier.aggregate_version < sj_sync_outbox.aggregate_version
             AND earlier.state <> 'ACKNOWLEDGED'
         )
       ORDER BY priority ASC, available_at ASC, created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     UPDATE public.sj_sync_outbox target
     SET state = 'SENDING', locked_at = CURRENT_TIMESTAMP, locked_by = $1,
         attempt_count = target.attempt_count + 1
     FROM candidates
     WHERE target.id = candidates.id
     RETURNING target.*`,
    workerId,
    limit,
  );
}

async function acknowledgeAggregate(client, row, response) {
  if (row.aggregate_type === "PUBLICATION") {
    await client.sj_publications.updateMany({
      where: { id: row.aggregate_id, aggregate_version: { lte: row.aggregate_version } },
      data: {
        sync_state: "ACKNOWLEDGED",
        state:
          row.event_type === "UPSERT_PUBLICATION_SNAPSHOT"
            ? "PUBLISHED"
            : undefined,
        last_sync_error_code: null,
      },
    });
  } else if (row.aggregate_type === "WHATSAPP_CONTACT") {
    await client.sj_whatsapp_contacts.updateMany({
      where: { id: row.aggregate_id, aggregate_version: { lte: row.aggregate_version } },
      data: { sync_state: "ACKNOWLEDGED" },
    });
  } else if (row.aggregate_type === "BPRS_PROFILE") {
    await client.sj_public_profiles.updateMany({
      where: { aggregate_version: { lte: row.aggregate_version } },
      data: { sync_state: "ACKNOWLEDGED" },
    });
  }
  await client.sj_integration_settings.updateMany({
    data: { last_success_at: new Date(), last_error_code: null, connection_state: "ACTIVE" },
  });
  return response;
}

async function deliverOutbox(row, activeSettings) {
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
  const contracts = await getContracts();
  contracts.assertValidIntegrationEvent(envelope);
  const response = await signedRequest(activeSettings, "POST", "/v1/ingest/events", envelope);
  await prisma.$transaction(async (client) => {
    await client.sj_sync_attempts.create({
      data: {
        outbox_id: row.id,
        attempt_number: row.attempt_count,
        finished_at: new Date(),
        result: syncAttemptResult("ACKNOWLEDGED"),
        http_status: 200,
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
    await acknowledgeAggregate(client, row, response);
  });
}

async function failOutbox(row, error) {
  const retryable = error instanceof CentralRequestError && error.retryable;
  const exhausted = row.attempt_count >= MAX_ATTEMPTS;
  const nextState = retryable && !exhausted ? "RETRYING" : exhausted ? "FAILED" : "QUARANTINED";
  const delaySeconds = Math.min(3600, 2 ** Math.min(row.attempt_count, 10) * 15);
  const code = safeLocalErrorCode(error);
  await prisma.$transaction(async (client) => {
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
    if (row.aggregate_type === "PUBLICATION") {
      await client.sj_publications.updateMany({
        where: { id: row.aggregate_id },
        data: { sync_state: nextState, last_sync_error_code: code },
      });
    }
    await client.sj_integration_settings.updateMany({
      data: { last_error_at: new Date(), last_error_code: code },
    });
  });
}

async function processOutboxBatch(activeSettings, workerId, limit) {
  const rows = await claimOutbox(workerId, limit);
  for (const row of rows) {
    try {
      await deliverOutbox(row, activeSettings);
    } catch (error) {
      await failOutbox(row, error);
    }
  }
  return rows.length;
}

async function unpublishExpired(activeSettings, limit) {
  const due = await prisma.sj_publications.findMany({
    where: { state: "PUBLISHED", next_reconfirmation_at: { lte: new Date() } },
    orderBy: { next_reconfirmation_at: "asc" },
    take: limit,
  });
  for (const item of due) {
    await prisma.$transaction(async (client) => {
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
      if (["PENDING", "RUNNING"].includes(result.status)) return 1;
      if (result.status === "COMPLETED") {
        const contracts = await getContracts();
        const mismatches = Array.isArray(result.mismatches) ? result.mismatches : [];
        const countChecked = Number.isInteger(result.count_checked) ? result.count_checked : 0;
        const countMismatch = Number.isInteger(result.count_mismatch)
          ? result.count_mismatch
          : mismatches.length;
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
exports.safeLocalErrorCode = safeLocalErrorCode;
exports.signedRequest = signedRequest;
exports.syncAttemptResult = syncAttemptResult;
exports.uploadMedia = uploadMedia;
