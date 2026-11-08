const prisma = require("../../config/prisma");
const { withDatabaseTransaction } = require("../../config/database-rls");
const { AppError } = require("../../utils/errors");
const { payloadDigest } = require("./controlReview.contract");
const { queueReviewSnapshot } = require("./controlReviewSnapshot.service");
const publicationService = require("./seputarJaminan.service");
const profileContactService = require("./profileContact.service");
const mediaService = require("./media.service");
const { lockReviewResource, lockChangeWorkflow } = require("./workflowLock");

const EMPTY_CHECKSUM = "0".repeat(64);
const ACTION_RESOURCE = Object.freeze({
  UNPUBLISH_PUBLICATION: "PUBLICATION",
  ARCHIVE_PUBLICATION: "PUBLICATION",
  RECONFIRM_PUBLICATION: "PUBLICATION",
  HIDE_PROFILE: "PROFILE",
  REVOKE_CONTACT: "CONTACT",
  REVOKE_MEDIA: "MEDIA",
});

function bankSubject(userId) {
  return `ruwang-bank:${userId}`;
}

function safeMedia(row, extra = {}) {
  if (!row || row.state !== "READY" || !row.central_media_id || !row.width || !row.height) return null;
  return {
    source_media_id: row.id,
    central_media_id: row.central_media_id,
    state: "READY",
    detected_mime: row.detected_mime,
    width: row.width,
    height: row.height,
    ...extra,
  };
}

function serialize(row) {
  return {
    id: row.id,
    action: row.action,
    resource_kind: row.resource_kind,
    resource_id: row.resource_id,
    reason: row.reason,
    state: row.state,
    request_version: row.request_version,
    expected_resource_version: row.expected_resource_version,
    expected_resource_checksum: row.expected_resource_checksum,
    impact: require('./readContract').impact(row.impact_json),
    impact_checksum: row.impact_checksum,
    reviewer_note: row.reviewer_note,
    decided_by_subject: row.decided_by_subject,
    decided_at: row.decided_at,
    applied_at: row.applied_at,
    completed_at: row.completed_at,
    sync_event_id: row.sync_event_id,
    failure_code: row.failure_code,
    submitted_at: row.submitted_at,
    updated_at: row.updated_at,
  };
}

function requestChecksum(input) {
  return payloadDigest({
    action: input.action,
    resource_kind: input.resourceKind,
    resource_id: input.resourceId,
    request_version: input.requestVersion,
    expected_resource_version: input.expectedResourceVersion,
    expected_resource_checksum: input.expectedResourceChecksum,
    reason: input.reason,
    impact: input.impact,
  });
}

async function publicationImpact(client, action, id) {
  const publication = await client.sj_publications.findUnique({
    where: { id },
    include: {
      current_version: {
        include: { media: { orderBy: { sort_order: "asc" }, include: { media_asset: true } } },
      },
      published_version: {
        include: { media: { orderBy: { sort_order: "asc" }, include: { media_asset: true } } },
      },
    },
  });
  if (!publication) throw new AppError("Publikasi tidak ditemukan.", 404);
  if (action === "UNPUBLISH_PUBLICATION") {
    const withdrawal = require('./publicationLifecycle').withdrawalEligibility(publication);
    if (!withdrawal.eligible) throw new AppError(withdrawal.reason, 409);
  }
  if (action === "RECONFIRM_PUBLICATION" && (publication.state !== "PUBLISHED" || !publication.published_version)) {
    throw new AppError("Hanya publikasi tayang yang dapat diajukan untuk dikonfirmasi ulang.", 409);
  }
  if (action === "ARCHIVE_PUBLICATION" && publication.state === "ARCHIVED") {
    throw new AppError("Publikasi sudah diarsipkan.", 409);
  }
  if (action === "ARCHIVE_PUBLICATION" && publication.state === "IN_REVIEW") {
    throw new AppError("Selesaikan pemeriksaan konten sebelum mengajukan penghapusan publikasi.", 409);
  }
  const version = publication.published_version || publication.current_version;
  const media = (version?.media || [])
    .map((link) => safeMedia(link.media_asset, {
      is_cover: link.is_cover,
      position: link.sort_order + 1,
      ...(link.alt_text ? { alt_text: link.alt_text } : {}),
    }))
    .filter(Boolean);
  return {
    expectedResourceVersion: publication.lock_version,
    expectedResourceChecksum: version?.payload_checksum || EMPTY_CHECKSUM,
    detail: {
      target_label: version?.title || publication.public_reference_code,
      current_state: publication.state,
      reference_code: publication.public_reference_code,
      public_slug: null,
      expected_public_visibility: action === "RECONFIRM_PUBLICATION" ? "visible" : "not_visible",
      blockers: [],
      affected_publications: 1,
      affected_media: media.length,
      central_synced: publication.aggregate_version > 0,
    },
    media,
  };
}

