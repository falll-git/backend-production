const crypto = require("node:crypto");

const prisma = require("../../config/prisma");
const { AppError } = require("../../utils/errors");
const { getContracts } = require("./contracts");
const {
  createOutbox,
  requireSettings,
} = require("./seputarJaminan.service");

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
    logo_ready: Boolean(row.logo_media?.central_media_id),
    logo_preview_url: row.logo_media_id
      ? `/api/v1/seputar-jaminan/media/${row.logo_media_id}/content`
      : null,
    website_url: row.website_url,
    state: row.state,
    sync_state: row.sync_state,
    aggregate_version: row.aggregate_version,
    lock_version: row.lock_version,
    current_version_id: row.current_version_id,
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

async function contactWithLatest(client, id) {
  return client.sj_whatsapp_contacts.findUnique({
    where: { id },
    include: contactInclude,
  });
}

async function clearOtherDefaultContacts(client, exceptId = null) {
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

exports.getProfile = async () =>
  serializeProfile(
    await prisma.sj_public_profiles.findFirst({ include: profileInclude }),
  );

exports.saveProfileDraft = async (payload, user) =>
  prisma.$transaction(async (client) => {
    await requireSettings(client, "draft_enabled");
    const media = await client.sj_media_assets.findFirst({
      where: {
        id: payload.logo_media_id,
        purpose: "BPRS_PUBLIC_MARK",
        revoked_at: null,
      },
    });
    if (!media) throw new AppError("Logo publik tidak ditemukan.", 404);

    let profile = await client.sj_public_profiles.findFirst({
      include: profileInclude,
    });
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

exports.submitProfile = async (payload, user) =>
  prisma.$transaction(async (client) => {
    const settings = await requireSettings(client, "review_enabled");
    const profile = await client.sj_public_profiles.findFirst({
      include: profileInclude,
    });
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
    return serializeProfile(await profileWithLatest(client, profile.id));
  });

exports.requestProfileRevision = async (payload, user) =>
  prisma.$transaction(async (client) => {
    await requireSettings(client, "review_enabled");
    const profile = await client.sj_public_profiles.findFirst({ include: profileInclude });
    assertVersion(profile, payload.expected_version, "Profil BPRS");
    const version = profile.versions?.[0];
    if (!version || version.state !== "IN_REVIEW") {
      throw new AppError("Profil tidak sedang menunggu pemeriksaan.", 409);
    }
    if (version.created_by === user.id) {
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
        updated_by: user.id,
      },
    });
    return serializeProfile(await profileWithLatest(client, profile.id));
  });

exports.verifyProfile = async (payload, user) =>
  prisma.$transaction(async (client) => {
    const settings = await requireSettings(client, "sync_enabled");
    const profile = await client.sj_public_profiles.findFirst({ include: profileInclude });
    assertVersion(profile, payload.expected_version, "Profil BPRS");
    const version = profile.versions?.[0];
    if (!version || version.state !== "IN_REVIEW") {
      throw new AppError("Profil tidak sedang menunggu pemeriksaan.", 409);
    }
    if (version.created_by === user.id) {
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
      data: { state: "APPROVED", approved_by: user.id, approved_at: now },
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
        updated_by: user.id,
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
  });

exports.listContacts = async () =>
  (await prisma.sj_whatsapp_contacts.findMany({
    where: { revoked_at: null },
    include: contactInclude,
    orderBy: [{ is_default: "desc" }, { label: "asc" }],
  })).map(serializeContact);

exports.createContact = async (payload, user) =>
  prisma.$transaction(async (client) => {
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

exports.updateContact = async (id, payload, user) =>
  prisma.$transaction(async (client) => {
    await requireSettings(client, "draft_enabled");
    const contact = await contactWithLatest(client, id);
    assertVersion(contact, payload.expected_version, "Kontak WhatsApp");
    if (contact.revoked_at) throw new AppError("Kontak yang dicabut tidak dapat diubah.", 409);
    const label = payload.label || contact.label;
    const phone = payload.phone_e164 || contact.phone_e164;
    const latest = contact.versions?.[0];
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

exports.submitContact = async (id, payload, user) =>
  prisma.$transaction(async (client) => {
    await requireSettings(client, "review_enabled");
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
    return serializeContact(await contactWithLatest(client, id));
  });

exports.requestContactRevision = async (id, payload, user) =>
  prisma.$transaction(async (client) => {
    await requireSettings(client, "review_enabled");
    const contact = await contactWithLatest(client, id);
    assertVersion(contact, payload.expected_version, "Kontak WhatsApp");
    const version = contact.versions?.[0];
    if (!version || version.state !== "IN_REVIEW") {
      throw new AppError("Kontak tidak sedang menunggu pemeriksaan.", 409);
    }
    if (version.created_by === user.id) {
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
        updated_by: user.id,
      },
    });
    return serializeContact(await contactWithLatest(client, id));
  });

exports.verifyContact = async (id, payload, user) =>
  prisma.$transaction(async (client) => {
    const settings = await requireSettings(client, "sync_enabled");
    const contact = await contactWithLatest(client, id);
    assertVersion(contact, payload.expected_version, "Kontak WhatsApp");
    const version = contact.versions?.[0];
    if (!version || version.state !== "IN_REVIEW") {
      throw new AppError("Kontak tidak sedang menunggu pemeriksaan.", 409);
    }
    if (version.created_by === user.id) {
      throw new AppError("Pemeriksa harus berbeda dari pembuat kontak.", 409);
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
      data: { state: "VERIFIED", verified_by: user.id, verified_at: now },
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
        updated_by: user.id,
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
  });

exports.revokeContact = async (id, payload, user) =>
  prisma.$transaction(async (client) => {
    const settings = await requireSettings(client, "sync_enabled");
    const contact = await contactWithLatest(client, id);
    assertVersion(contact, payload.expected_version, "Kontak WhatsApp");
    if (contact.revoked_at) return serializeContact(contact);
    if (contact.state !== "VERIFIED") {
      throw new AppError("Hanya kontak terverifikasi yang dapat dicabut.", 409);
    }
    const usedByPublished = await client.sj_publication_versions.count({
      where: {
        whatsapp_contact_version_id: contact.current_version_id,
        published_for_publication: { isNot: null },
      },
    });
    if (usedByPublished > 0) {
      throw new AppError("Kontak masih dipakai katalog tayang. Ganti kontak katalog terlebih dahulu.", 409);
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
        updated_by: user.id,
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
        revoked_at: now.toISOString(),
        reason_code: payload.reason_code,
      },
      priority: 10,
    });
    return serializeContact(await contactWithLatest(client, id));
  });

exports.setDefaultContact = async (id, payload, user) =>
  prisma.$transaction(async (client) => {
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
