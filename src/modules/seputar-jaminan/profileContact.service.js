const crypto = require("node:crypto");

const prisma = require("../../config/prisma");
const { withDatabaseTransaction } = require("../../config/database-rls");
const { AppError } = require("../../utils/errors");
const { getContracts } = require("./contracts");
const {
  createOutbox,
  requireSettings,
} = require("./seputarJaminan.service");
const { queueReviewSnapshot } = require("./controlReviewSnapshot.service");

const profileInclude = Object.freeze({
  current_version: true,
  logo_media: true,
  versions: { orderBy: { version_number: "desc" }, take: 1 },
});

const contactInclude = Object.freeze({
  current_version: true,
  versions: { orderBy: { version_number: "desc" }, take: 1 },
});

function assertVersion(row, expectedVersion, label) {
  if (!row) throw new AppError(`${label} tidak ditemukan.`, 404);
  if (row.lock_version !== expectedVersion) {
    throw new AppError("Data sudah berubah. Muat ulang halaman sebelum melanjutkan.", 409);
  }
}

function assertReviewAuthority(settings, central) {
  const authority = settings.review_authority || "local";
  if ((central && authority !== "central") || (!central && authority !== "local")) {
    throw new AppError(central ? "Pemeriksaan pusat belum diaktifkan." : "Keputusan pemeriksaan hanya dapat dilakukan melalui Ruwang Control.", 409);
  }
}

function profilePayload(settings, profile, media, updatedAt) {
  return {
    institution_id: settings.institution_id,
    public_name: profile.display_name,
    public_mark: media.central_media_id,
    short_description: profile.short_description,
    office_city_regency: profile.city_regency,
    office_province: profile.province,
    profile_updated_at: updatedAt.toISOString(),
  };
}