async function profileImpact(client) {
  const profile = await client.sj_public_profiles.findFirst({
    include: {
      logo_media: true,
      versions: { orderBy: { version_number: "desc" }, take: 1 },
    },
  });
  if (!profile) throw new AppError("Profil BPRS tidak ditemukan.", 404);
  if (profile.state === "HIDDEN") throw new AppError("Profil BPRS sudah dihapus dari publik.", 409);
  if (profile.state !== "VERIFIED") {
    throw new AppError("Hanya profil terverifikasi yang dapat diajukan untuk dihapus.", 409);
  }
  const activePublications = await client.sj_publications.count({
    where: { state: { not: "ARCHIVED" } },
  });
  const latest = profile.versions[0];
  const logo = safeMedia(profile.logo_media);
  return {
    expectedResourceVersion: profile.lock_version,
    expectedResourceChecksum: latest?.payload_checksum || EMPTY_CHECKSUM,
    detail: {
      target_label: profile.display_name,
      current_state: profile.state,
      reference_code: null,
      public_slug: profile.public_slug,
      expected_public_visibility: "not_visible",
      blockers: activePublications > 0
        ? [`${activePublications} publikasi belum diarsipkan.`]
        : [],
      affected_publications: activePublications,
      affected_media: logo ? 1 : 0,
      central_synced: profile.aggregate_version > 0,
    },
    media: logo ? [logo] : [],
  };
}

async function contactImpact(client, id) {
  const contact = await client.sj_whatsapp_contacts.findUnique({
    where: { id },
    include: { versions: { orderBy: { version_number: "desc" }, take: 1 } },
  });
  if (!contact) throw new AppError("Kontak WhatsApp tidak ditemukan.", 404);
  if (contact.revoked_at || contact.state === "REVOKED") throw new AppError("Kontak sudah dicabut.", 409);
  if (contact.state !== "VERIFIED") throw new AppError("Hanya kontak terverifikasi yang dapat diajukan untuk dicabut.", 409);
  const usage = require('./contactUsage');
  const hasUses = await usage.hasContactReferences(client, id);
  // Do not create/send a removal request whose dependencies already prevent it.
  // The peer contract requires an exact count; do not turn unknown into zero.
  if (hasUses) throw new AppError(usage.CONTACT_USED_MESSAGE, 409);
  const latest = contact.versions[0];
  return {
    expectedResourceVersion: contact.lock_version,
    expectedResourceChecksum: latest?.checksum || EMPTY_CHECKSUM,
    detail: {
      target_label: contact.label,
      current_state: contact.state,
      reference_code: null,
      public_slug: null,
      expected_public_visibility: "not_applicable",
      blockers: [],
      // Do not expose counts of publications outside the actor's division.
      affected_publications: 0,
      affected_media: 0,
      central_synced: contact.aggregate_version > 0,
    },
    media: [],
  };
}

async function mediaImpact(client, id) {
  const media = await client.sj_media_assets.findUnique({ where: { id } });
  if (!media) throw new AppError("Gambar tidak ditemukan.", 404);
  if (media.revoked_at || ["REVOKED", "DELETED"].includes(media.state)) {
    throw new AppError("Gambar sudah dicabut.", 409);
  }
  const { publicationUses, profileUses, referenced } = await mediaService.getActiveMediaUsage(client, id);
  const blockers = [];
  if (publicationUses > 0) blockers.push(`Gambar masih digunakan oleh ${publicationUses} publikasi aktif.`);
  if (profileUses > 0) blockers.push("Gambar masih digunakan sebagai logo profil BPRS.");
  if(referenced&&!blockers.length)blockers.push('Gambar masih dipakai versi yang disetujui atau pengirimannya belum selesai.');
  const preview = safeMedia(media);
  return {
    expectedResourceVersion: 0,
    expectedResourceChecksum: media.sha256,
    detail: {
      target_label: media.source_file_name_sanitized,
      current_state: media.state,
      reference_code: null,
      public_slug: null,
      expected_public_visibility: "not_applicable",
      blockers,
      affected_publications: publicationUses,
      affected_media: 1,
      central_synced: Boolean(media.central_media_id),
    },
    media: preview ? [preview] : [],
  };
}

async function buildImpact(client, action, resourceId) {
  if (["UNPUBLISH_PUBLICATION", "ARCHIVE_PUBLICATION", "RECONFIRM_PUBLICATION"].includes(action)) {
    return publicationImpact(client, action, resourceId);
  }
  if (action === "HIDE_PROFILE") return profileImpact(client);
  if (action === "REVOKE_CONTACT") return contactImpact(client, resourceId);
  if (action === "REVOKE_MEDIA") return mediaImpact(client, resourceId);
  throw new AppError("Jenis permintaan tidak didukung.", 422);
}

async function createRequest(client, input, user) {
  const settings = await client.sj_integration_settings.findFirst();
  if (!settings || !settings.review_enabled || settings.review_authority !== "central") {
    throw new AppError("Permintaan pusat hanya tersedia saat pemeriksaan Control aktif.", 409);
  }
  const resourceKind = ACTION_RESOURCE[input.action];
  if (!resourceKind) throw new AppError("Jenis permintaan tidak didukung.", 422);
  await lockChangeWorkflow(client);
  await lockReviewResource(client, { kind: resourceKind.toLowerCase(), id: input.resourceId });
  const impact = await buildImpact(client, input.action, input.resourceId);
  if (input.expectedVersion !== undefined && input.expectedVersion !== impact.expectedResourceVersion) {
    throw new AppError("Data sudah berubah. Muat ulang halaman sebelum mengajukan.", 409);
  }
  const requestVersion = 1;
  const reason = input.reason.trim();
  const checksum = requestChecksum({
    action: input.action,
    resourceKind,
    resourceId: input.resourceId,
    requestVersion,
    expectedResourceVersion: impact.expectedResourceVersion,
    expectedResourceChecksum: impact.expectedResourceChecksum,
    reason,
    impact: impact.detail,
  });
  let request;
  try {
    request = await client.sj_control_change_requests.create({
      data: {
        action: input.action,
        resource_kind: resourceKind,
        resource_id: input.resourceId,
        reason,
        request_version: requestVersion,
        expected_resource_version: impact.expectedResourceVersion,
        expected_resource_checksum: impact.expectedResourceChecksum,
        impact_json: { ...impact.detail, media: impact.media },
        impact_checksum: checksum,
        submitted_by: user.id,
      },
    });
  } catch (error) {
    if (error?.code === "P2002") throw new AppError("Permintaan aktif untuk objek ini sudah tersedia.", 409);
    throw error;
  }
  await queueReviewSnapshot(client, settings, "change_request", request.id);
  return request;
}

exports.createPublicationRequest = async (id, payload, user) =>
  withDatabaseTransaction((client) => createRequest(client, {
    action: payload.action,
    resourceId: id,
    reason: payload.reason,
    expectedVersion: payload.expected_version,
  }, user)).then(serialize);

exports.createProfileRemovalRequest = async (payload, user) =>
  withDatabaseTransaction(async (client) => {
    const profile = await client.sj_public_profiles.findFirst({ select: { id: true } });
    if (!profile) throw new AppError("Profil BPRS tidak ditemukan.", 404);
    return createRequest(client, {
      action: "HIDE_PROFILE",
      resourceId: profile.id,
      reason: payload.reason,
      expectedVersion: payload.expected_version,
    }, user);
  }).then(serialize);

exports.createContactRemovalRequest = async (id, payload, user) =>
  withDatabaseTransaction((client) => createRequest(client, {
    action: "REVOKE_CONTACT",
    resourceId: id,
    reason: payload.reason,
    expectedVersion: payload.expected_version,
  }, user)).then(serialize);