function serializeProfile(row) {
  if (!row) return null;
  const latest = row.versions?.[0] || null;
  return {
    id: row.id,
    display_name: row.display_name,
    public_slug: row.public_slug,
    city_regency: row.city_regency,
    province: row.province,
    short_description: row.short_description,
    logo_media_id: row.logo_media_id,
    logo_ready: require('./mediaReadiness').isMediaReady(row.logo_media),
    logo_preview_url: row.logo_media_id
      ? `/api/v1/seputar-jaminan/media/${row.logo_media_id}/content`
      : null,
    website_url: row.website_url,
    state: row.state,
    sync_state: row.sync_state,
    aggregate_version: row.aggregate_version,
    lock_version: row.lock_version,
    current_version_id: row.current_version_id,
    approved_version: row.current_version ? {
      id: row.current_version.id,
      version_number: row.current_version.version_number,
      payload: require('./readContract').profilePayload(row.current_version.payload_json),
      checksum: row.current_version.payload_checksum,
    } : null,
    pending_version: latest && latest.id !== row.current_version_id ? {
      id: latest.id, version_number: latest.version_number, state: latest.state,
      payload: require('./readContract').profilePayload(latest.payload_json), checksum: latest.payload_checksum,
    } : null,
    draft_version_id: latest?.state === "DRAFT" ? latest.id : null,
    rejection_reason:
      latest?.state === "REVISION_REQUIRED" ? latest.rejection_reason : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeContact(row) {
  const latest = row.versions?.[0] || null;
  return {
    id: row.id,
    label: row.label,
    phone_e164: row.phone_e164,
    state: row.state,
    is_default: row.is_default,
    sync_state: row.sync_state,
    aggregate_version: row.aggregate_version,
    lock_version: row.lock_version,
    current_version_id: row.current_version_id,
    approved_version: row.current_version ? {
      id: row.current_version.id, version_number: row.current_version.version_number,
      label: row.current_version.label, phone_e164: row.current_version.phone_e164,
      checksum: row.current_version.checksum,
    } : null,
    pending_version: latest && latest.id !== row.current_version_id ? {
      id: latest.id, version_number: latest.version_number, state: latest.state,
      label: latest.label, phone_e164: latest.phone_e164, checksum: latest.checksum,
    } : null,
    draft_version_id: latest?.state === "DRAFT" ? latest.id : null,
    rejection_reason:
      latest?.state === "REVISION_REQUIRED" ? latest.rejection_reason : null,
    last_verified_at: row.last_verified_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function profileWithLatest(client, id) {
  return client.sj_public_profiles.findUnique({
    where: { id },
    include: profileInclude,
  });
}

async function lockedProfile(client) {
  await require('./workflowLock').lockProfile(client);
  return client.sj_public_profiles.findFirst({ include: profileInclude });
}

async function contactWithLatest(client, id) {
  await require('./workflowLock').lockContact(client, id);
  return client.sj_whatsapp_contacts.findUnique({
    where: { id },
    include: contactInclude,
  });
}

async function clearOtherDefaultContacts(client, exceptId = null) {
  await require('./workflowLock').lockContactReferences(client);
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext('ruwang:sj:whatsapp-default'))
  `;
  const defaults = await client.sj_whatsapp_contacts.findMany({
    where: {
      is_default: true,
      revoked_at: null,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (defaults.length > 0) {
    await client.sj_whatsapp_contacts.updateMany({
      where: { id: { in: defaults.map((row) => row.id) } },
      data: { is_default: false, lock_version: { increment: 1 } },
    });
  }
}

exports.getProfile = async () => {
  const row=await prisma.sj_public_profiles.findFirst({include:profileInclude});
  if(!row)return null;
  const actions=require('./actionRead'),context=await actions.context(prisma,[row],'profile');
  return {...serializeProfile(row),action_availability:actions.profile(row,context)};
};

exports.saveProfileDraft = async (payload, user, transaction = withDatabaseTransaction) =>
  transaction(async (client) => {
    await requireSettings(client, "draft_enabled");
    const media = await client.sj_media_assets.findFirst({
      where: {
        id: payload.logo_media_id,
        purpose: "BPRS_PUBLIC_MARK",
        revoked_at: null,
      },
    });
    if (!media) throw new AppError("Logo publik tidak ditemukan.", 404);

    let profile = await lockedProfile(client);
    if (profile && payload.expected_version === undefined) {
      throw new AppError("Versi data profil wajib disertakan.", 422);
    }
    if (profile) assertVersion(profile, payload.expected_version, "Profil BPRS");

    if (!profile) {
      profile = await client.sj_public_profiles.create({
        data: {
          display_name: payload.display_name,
          public_slug: payload.public_slug,
          city_regency: payload.city_regency,
          province: payload.province,
          short_description: payload.short_description,
          logo_media_id: payload.logo_media_id,
          website_url: payload.website_url || null,
          created_by: user.id,
          updated_by: user.id,
        },
      });
    }

    const latest = profile.versions?.[0] || null;
    if (latest?.state === "IN_REVIEW") {
      throw new AppError(
        "Profil sedang diperiksa. Tunggu keputusan sebelum membuat perubahan baru.",
        409,
      );
    }
    const nextProfile = {
      display_name: payload.display_name,
      public_slug: payload.public_slug,
      city_regency: payload.city_regency,
      province: payload.province,
      short_description: payload.short_description,
      logo_media_id: payload.logo_media_id,
      website_url: payload.website_url || null,
    };
    const draftPayload = {
      public_name: nextProfile.display_name,
      public_slug: nextProfile.public_slug,
      short_description: nextProfile.short_description,
      office_city_regency: nextProfile.city_regency,
      office_province: nextProfile.province,
      logo_media_id: nextProfile.logo_media_id,
      website_url: nextProfile.website_url,
    };
    const contracts = await getContracts();
    let draft;
    if (latest?.state === "DRAFT") {
      draft = await client.sj_public_profile_versions.update({
        where: { id: latest.id },
        data: {
          payload_json: draftPayload,
          payload_checksum: contracts.payloadChecksum(draftPayload),
          created_by: user.id,
        },
      });
    } else {
      draft = await client.sj_public_profile_versions.create({
        data: {
          profile_id: profile.id,
          version_number: (latest?.version_number || 0) + 1,
          payload_json: draftPayload,
          payload_checksum: contracts.payloadChecksum(draftPayload),
          created_by: user.id,
        },
      });
    }
    await client.sj_public_profiles.update({
      where: { id: profile.id },
      data: {
        ...nextProfile,
        state: "DRAFT",
        lock_version: { increment: 1 },
        updated_by: user.id,
      },
    });
    return serializeProfile(await profileWithLatest(client, profile.id));
  });

exports.submitProfile = async (payload, user, transaction = withDatabaseTransaction) =>
  transaction(async (client) => {
    const settings = await requireSettings(client, "review_enabled");
    const profile = await lockedProfile(client);
    assertVersion(profile, payload.expected_version, "Profil BPRS");
    const draft = profile.versions?.[0];
    if (!draft || draft.state !== "DRAFT") {
      throw new AppError("Profil tidak memiliki draf yang dapat diajukan.", 409);
    }
    if (
      !profile.logo_media ||
      profile.logo_media.state !== "READY" ||
      !profile.logo_media.central_media_id
    ) {
      throw new AppError("Logo harus selesai disinkronkan sebelum profil diajukan.", 409);
    }
    const now = new Date();
    const canonicalPayload = profilePayload(
      settings,
      profile,
      profile.logo_media,
      now,
    );
    const contracts = await getContracts();
    await client.sj_public_profile_versions.update({
      where: { id: draft.id },
      data: {
        state: "IN_REVIEW",
        submitted_at: now,
        payload_json: canonicalPayload,
        payload_checksum: contracts.payloadChecksum(canonicalPayload),
      },
    });
    await client.sj_public_profiles.update({
      where: { id: profile.id },
      data: {
        state: "IN_REVIEW",
        lock_version: { increment: 1 },
        updated_by: user.id,
      },
    });
    await queueReviewSnapshot(client, settings, "profile", profile.id);
    return serializeProfile(await profileWithLatest(client, profile.id));
  });

async function requestProfileRevisionInTransaction(client, payload, actor) {
    const settings = await requireSettings(client, "review_enabled");
    assertReviewAuthority(settings, actor.type === "control");
    const profile = await lockedProfile(client);
    assertVersion(profile, payload.expected_version, "Profil BPRS");
    const version = profile.versions?.[0];
    if (!version || version.state !== "IN_REVIEW") {
      throw new AppError("Profil tidak sedang menunggu pemeriksaan.", 409);
    }
    if (actor.type === "bank" && [version.created_by, profile.updated_by].includes(actor.id)) {
      throw new AppError("Pemeriksa harus berbeda dari pembuat profil.", 409);
    }
    await client.sj_public_profile_versions.update({
      where: { id: version.id },
      data: { state: "REVISION_REQUIRED", rejection_reason: payload.reason },
    });
    await client.sj_public_profiles.update({
      where: { id: profile.id },
      data: {
        state: "REVISION_REQUIRED",
        lock_version: { increment: 1 },
        ...(actor.type === "bank" ? { updated_by: actor.id } : {}),
      },
    });
    return serializeProfile(await profileWithLatest(client, profile.id));
}

exports.requestProfileRevision = async (payload, user) =>
  withDatabaseTransaction((client) => requestProfileRevisionInTransaction(client, payload, { type: "bank", id: user.id }));

async function verifyProfileInTransaction(client, payload, actor) {
    const settings = await requireSettings(client, "sync_enabled");
    assertReviewAuthority(settings, actor.type === "control");
    const profile = await lockedProfile(client);
    assertVersion(profile, payload.expected_version, "Profil BPRS");
    const version = profile.versions?.[0];
    if (!version || version.state !== "IN_REVIEW") {
      throw new AppError("Profil tidak sedang menunggu pemeriksaan.", 409);
    }
    if (actor.type === "bank" && [version.created_by, profile.updated_by].includes(actor.id)) {
      throw new AppError("Pemeriksa harus berbeda dari pembuat profil.", 409);
    }
    if (
      !profile.logo_media ||
      profile.logo_media.state !== "READY" ||
      !profile.logo_media.central_media_id
    ) {
      throw new AppError("Logo publik belum siap digunakan.", 409);
    }
    const now = new Date();
    const canonicalPayload = profilePayload(
      settings,
      profile,
      profile.logo_media,
      version.submitted_at,
    );
    const contracts = await getContracts();
    if (contracts.payloadChecksum(canonicalPayload) !== version.payload_checksum) {
      throw new AppError("Data profil berubah setelah diajukan. Ajukan ulang profil.", 409);
    }
    await client.sj_public_profile_versions.update({
      where: { id: version.id },
      data: {
        state: "APPROVED",
        approved_by: actor.type === "bank" ? actor.id : null,
        approved_by_subject: actor.type === "control" ? actor.subject : null,
        approved_at: now,
      },
    });
    const aggregateVersion = profile.aggregate_version + 1;
    await client.sj_public_profiles.update({
      where: { id: profile.id },
      data: {
        current_version_id: version.id,
        state: "VERIFIED",
        sync_state: "QUEUED",
        aggregate_version: aggregateVersion,
        lock_version: { increment: 1 },
        ...(actor.type === "bank" ? { updated_by: actor.id } : {}),
      },
    });
    await createOutbox(client, settings, {
      eventType: "UPSERT_BPRS_PROFILE",
      aggregateType: "BPRS_PROFILE",
      aggregateId: settings.institution_id,
      aggregateVersion,
      payload: canonicalPayload,
      priority: 20,
    });
    return serializeProfile(await profileWithLatest(client, profile.id));
}

exports.verifyProfile = async (payload, user) =>
  withDatabaseTransaction((client) => verifyProfileInTransaction(client, payload, { type: "bank", id: user.id }));

exports.listContacts = async (query = {}) => {
  const cursor=require('./readCursor'),filter=['contacts',query.state||'',query.search||''];
  const rows=await prisma.sj_whatsapp_contacts.findMany({
    where: { revoked_at: null,
      ...(query.state?{state:query.state}:{}),...(query.search?{label:{contains:query.search,mode:'insensitive'}}:{}),
      ...(query.paged?cursor.decode(query.cursor,filter):{}),
    },
    include: contactInclude,
    orderBy: query.paged?[{created_at:'desc'},{id:'desc'}]:[{ is_default: "desc" }, { label: "asc" }, { id: "asc" }],
    ...(query.paged?{take:query.limit+1}:{}),
  });
  const actions=require('./actionRead'),context=await actions.context(prisma,rows,'contact');
  const serialize=row=>({...serializeContact(row),action_availability:actions.contact(row,context)});
  return query.paged?cursor.page(rows,query.limit,filter,serialize):rows.map(serialize);
};

// Read through the request-scoped Prisma client/RLS, not the mutation helper
// (which acquires locks). Missing and inaccessible IDs share the same response.
exports.getContact = async (id) => {
  const row = await prisma.sj_whatsapp_contacts.findUnique({where: {id}, include: contactInclude});
  if (!row) throw new AppError('Kontak tidak ditemukan atau tidak dapat diakses.', 404);
  const actions = require('./actionRead');
  const context = await actions.context(prisma, [row], 'contact');
  return {...serializeContact(row), action_availability: actions.contact(row, context)};
};

exports.createContact = async (payload, user, transaction = withDatabaseTransaction) =>
  transaction(async (client) => {
    await requireSettings(client, "draft_enabled");
    const contact = await client.sj_whatsapp_contacts.create({
      data: {
        label: payload.label,
        phone_e164: payload.phone_e164,
        phone_normalized: payload.phone_e164.replace(/\D/g, ""),
        is_default: false,
        created_by: user.id,
        updated_by: user.id,
      },
    });
    const checksum = crypto
      .createHash("sha256")
      .update(`${payload.label}\n${payload.phone_e164}\n1`)
      .digest("hex");
    await client.sj_whatsapp_contact_versions.create({
      data: {
        contact_id: contact.id,
        version_number: 1,
        label: payload.label,
        phone_e164: payload.phone_e164,
        checksum,
        created_by: user.id,
      },
    });
    await client.sj_whatsapp_contacts.update({
      where: { id: contact.id },
      data: { lock_version: { increment: 1 } },
    });
    return serializeContact(await contactWithLatest(client, contact.id));
  });

exports.updateContact = async (id, payload, user, transaction = withDatabaseTransaction) =>
  transaction(async (client) => {
    await requireSettings(client, "draft_enabled");
    const contact = await contactWithLatest(client, id);
    assertVersion(contact, payload.expected_version, "Kontak WhatsApp");
    if (contact.revoked_at) throw new AppError("Kontak yang dicabut tidak dapat diubah.", 409);
    const label = payload.label || contact.label;
    const phone = payload.phone_e164 || contact.phone_e164;
    const latest = contact.versions?.[0];
    if (latest?.state === "IN_REVIEW") {
      throw new AppError(
        "Kontak sedang diperiksa. Tunggu keputusan sebelum membuat perubahan baru.",
        409,
      );
    }
    const checksum = crypto
      .createHash("sha256")
      .update(`${label}\n${phone}\n1`)
      .digest("hex");
    if (latest?.state === "DRAFT") {
      await client.sj_whatsapp_contact_versions.update({
        where: { id: latest.id },
        data: { label, phone_e164: phone, checksum, created_by: user.id },
      });
    } else {
      await client.sj_whatsapp_contact_versions.create({
        data: {
          contact_id: id,
          version_number: (latest?.version_number || 0) + 1,
          label,
          phone_e164: phone,
          checksum,
          created_by: user.id,
        },
      });
    }
    await client.sj_whatsapp_contacts.update({
      where: { id },
      data: {
        label,
        phone_e164: phone,
        phone_normalized: phone.replace(/\D/g, ""),
        state: "DRAFT",
        lock_version: { increment: 1 },
        updated_by: user.id,
      },
    });
    return serializeContact(await contactWithLatest(client, id));
  });

exports.submitContact = async (id, payload, user, transaction = withDatabaseTransaction) =>
  transaction(async (client) => {
    const settings = await requireSettings(client, "review_enabled");
    const contact = await contactWithLatest(client, id);
    assertVersion(contact, payload.expected_version, "Kontak WhatsApp");
    const version = contact.versions?.[0];
    if (!version || version.state !== "DRAFT") {
      throw new AppError("Kontak tidak memiliki draf yang dapat diajukan.", 409);
    }
    await client.sj_whatsapp_contact_versions.update({
      where: { id: version.id },
      data: { state: "IN_REVIEW", submitted_at: new Date() },
    });
    await client.sj_whatsapp_contacts.update({
      where: { id },
      data: {
        state: "IN_REVIEW",
        lock_version: { increment: 1 },
        updated_by: user.id,
      },
    });
    await queueReviewSnapshot(client, settings, "contact", id);
    return serializeContact(await contactWithLatest(client, id));
  });

async function requestContactRevisionInTransaction(client, id, payload, actor) {
    const settings = await requireSettings(client, "review_enabled");
    assertReviewAuthority(settings, actor.type === "control");
    const contact = await contactWithLatest(client, id);
    assertVersion(contact, payload.expected_version, "Kontak WhatsApp");
    const version = contact.versions?.[0];
    if (!version || version.state !== "IN_REVIEW") {
      throw new AppError("Kontak tidak sedang menunggu pemeriksaan.", 409);
    }
    if (actor.type === "bank" && [version.created_by, contact.updated_by].includes(actor.id)) {
      throw new AppError("Pemeriksa harus berbeda dari pembuat kontak.", 409);
    }
    await client.sj_whatsapp_contact_versions.update({
      where: { id: version.id },
      data: { state: "REVISION_REQUIRED", rejection_reason: payload.reason },
    });
    await client.sj_whatsapp_contacts.update({
      where: { id },
      data: {
        state: "REJECTED",
        lock_version: { increment: 1 },
        ...(actor.type === "bank" ? { updated_by: actor.id } : {}),
      },
    });
    return serializeContact(await contactWithLatest(client, id));
}

exports.requestContactRevision = async (id, payload, user) =>
  withDatabaseTransaction((client) => requestContactRevisionInTransaction(client, id, payload, { type: "bank", id: user.id }));

async function verifyContactInTransaction(client, id, payload, actor) {
    const settings = await requireSettings(client, "sync_enabled");
    assertReviewAuthority(settings, actor.type === "control");
    const contact = await contactWithLatest(client, id);
    assertVersion(contact, payload.expected_version, "Kontak WhatsApp");
    const version = contact.versions?.[0];
    if (!version || version.state !== "IN_REVIEW") {
      throw new AppError("Kontak tidak sedang menunggu pemeriksaan.", 409);
    }
    if (actor.type === "bank" && [version.created_by, contact.updated_by].includes(actor.id)) {
      throw new AppError("Pemeriksa harus berbeda dari pembuat kontak.", 409);
    }
    const checksum = crypto.createHash('sha256')
      .update(`${version.label}\n${version.phone_e164}\n${version.message_template_version}`)
      .digest('hex');
    if (checksum !== version.checksum) {
      throw new AppError('Data kontak tidak cocok dengan versi yang diajukan. Muat ulang dan periksa pengajuan.', 409);
    }
    const now = new Date();
    const eventPayload = {
      whatsapp_contact_id: contact.id,
      institution_id: settings.institution_id,
      phone_e164: version.phone_e164,
      status: "VERIFIED",
      template_version: version.message_template_version,
      verified_at: now.toISOString(),
    };
    await client.sj_whatsapp_contact_versions.update({
      where: { id: version.id },
      data: {
        state: "VERIFIED",
        verified_by: actor.type === "bank" ? actor.id : null,
        verified_by_subject: actor.type === "control" ? actor.subject : null,
        verified_at: now,
      },
    });
    const aggregateVersion = contact.aggregate_version + 1;
    await client.sj_whatsapp_contacts.update({
      where: { id },
      data: {
        current_version_id: version.id,
        state: "VERIFIED",
        sync_state: "QUEUED",
        aggregate_version: aggregateVersion,
        lock_version: { increment: 1 },
        last_verified_at: now,
        ...(actor.type === "bank" ? { updated_by: actor.id } : {}),
      },
    });
    await createOutbox(client, settings, {
      eventType: "UPSERT_WHATSAPP_CONTACT",
      aggregateType: "WHATSAPP_CONTACT",
      aggregateId: id,
      aggregateVersion,
      payload: eventPayload,
      priority: 20,
    });
    return serializeContact(await contactWithLatest(client, id));
}

exports.verifyContact = async (id, payload, user) =>
  withDatabaseTransaction((client) => verifyContactInTransaction(client, id, payload, { type: "bank", id: user.id }));

exports.applyControlProfileDecision = async (client, command) => {
  const actor = { type: "control", subject: command.actor_subject };
  return command.decision === "approve"
    ? verifyProfileInTransaction(client, { expected_version: command.expected_version }, actor)
    : requestProfileRevisionInTransaction(client, { expected_version: command.expected_version, reason: command.reason }, actor);
};

exports.applyControlContactDecision = async (client, command) => {
  const actor = { type: "control", subject: command.actor_subject };
  return command.decision === "approve"
    ? verifyContactInTransaction(client, command.resource.id, { expected_version: command.expected_version }, actor)
    : requestContactRevisionInTransaction(client, command.resource.id, { expected_version: command.expected_version, reason: command.reason }, actor);
};

async function revokeContactInTransaction(client, id, payload, actor) {
    const settings = await requireSettings(client, "sync_enabled");
    assertReviewAuthority(settings, actor.type === "control");
    const contact = await contactWithLatest(client, id);
    assertVersion(contact, payload.expected_version, "Kontak WhatsApp");
    if (contact.revoked_at) return serializeContact(contact);
    if (contact.state !== "VERIFIED") {
      throw new AppError("Hanya kontak terverifikasi yang dapat dicabut.", 409);
    }
    const usage = require('./contactUsage');
    if (await usage.hasContactReferences(client, id)) {
      throw new AppError(usage.CONTACT_USED_MESSAGE, 409);
    }
    const now = new Date();
    const aggregateVersion = contact.aggregate_version + 1;
    await client.sj_whatsapp_contacts.update({
      where: { id },
      data: {
        state: "REVOKED",
        sync_state: "QUEUED",
        aggregate_version: aggregateVersion,
        lock_version: { increment: 1 },
        is_default: false,
        revoked_at: now,
        ...(actor.type === "bank" ? { updated_by: actor.id } : {}),
      },
    });
    await createOutbox(client, settings, {
      eventType: "REVOKE_WHATSAPP_CONTACT",
      aggregateType: "WHATSAPP_CONTACT",
      aggregateId: id,
      aggregateVersion,
      payload: {
        whatsapp_contact_id: id,
        institution_id: settings.institution_id,
        status: "REVOKED",
        revoked_at: now.toISOString(),
        reason_code: payload.reason_code,
      },
      priority: 10,
    });
    return serializeContact(await contactWithLatest(client, id));
}

exports.revokeContact = async (id, payload, user) =>
  withDatabaseTransaction((client) =>
    revokeContactInTransaction(client, id, payload, { type: "bank", id: user.id }));

async function hideProfileInTransaction(client, expectedVersion, actor) {
  const settings = await requireSettings(client, "sync_enabled");
  assertReviewAuthority(settings, actor.type === "control");
  const profile = await lockedProfile(client);
  assertVersion(profile, expectedVersion, "Profil BPRS");
  if (profile.state === "HIDDEN") return serializeProfile(profile);
  if (profile.state !== "VERIFIED") {
    throw new AppError("Hanya profil terverifikasi yang dapat dihapus dari publik.", 409);
  }
  const activePublications = await client.sj_publications.count({
    where: { state: { not: "ARCHIVED" } },
  });
  if (activePublications > 0) {
    throw new AppError("Arsipkan seluruh publikasi sebelum menghapus profil BPRS.", 409);
  }
  const now = new Date();
  const aggregateVersion = profile.aggregate_version + 1;
  await client.sj_public_profiles.update({
    where: { id: profile.id },
    data: {
      state: "HIDDEN",
      sync_state: "QUEUED",
      aggregate_version: aggregateVersion,
      lock_version: { increment: 1 },
      ...(actor.type === "bank" ? { updated_by: actor.id } : {}),
    },
  });
  await createOutbox(client, settings, {
    eventType: "HIDE_BPRS_PROFILE",
    aggregateType: "BPRS_PROFILE",
    aggregateId: settings.institution_id,
    aggregateVersion,
    payload: {
      institution_id: settings.institution_id,
      reason_code: "PROFILE_REMOVED",
      hidden_at: now.toISOString(),
    },
    priority: 10,
  });
  return serializeProfile(await profileWithLatest(client, profile.id));
}

exports.applyControlProfileLifecycle = async (client, expectedVersion, actorSubject) =>
  hideProfileInTransaction(client, expectedVersion, { type: "control", subject: actorSubject });

exports.applyControlContactLifecycle = async (client, id, expectedVersion, actorSubject) =>
  revokeContactInTransaction(client, id, {
    expected_version: expectedVersion,
    reason_code: "OWNER_REQUEST",
  }, { type: "control", subject: actorSubject });

exports.setDefaultContact = async (id, payload, user) =>
  withDatabaseTransaction(async (client) => {
    await clearOtherDefaultContacts(client, id);
    const contact = await contactWithLatest(client, id);
    assertVersion(contact, payload.expected_version, "Kontak WhatsApp");
    if (contact.state !== "VERIFIED" || contact.revoked_at) {
      throw new AppError("Hanya kontak terverifikasi yang dapat dijadikan kontak utama.", 409);
    }
    await client.sj_whatsapp_contacts.update({
      where: { id },
      data: {
        is_default: true,
        lock_version: { increment: 1 },
        updated_by: user.id,
      },
    });
    return serializeContact(await contactWithLatest(client, id));
  });