exports.createMediaRemovalRequest = async (id, payload, user) =>
  withDatabaseTransaction((client) => createRequest(client, {
    action: "REVOKE_MEDIA",
    resourceId: id,
    reason: payload.reason,
  }, user)).then(serialize);

exports.resubmitRequest = async (id, payload, user) =>
  withDatabaseTransaction(async (client) => {
    await lockReviewResource(client, { kind: "change_request", id });
    const settings = await client.sj_integration_settings.findFirst();
    if (!settings || !settings.review_enabled || settings.review_authority !== "central") {
      throw new AppError("Permintaan pusat hanya tersedia saat pemeriksaan Control aktif.", 409);
    }
    const request = await client.sj_control_change_requests.findUnique({ where: { id } });
    if (!request) throw new AppError("Permintaan tidak ditemukan.", 404);
    if (request.submitted_by !== user.id) throw new AppError("Hanya pengaju yang dapat mengirim ulang permintaan.", 403);
    if (request.state !== "REVISION_REQUIRED") throw new AppError("Permintaan tidak sedang menunggu perbaikan.", 409);
    if (request.request_version !== payload.expected_version) throw new AppError("Permintaan sudah berubah. Muat ulang halaman.", 409);
    await lockReviewResource(client, { kind: request.resource_kind.toLowerCase(), id: request.resource_id });
    const impact = await buildImpact(client, request.action, request.resource_id);
    const requestVersion = request.request_version + 1;
    const reason = payload.reason.trim();
    const checksum = requestChecksum({
      action: request.action,
      resourceKind: request.resource_kind,
      resourceId: request.resource_id,
      requestVersion,
      expectedResourceVersion: impact.expectedResourceVersion,
      expectedResourceChecksum: impact.expectedResourceChecksum,
      reason,
      impact: impact.detail,
    });
    const updated = await client.sj_control_change_requests.update({
      where: { id },
      data: {
        reason,
        state: "IN_REVIEW",
        request_version: requestVersion,
        expected_resource_version: impact.expectedResourceVersion,
        expected_resource_checksum: impact.expectedResourceChecksum,
        impact_json: { ...impact.detail, media: impact.media },
        impact_checksum: checksum,
        reviewer_note: null,
        failure_code: null,
        submitted_at: new Date(),
      },
    });
    await queueReviewSnapshot(client, settings, "change_request", id);
    return updated;
  }).then(serialize);

exports.listRequests = async ({ page = 1, limit = 20, state, action, paged, cursor:position } = {}) => {
  const where = {
    ...(state ? { state } : {}),
    ...(action ? { action } : {}),
  };
  const cursorCodec=require('./readCursor'),filter={state:state||null,action:action||null};
  const positionWhere=paged?cursorCodec.decodeBy(position,filter,'created_at'):null;
  const [rows, total] = await Promise.all([
    prisma.sj_control_change_requests.findMany({
      where: positionWhere ? { AND: [where, positionWhere] } : where,
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      ...(paged?{take:limit+1}:{skip:(page-1)*limit,take:limit}),
    }),
    paged ? null : prisma.sj_control_change_requests.count({ where }),
  ]);
  const actions=require('./actionRead');
  const context=await actions.context(prisma,rows,'change_request');
  const readRow=row=>({...serialize(row),action_availability:actions.changeRequest(row,context)});
  return paged?cursorCodec.pageBy(rows,limit,filter,readRow,'created_at'):{ items: rows.map(readRow), pagination: require('./readContract').pagination(page,limit,total) };
};

async function locateLifecycleOutbox(client, request, appliedAt) {
  const eventType = {
    UNPUBLISH_PUBLICATION: "UNPUBLISH_PUBLICATION",
    ARCHIVE_PUBLICATION: "ARCHIVE_PUBLICATION",
    RECONFIRM_PUBLICATION: "UPSERT_PUBLICATION_SNAPSHOT",
    HIDE_PROFILE: "HIDE_BPRS_PROFILE",
    REVOKE_CONTACT: "REVOKE_WHATSAPP_CONTACT",
    REVOKE_MEDIA: "REVOKE_MEDIA",
  }[request.action];
  if (!eventType) return null;
  let aggregateId = request.resource_id;
  if (request.action === "HIDE_PROFILE") {
    const settings = await client.sj_integration_settings.findFirst({ select: { institution_id: true } });
    aggregateId = settings?.institution_id || null;
  } else if (request.action === "REVOKE_MEDIA") {
    const media = await client.sj_media_assets.findUnique({
      where: { id: request.resource_id },
      select: { central_media_id: true },
    });
    aggregateId = media?.central_media_id || null;
  }
  if (!aggregateId) return null;
  const where = {
    event_type: eventType,
    aggregate_id: aggregateId,
    created_at: { gte: new Date(appliedAt.getTime() - 1000) },
  };
  return client.sj_sync_outbox.findFirst({ where, orderBy: { created_at: "desc" } });
}

async function executeLifecycle(client, request, actorSubject) {
  if (["UNPUBLISH_PUBLICATION", "ARCHIVE_PUBLICATION", "RECONFIRM_PUBLICATION"].includes(request.action)) {
    return publicationService.applyControlPublicationLifecycle(
      client,
      request.action,
      request.resource_id,
      request.expected_resource_version,
      actorSubject,
    );
  }
  if (request.action === "HIDE_PROFILE") {
    return profileContactService.applyControlProfileLifecycle(
      client,
      request.expected_resource_version,
      actorSubject,
    );
  }
  if (request.action === "REVOKE_CONTACT") {
    return profileContactService.applyControlContactLifecycle(
      client,
      request.resource_id,
      request.expected_resource_version,
      actorSubject,
    );
  }
  if (request.action === "REVOKE_MEDIA") {
    return mediaService.applyControlMediaLifecycle(client, request.resource_id);
  }
  throw new AppError("Tindakan perubahan tidak didukung.", 422);
}

exports.applyControlChangeDecision = async (client, command) => {
  const request = await client.sj_control_change_requests.findUnique({
    where: { id: command.resource.id },
  });
  if (!request) throw new AppError("Permintaan perubahan tidak ditemukan.", 404);
  if (request.state !== "IN_REVIEW") throw new AppError("Permintaan tidak sedang menunggu pemeriksaan.", 409);
  if (request.request_version !== command.expected_version || request.impact_checksum !== command.expected_checksum) {
    throw new AppError("Permintaan sudah berubah. Muat ulang antrean pemeriksaan.", 409);
  }
  const now = new Date();
  const note = String(command.reason || "").trim();
  if (!note) throw new AppError("Catatan keputusan wajib diisi.", 422);
  if (command.decision === "request_revision") {
    return client.sj_control_change_requests.update({
      where: { id: request.id },
      data: { state: "REVISION_REQUIRED", reviewer_note: note },
    });
  }
  if (command.decision === "reject") {
    return client.sj_control_change_requests.update({
      where: { id: request.id },
      data: {
        state: "REJECTED",
        reviewer_note: note,
        decided_by_subject: command.actor_subject,
        decided_at: now,
      },
    });
  }
  await lockReviewResource(client, { kind: request.resource_kind.toLowerCase(), id: request.resource_id });
  const current = await buildImpact(client, request.action, request.resource_id);
  const currentChecksum = requestChecksum({
    action: request.action,
    resourceKind: request.resource_kind,
    resourceId: request.resource_id,
    requestVersion: request.request_version,
    expectedResourceVersion: current.expectedResourceVersion,
    expectedResourceChecksum: current.expectedResourceChecksum,
    reason: request.reason,
    impact: current.detail,
  });
  if (currentChecksum !== request.impact_checksum) {
    throw new AppError("Dampak permintaan berubah. Bank harus mengajukan ulang.", 409);
  }
  if (current.detail.blockers.length > 0) {
    throw new AppError("Permintaan masih memiliki ketergantungan yang harus diselesaikan.", 409);
  }
  await executeLifecycle(client, request, command.actor_subject);
  const outbox = await locateLifecycleOutbox(client, request, now);
  return client.sj_control_change_requests.update({
    where: { id: request.id },
    data: {
      state: outbox ? "APPLIED" : "COMPLETED",
      reviewer_note: note,
      decided_by_subject: command.actor_subject,
      decided_at: now,
      applied_at: now,
      sync_event_id: outbox?.event_id || null,
      completed_at: outbox ? null : now,
    },
  });
};

exports.buildImpact = buildImpact;
exports.bankSubject = bankSubject;
exports.requestChecksum = requestChecksum;
exports.serialize = serialize;
