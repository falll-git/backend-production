const crypto = require("node:crypto");

const prisma = require("../../config/prisma");
const { withDatabaseTransaction } = require("../../config/database-rls");
const { AppError } = require("../../utils/errors");
const { getContracts } = require("./contracts");
const { queueReviewSnapshot } = require("./controlReviewSnapshot.service");
const { assertCurrentSubmissionDependencies } = require('./submissionDependencies');

const ROOT_MENU_URL = "/dashboard/seputar-jaminan";
const PUBLIC_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CATEGORY_TO_PUBLIC = Object.freeze({
  LAND: "TANAH",
  BUILDING: "BANGUNAN",
  MACHINE_EQUIPMENT: "MESIN_PERALATAN",
  VEHICLE: "KENDARAAN",
});
const PUBLIC_STATE_BY_EVENT = Object.freeze({
  UPSERT_BPRS_PROFILE: "ACTIVE",
  HIDE_BPRS_PROFILE: "HIDDEN",
  UPSERT_WHATSAPP_CONTACT: "VERIFIED",
  REVOKE_WHATSAPP_CONTACT: "REVOKED",
  UPSERT_PUBLICATION_SNAPSHOT: "PUBLISHED",
  UNPUBLISH_PUBLICATION: "UNPUBLISHED",
  ARCHIVE_PUBLICATION: "ARCHIVED",
  REVOKE_MEDIA: "REVOKED",
});

const versionInclude = Object.freeze({
  taxonomy_item: true,
  land_detail: true,
  building_detail: true,
  machine_detail: true,
  vehicle_detail: true,
  media: {
    orderBy: { sort_order: "asc" },
    include: { media_asset: true },
  },
  whatsapp_contact_version: {
    include: { contact: true },
  },
  profile_version: {
    include: { profile: true },
  },
});

const publicationInclude = Object.freeze({
  current_version: { include: versionInclude },
  published_version: { include: versionInclude },
  owner_division: { select: { id: true, name: true } },
});

function newPublicReferenceCode() {
  let value = "";
  for (let index = 0; index < 8; index += 1) {
    value += PUBLIC_CODE_ALPHABET[crypto.randomInt(PUBLIC_CODE_ALPHABET.length)];
  }
  return `SJ-${value}`;
}

function decimalNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function serializeMediaLink(link) {
  return {
    id: link.media_asset.id,
    purpose: link.media_asset.purpose,
    file_name: link.media_asset.source_file_name_sanitized,
    created_at: link.media_asset.created_at,
    state: link.media_asset.state,
    central_ready: require('./mediaReadiness').isMediaReady(link.media_asset),
    mime_type: link.media_asset.detected_mime,
    size_bytes: Number(link.media_asset.size_bytes),
    width: link.media_asset.width,
    height: link.media_asset.height,
    sort_order: link.sort_order,
    is_cover: link.is_cover,
    alt_text: link.alt_text,
    preview_url: `/api/v1/seputar-jaminan/media/${link.media_asset.id}/content`,
  };
}

function serializeVersion(version) {
  if (!version) return null;
  return {
    id: version.id,
    version_number: version.version_number,
    state: version.state,
    taxonomy_version: version.taxonomy_version,
    subcategory: version.taxonomy_item?.code || null,
    title: version.title,
    description: version.description,
    city_regency: version.city_regency,
    province: version.province,
    availability: version.availability,
    whatsapp_contact: version.whatsapp_contact_version
      ? {
          id: version.whatsapp_contact_version.contact_id,
          version_id: version.whatsapp_contact_version.id,
          label: version.whatsapp_contact_version.label,
          phone_ending: version.whatsapp_contact_version.phone_e164.slice(-4),
        }
      : null,
    profile_version_id: version.profile_version_id,
    attributes: detailAttributes(version),
    media: (version.media || []).map(serializeMediaLink),
    submitted_at: version.submitted_at,
    approved_at: version.approved_at,
    rejection_reason: version.rejection_reason,
    created_at: version.created_at,
  };
}

function serializePublication(publication, settings = {}) {
  const current = publication.current_version || publication.published_version;
  return {
    id: publication.id,
    reference_code: publication.public_reference_code,
    source_type: publication.source_type,
    source_collateral_id: publication.source_collateral_id,
    owner_division: publication.owner_division,
    asset_category: publication.asset_category,
    state: publication.state,
    sync_state: publication.sync_state,
    aggregate_version: publication.aggregate_version,
    lock_version: publication.lock_version,
    next_reconfirmation_at: publication.next_reconfirmation_at,
    last_confirmed_at: publication.last_confirmed_at,
    last_sync_error_code: publication.last_sync_error_code,
    title: current?.title || null,
    city_regency: current?.city_regency || null,
    province: current?.province || null,
    cover: current?.media?.find((item) => item.is_cover)
      ? serializeMediaLink(current.media.find((item) => item.is_cover))
      : null,
    current_version: serializeVersion(publication.current_version),
    published_version: serializeVersion(publication.published_version),
    version_semantics: require('./readContract').versionSemantics,
    public_observation: require('./readContract').publicObservation,
    workflow_eligibility: {
      withdrawal: require('./publicationLifecycle').withdrawalEligibility(publication),
    },
    created_at: publication.created_at,
    updated_at: publication.updated_at,
  };
}

function detailAttributes(version) {
  if (version.land_detail) {
    return {
      land_area_m2: decimalNumber(version.land_detail.land_area_m2),
      ...(version.land_detail.contour ? { contour: version.land_detail.contour } : {}),
      ...(version.land_detail.road_access
        ? { road_access: version.land_detail.road_access }
        : {}),
    };
  }
  if (version.building_detail) {
    return {
      ...(version.building_detail.land_area_m2 !== null
        ? { land_area_m2: decimalNumber(version.building_detail.land_area_m2) }
        : {}),
      building_area_m2: decimalNumber(version.building_detail.building_area_m2),
      ...(version.building_detail.floor_count !== null && version.building_detail.floor_count !== undefined
        ? { floor_count: version.building_detail.floor_count }
        : {}),
      ...(version.building_detail.public_usage
        ? { public_usage: version.building_detail.public_usage }
        : {}),
    };
  }
  if (version.machine_detail) {
    return Object.fromEntries(
      Object.entries({
        brand_or_manufacturer: version.machine_detail.brand_or_manufacturer,
        model_or_type: version.machine_detail.model_or_type,
        manufacture_year: version.machine_detail.manufacture_year,
        public_capacity: version.machine_detail.public_capacity,
        public_condition: version.machine_detail.public_condition,
      }).filter(([, value]) => value !== null && value !== undefined),
    );
  }
  if (version.vehicle_detail) {
    return Object.fromEntries(
      Object.entries({
        brand: version.vehicle_detail.brand,
        model_or_type: version.vehicle_detail.model_or_type,
        manufacture_year: version.vehicle_detail.manufacture_year,
        transmission: version.vehicle_detail.transmission,
        fuel_type: version.vehicle_detail.fuel_type,
        mileage_km: decimalNumber(version.vehicle_detail.mileage_km),
        public_condition: version.vehicle_detail.public_condition,
      }).filter(([, value]) => value !== null && value !== undefined),
    );
  }
  return {};
}

async function requireSettings(client = prisma, flag = null) {
  const settings = await client.sj_integration_settings.findFirst();
  if (!settings) {
    throw new AppError(
      "Koneksi Seputar Jaminan belum disiapkan. Hubungi administrator BPRS.",
      409,
    );
  }
  if (flag && !settings[flag]) {
    throw new AppError(
      "Fitur ini belum diaktifkan oleh administrator BPRS.",
      409,
    );
  }
  return settings;
}

async function assertExpectedVersion(client, publicationId, expectedVersion) {
  await require('./workflowLock').lockPublication(client, publicationId);
  const publication = await client.sj_publications.findUnique({
    where: { id: publicationId },
  });
  if (!publication) throw new AppError("Publikasi tidak ditemukan.", 404);
  if (publication.lock_version !== expectedVersion) {
    throw new AppError(
      "Data sudah berubah. Muat ulang halaman sebelum melanjutkan.",
      409,
    );
  }
  return publication;
}

async function createOutbox(
  client,
  settings,
  { eventType, aggregateType, aggregateId, aggregateVersion, payload, priority = 100 },
) {
  const contracts = await getContracts();
  const checksum = contracts.payloadChecksum(payload);
  const event = {
    event_id: crypto.randomUUID(),
    schema_version: 1,
    event_type: eventType,
    institution_id: settings.institution_id,
    aggregate_id: aggregateId,
    aggregate_version: aggregateVersion,
    occurred_at: new Date().toISOString(),
    payload_checksum: checksum,
    payload,
  };
  const validation = contracts.validateIntegrationEvent(event);
  if (!validation.valid) {
    throw new AppError(
      "Data publik belum memenuhi kontrak Seputar Jaminan. Periksa kembali isian.",
      422,
    );
  }
  return client.sj_sync_outbox.create({
    data: {
      event_id: event.event_id,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      aggregate_version: aggregateVersion,
      event_type: eventType,
      schema_version: 1,
      payload_json: payload,
      payload_checksum: checksum,
      target_binding_json: require('./outboxTarget').captureTarget(eventType, settings),
      priority,
      state: "QUEUED",
    },
  });
}

function assertCategoryAttributes(category, attributes) {
  const rules = {
    LAND: {
      allowed: ["land_area_m2", "contour", "road_access"],
      required: ["land_area_m2"],
    },
    BUILDING: {
      allowed: ["land_area_m2", "building_area_m2", "floor_count", "public_usage"],
      required: ["building_area_m2"],
    },
    MACHINE_EQUIPMENT: {
      allowed: ["brand_or_manufacturer", "model_or_type", "manufacture_year", "public_capacity", "public_condition"],
      required: ["model_or_type", "public_condition"],
    },
    VEHICLE: {
      allowed: ["brand", "model_or_type", "manufacture_year", "transmission", "fuel_type", "mileage_km", "public_condition"],
      required: ["brand", "model_or_type", "public_condition"],
    },
  };
  const rule = rules[category];
  const keys = Object.keys(attributes || {}).filter(
    (key) => attributes[key] !== null && attributes[key] !== undefined,
  );
  if (
    !rule ||
    keys.some((key) => !rule.allowed.includes(key)) ||
    rule.required.some((key) => attributes?.[key] === undefined || attributes?.[key] === null || attributes?.[key] === "")
  ) {
    throw new AppError("Detail aset belum sesuai dengan kategori yang dipilih.", 422);
  }
}

function categoryDetailData(category, attributes) {
  assertCategoryAttributes(category, attributes);
  if (category === "LAND") {
    return {
      delegate: "sj_land_details",
      data: {
        land_area_m2: attributes.land_area_m2,
        contour: attributes.contour || null,
        road_access: attributes.road_access || null,
      },
    };
  }
  if (category === "BUILDING") {
    return {
      delegate: "sj_building_details",
      data: {
        land_area_m2: attributes.land_area_m2 ?? null,
        building_area_m2: attributes.building_area_m2,
        floor_count: attributes.floor_count ?? null,
        public_usage: attributes.public_usage || null,
      },
    };
  }
  if (category === "MACHINE_EQUIPMENT") {
    return {
      delegate: "sj_machine_details",
      data: {
        brand_or_manufacturer: attributes.brand_or_manufacturer || null,
        model_or_type: attributes.model_or_type,
        manufacture_year: attributes.manufacture_year ?? null,
        public_capacity: attributes.public_capacity || null,
        public_condition: attributes.public_condition,
      },
    };
  }
  return {
    delegate: "sj_vehicle_details",
    data: {
      brand: attributes.brand,
      model_or_type: attributes.model_or_type,
      manufacture_year: attributes.manufacture_year ?? null,
      transmission: attributes.transmission || null,
      fuel_type: attributes.fuel_type || null,
      mileage_km: attributes.mileage_km ?? null,
      public_condition: attributes.public_condition,
    },
  };
}

async function replaceDraftDetail(client, versionId, category, attributes) {
  for (const delegate of [
    "sj_land_details",
    "sj_building_details",
    "sj_machine_details",
    "sj_vehicle_details",
  ]) {
    await client[delegate].deleteMany({
      where: { publication_version_id: versionId },
    });
  }
  const detail = categoryDetailData(category, attributes);
  await client[detail.delegate].create({
    data: { publication_version_id: versionId, ...detail.data },
  });
}

async function replaceDraftMedia(client, versionId, ownerDivisionId, media) {
  const mediaIds = media.map((item) => item.media_asset_id);
  const eligibleMedia = await client.sj_media_assets.findMany({
    where: {
      id: { in: mediaIds },
      owner_division_id: ownerDivisionId,
      state: { in: ["UPLOAD_PENDING", "UPLOADED", "PROCESSING", "READY"] },
      purpose: "PUBLICATION_IMAGE",
    },
    select: { id: true },
  });
  if (eligibleMedia.length !== new Set(mediaIds).size) {
    throw new AppError(
      "Ada gambar yang tidak tersedia atau bukan milik divisi publikasi.",
      422,
    );
  }
  if (media.filter((item) => item.is_cover).length !== 1) {
    throw new AppError("Pilih tepat satu gambar utama.", 422);
  }
  await client.sj_publication_version_media.deleteMany({
    where: { publication_version_id: versionId },
  });
  await client.sj_publication_version_media.createMany({
    data: media.map((item) => ({
      publication_version_id: versionId,
      media_asset_id: item.media_asset_id,
      sort_order: item.sort_order,
      is_cover: item.is_cover,
      alt_text: item.alt_text,
    })),
  });
}

async function assertDraftDependencies(client, payload, ownerDivisionId) {
  const [taxonomy, contactVersion, profileVersion] = await Promise.all([
    client.sj_taxonomy_items.findFirst({
      where: {
        id: payload.taxonomy_item_id,
        category: payload.asset_category,
        is_active: true,
      },
    }),
    client.sj_whatsapp_contact_versions.findFirst({
      where: {
        id: payload.whatsapp_contact_version_id,
        state: "VERIFIED",
        contact: { state: "VERIFIED", revoked_at: null },
      },
    }),
    client.sj_public_profile_versions.findFirst({
      where: {
        id: payload.profile_version_id,
        state: "APPROVED",
        profile: { state: "VERIFIED" },
      },
    }),
  ]);
  if (!taxonomy) throw new AppError("Kategori publik belum tersedia.", 422);
  if (!contactVersion) {
    throw new AppError("Pilih kontak WhatsApp yang sudah diverifikasi.", 422);
  }
  if (!profileVersion) {
    throw new AppError("Profil BPRS harus diverifikasi terlebih dahulu.", 422);
  }
  if (!ownerDivisionId) {
    throw new AppError("Divisi pemilik publikasi belum tersedia.", 422);
  }
  return taxonomy;
}

async function assertSource(client, payload) {
  if (payload.source_type === "COLLATERAL") {
    const collateral = await client.debtor_collaterals.findFirst({
      where: { id: payload.source_collateral_id, deleted_at: null },
      select: { id: true },
    });
    if (!collateral) {
      throw new AppError(
        "Agunan tidak ditemukan atau Anda tidak memiliki izin membacanya.",
        404,
      );
    }
    return;
  }
  const evidence = await client.digital_documents.findFirst({
    where: { id: payload.manual_evidence_document_id, deleted_at: null },
    select: { id: true },
  });
  if (!evidence) {
    throw new AppError(
      "Dokumen bukti input manual tidak ditemukan atau tidak dapat diakses.",
      404,
    );
  }
}

async function createPublicationRecord(payload, user, transaction = withDatabaseTransaction) {
  return transaction(async (client) => {
    await require('./workflowLock').lockContactReferences(client);
    await requireSettings(client, "draft_enabled");
    const ownerDivisionId = payload.owner_division_id || user.division_id;
    await assertSource(client, payload);
    await assertDraftDependencies(client, payload, ownerDivisionId);

    let publication;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await client.$executeRawUnsafe('SAVEPOINT sj_publication_create');
      try {
        publication = await client.sj_publications.create({
          data: {
            public_reference_code: newPublicReferenceCode(),
            source_type: payload.source_type,
            source_collateral_id: payload.source_collateral_id || null,
            manual_reason: payload.manual_reason || null,
            manual_evidence_document_id:
              payload.manual_evidence_document_id || null,
            owner_division_id: ownerDivisionId,
            asset_category: payload.asset_category,
            created_by: user.id,
            updated_by: user.id,
          },
        });
        await client.$executeRawUnsafe('RELEASE SAVEPOINT sj_publication_create');
        break;
      } catch (error) {
        await client.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sj_publication_create');
        await client.$executeRawUnsafe('RELEASE SAVEPOINT sj_publication_create');
        if (error.code !== 'P2002') throw error;
        const target = JSON.stringify(error.meta?.target || '');
        if (payload.source_collateral_id && await client.sj_publications.findFirst({where:{source_collateral_id:payload.source_collateral_id,archived_at:null},select:{id:true}})) {
          throw new AppError('Agunan ini sudah memiliki publikasi aktif. Buka publikasi yang sudah ada.', 409);
        }
        if (target && target !== '""' && !target.includes('public_reference_code')) throw error;
        if (attempt === 4) throw new AppError('Kode publikasi belum berhasil dibuat. Silakan coba lagi.', 409);
      }
    }

    const contracts = await getContracts();
    const draftPayload = {
      title: payload.title,
      description: payload.description,
      location: {
        city_regency: payload.city_regency,
        province: payload.province,
      },
      attributes: payload.attributes,
    };
    const version = await client.sj_publication_versions.create({
      data: {
        publication_id: publication.id,
        version_number: 1,
        taxonomy_version: 1,
        taxonomy_item_id: payload.taxonomy_item_id,
        title: payload.title,
        description: payload.description,
        city_regency: payload.city_regency,
        province: payload.province,
        whatsapp_contact_version_id: payload.whatsapp_contact_version_id,
        profile_version_id: payload.profile_version_id,
        public_payload_json: draftPayload,
        payload_checksum: contracts.payloadChecksum(draftPayload),
        last_edited_by: user.id,
      },
    });
    await replaceDraftDetail(
      client,
      version.id,
      payload.asset_category,
      payload.attributes,
    );
    await replaceDraftMedia(client, version.id, ownerDivisionId, payload.media);
    await client.sj_publications.update({
      where: { id: publication.id },
      data: { current_version_id: version.id, lock_version: { increment: 1 } },
    });
    return client.sj_publications.findUnique({
      where: { id: publication.id },
      include: publicationInclude,
    });
  });
}

async function cloneVersionToDraft(client, publication, userId) {
  const source = await client.sj_publication_versions.findUnique({
    where: { id: publication.current_version_id },
    include: versionInclude,
  });
  if (!source) throw new AppError("Versi publikasi tidak ditemukan.", 409);
  const created = await client.sj_publication_versions.create({
    data: {
      publication_id: publication.id,
      version_number: source.version_number + 1,
      taxonomy_version: source.taxonomy_version,
      taxonomy_item_id: source.taxonomy_item_id,
      title: source.title,
      description: source.description,
      city_regency: source.city_regency,
      province: source.province,
      whatsapp_contact_version_id: source.whatsapp_contact_version_id,
      profile_version_id: source.profile_version_id,
      public_payload_json: source.public_payload_json,
      payload_checksum: source.payload_checksum,
      last_edited_by: userId,
    },
  });
  const attributes = detailAttributes(source);
  await replaceDraftDetail(client, created.id, publication.asset_category, attributes);
  await replaceDraftMedia(
    client,
    created.id,
    publication.owner_division_id,
    source.media.map((link) => ({
      media_asset_id: link.media_asset_id,
      sort_order: link.sort_order,
      is_cover: link.is_cover,
      alt_text: link.alt_text,
    })),
  );
  await client.sj_publications.update({
    where: { id: publication.id },
    data: {
      current_version_id: created.id,
      state: "DRAFT",
      updated_by: userId,
    },
  });
  return client.sj_publication_versions.findUnique({
    where: { id: created.id },
    include: versionInclude,
  });
}

async function updatePublicationDraft(id, payload, user, transaction = withDatabaseTransaction) {
  return transaction(async (client) => {
    await requireSettings(client, "draft_enabled");
    let publication = await assertExpectedVersion(
      client,
      id,
      payload.expected_version,
    );
    let version = await client.sj_publication_versions.findUnique({
      where: { id: publication.current_version_id },
      include: versionInclude,
    });
    if (!version) throw new AppError("Versi publikasi tidak ditemukan.", 409);
    if (version.state === "IN_REVIEW") {
      throw new AppError(
        "Publikasi sedang diperiksa. Tunggu keputusan sebelum membuat perubahan baru.",
        409,
      );
    }
    if (version.state !== "DRAFT") {
      version = await cloneVersionToDraft(client, publication, user.id);
      publication = await client.sj_publications.findUnique({ where: { id } });
    }
    const category = payload.asset_category || publication.asset_category;
    const merged = {
      asset_category: category,
      taxonomy_item_id: payload.taxonomy_item_id || version.taxonomy_item_id,
      whatsapp_contact_version_id:
        payload.whatsapp_contact_version_id || version.whatsapp_contact_version_id,
      profile_version_id: payload.profile_version_id || version.profile_version_id,
    };
    await assertDraftDependencies(client, merged, publication.owner_division_id);

    const attributes = payload.attributes || detailAttributes(version);
    const media =
      payload.media ||
      version.media.map((link) => ({
        media_asset_id: link.media_asset_id,
        sort_order: link.sort_order,
        is_cover: link.is_cover,
        alt_text: link.alt_text,
      }));
    const draftPayload = {
      title: payload.title || version.title,
      description: payload.description || version.description,
      location: {
        city_regency: payload.city_regency || version.city_regency,
        province: payload.province || version.province,
      },
      attributes,
    };
    const contracts = await getContracts();
    await client.sj_publication_versions.update({
      where: { id: version.id },
      data: {
        taxonomy_item_id: merged.taxonomy_item_id,
        title: draftPayload.title,
        description: draftPayload.description,
        city_regency: draftPayload.location.city_regency,
        province: draftPayload.location.province,
        whatsapp_contact_version_id: merged.whatsapp_contact_version_id,
        profile_version_id: merged.profile_version_id,
        public_payload_json: draftPayload,
        payload_checksum: contracts.payloadChecksum(draftPayload),
        last_edited_by: user.id,
      },
    });
    await replaceDraftDetail(client, version.id, category, attributes);
    await replaceDraftMedia(client, version.id, publication.owner_division_id, media);
    await client.sj_publications.update({
      where: { id },
      data: {
        asset_category: category,
        state: "DRAFT",
        lock_version: { increment: 1 },
        updated_by: user.id,
      },
    });
    return client.sj_publications.findUnique({
      where: { id },
      include: publicationInclude,
    });
  });
}

async function buildPublicationPayload(client, publication, version, timestamps) {
  const settings = await requireSettings(client);
  const complete = await client.sj_publication_versions.findUnique({
    where: { id: version.id },
    include: versionInclude,
  });
  const category = CATEGORY_TO_PUBLIC[publication.asset_category];
  const payload = {
    publication_id: publication.id,
    reference_code: publication.public_reference_code,
    institution_id: settings.institution_id,
    taxonomy_version: complete.taxonomy_version,
    category,
    subcategory: complete.taxonomy_item.code,
    title: complete.title,
    description: complete.description,
    location: {
      city_regency: complete.city_regency,
      province: complete.province,
    },
    availability: "AVAILABLE",
    attributes: detailAttributes(complete),
    media: complete.media.map((link) => ({
      media_id: link.media_asset.central_media_id,
      checksum: link.media_asset.sha256,
      position: link.sort_order + 1,
      is_cover: link.is_cover,
      alt_text: link.alt_text,
    })),
    whatsapp_contact_id: complete.whatsapp_contact_version.contact_id,
    published_at: timestamps.publishedAt.toISOString(),
    public_updated_at: timestamps.publicUpdatedAt.toISOString(),
    availability_confirmed_at: timestamps.confirmedAt.toISOString(),
    next_confirmation_at: timestamps.nextAt.toISOString(),
  };
  return { payload, settings, complete };
}

async function submitPublication(id, expectedVersion, user, transaction = withDatabaseTransaction) {
  return transaction(async (client) => {
    const settings = await requireSettings(client, "review_enabled");
    const publication = await assertExpectedVersion(client, id, expectedVersion);
    const version = await client.sj_publication_versions.findUnique({
      where: { id: publication.current_version_id },
      include: versionInclude,
    });
    if (!version || version.state !== "DRAFT") {
      throw new AppError("Hanya draf yang dapat diajukan untuk diperiksa.", 409);
    }
    assertCurrentSubmissionDependencies(version);
    if (
      version.media.some(
        (link) =>
          link.media_asset.state !== "READY" ||
          !link.media_asset.central_media_id,
      ) ||
      version.whatsapp_contact_version.contact.sync_state !== "ACKNOWLEDGED" ||
      version.profile_version.profile.sync_state !== "ACKNOWLEDGED"
    ) {
      const error = new AppError(
        "Profil, kontak, dan seluruh gambar harus selesai disinkronkan sebelum katalog diajukan.",
        409,
      );
      error.code = 'SJ_SUBMISSION_DEPENDENCIES_NOT_READY';
      throw error;
    }
    const now = new Date();
    await client.sj_publication_versions.update({
      where: { id: version.id },
      data: { state: "IN_REVIEW", submitted_by: user.id, submitted_at: now },
    });
    await client.sj_publication_reviews.create({
      data: {
        publication_id: id,
        publication_version_id: version.id,
        action: "SUBMITTED",
        reviewer_id: user.id,
      },
    });
    const submitted = await client.sj_publications.update({
      where: { id },
      data: {
        state: "IN_REVIEW",
        lock_version: { increment: 1 },
        updated_by: user.id,
      },
      include: publicationInclude,
    });
    await queueReviewSnapshot(client, settings, "publication", id);
    return submitted;
  });
}

function assertReviewAuthority(settings, central) {
  const authority = settings.review_authority || "local";
  if ((central && authority !== "central") || (!central && authority !== "local")) {
    throw new AppError(central ? "Pemeriksaan pusat belum diaktifkan." : "Keputusan pemeriksaan hanya dapat dilakukan melalui Ruwang Control.", 409);
  }
}

function reviewActorData(actor) {
  return actor.type === "control"
    ? { reviewer_id: null, reviewer_subject: actor.subject }
    : { reviewer_id: actor.id, reviewer_subject: null };
}

async function requestRevisionInTransaction(client, id, payload, actor) {
    const settings = await requireSettings(client, "review_enabled");
    assertReviewAuthority(settings, actor.type === "control");
    const publication = await assertExpectedVersion(
      client,
      id,
      payload.expected_version,
    );
    const version = await client.sj_publication_versions.findUnique({
      where: { id: publication.current_version_id },
    });
    if (!version || version.state !== "IN_REVIEW") {
      throw new AppError("Publikasi ini tidak sedang menunggu pemeriksaan.", 409);
    }
    if (actor.type === "bank" && (version.last_edited_by === actor.id || version.submitted_by === actor.id)) {
      throw new AppError("Pemeriksa harus berbeda dari pembuat/pengaju.", 409);
    }
    await client.sj_publication_versions.update({
      where: { id: version.id },
      data: { state: "REVISION_REQUIRED", rejection_reason: payload.reason },
    });
    await client.sj_publication_reviews.create({
      data: {
        publication_id: id,
        publication_version_id: version.id,
        action: "REVISION_REQUESTED",
        ...reviewActorData(actor),
        reason: payload.reason,
      },
    });
    return client.sj_publications.update({
      where: { id },
      data: {
        state: "REVISION_REQUIRED",
        lock_version: { increment: 1 },
        ...(actor.type === "bank" ? { updated_by: actor.id } : {}),
      },
      include: publicationInclude,
    });
}

async function requestRevision(id, payload, user) {
  return withDatabaseTransaction((client) => requestRevisionInTransaction(client, id, payload, { type: "bank", id: user.id }));
}

async function approveAndPublishInTransaction(client, id, expectedVersion, actor) {
    const settings = await requireSettings(client, "publish_enabled");
    assertReviewAuthority(settings, actor.type === "control");
    if (!settings.sync_enabled || settings.connection_state !== "ACTIVE") {
      throw new AppError("Koneksi pusat belum aktif. Publikasi belum dapat diterbitkan.", 409);
    }
    const publication = await assertExpectedVersion(client, id, expectedVersion);
    const version = await client.sj_publication_versions.findUnique({
      where: { id: publication.current_version_id },
      include: versionInclude,
    });
    if (!version || version.state !== "IN_REVIEW") {
      throw new AppError("Publikasi ini tidak sedang menunggu pemeriksaan.", 409);
    }
    if (actor.type === "bank" && (version.last_edited_by === actor.id || version.submitted_by === actor.id)) {
      throw new AppError("Pemeriksa harus berbeda dari pembuat/pengaju.", 409);
    }
    if (
      version.whatsapp_contact_version.contact.sync_state !== "ACKNOWLEDGED" ||
      version.profile_version.profile.sync_state !== "ACKNOWLEDGED" ||
      version.media.some(
        (link) => link.media_asset.state !== "READY" || !link.media_asset.central_media_id,
      )
    ) {
      throw new AppError(
        "Profil, kontak, atau gambar belum selesai disinkronkan. Tunggu hingga semuanya siap.",
        409,
      );
    }

    const now = new Date();
    const nextAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const { payload } = await buildPublicationPayload(client, publication, version, {
      publishedAt: now,
      publicUpdatedAt: now,
      confirmedAt: now,
      nextAt,
    });
    const contracts = await getContracts();
    await client.sj_publication_versions.update({
      where: { id: version.id },
      data: {
        state: "APPROVED",
        approved_by: actor.type === "bank" ? actor.id : null,
        approved_by_subject: actor.type === "control" ? actor.subject : null,
        approved_at: now,
        public_payload_json: payload,
        payload_checksum: contracts.payloadChecksum(payload),
      },
    });
    const aggregateVersion = publication.aggregate_version + 1;
    await client.sj_publications.update({
      where: { id },
      data: {
        published_version_id: version.id,
        state: "APPROVED",
        sync_state: "QUEUED",
        aggregate_version: aggregateVersion,
        lock_version: { increment: 1 },
        last_confirmed_at: now,
        next_reconfirmation_at: nextAt,
        ...(actor.type === "bank" ? { updated_by: actor.id } : {}),
        last_sync_error_code: null,
      },
    });
    await client.sj_publication_reviews.create({
      data: {
        publication_id: id,
        publication_version_id: version.id,
        action: "APPROVED",
        ...reviewActorData(actor),
      },
    });
    await createOutbox(client, settings, {
      eventType: "UPSERT_PUBLICATION_SNAPSHOT",
      aggregateType: "PUBLICATION",
      aggregateId: id,
      aggregateVersion,
      payload,
      priority: 50,
    });
    return client.sj_publications.findUnique({
      where: { id },
      include: publicationInclude,
    });
}

async function approveAndPublish(id, expectedVersion, user) {
  return withDatabaseTransaction((client) => approveAndPublishInTransaction(client, id, expectedVersion, { type: "bank", id: user.id }));
}

async function unpublishInTransaction(client, id, payload, actor) {
    const settings = await requireSettings(client, "sync_enabled");
    assertReviewAuthority(settings, actor.type === "control");
    const publication = await assertExpectedVersion(
      client,
      id,
      payload.expected_version,
    );
    const withdrawal = require('./publicationLifecycle').withdrawalEligibility(publication);
    if (!withdrawal.eligible) {
      throw new AppError(withdrawal.reason, 409);
    }
    const now = new Date();
    const aggregateVersion = publication.aggregate_version + 1;
    const eventPayload = {
      publication_id: id,
      institution_id: settings.institution_id,
      reason_code: payload.reason_code,
      unpublished_at: now.toISOString(),
    };
    await client.sj_publications.update({
      where: { id },
      data: {
        state: "UNPUBLISHED",
        sync_state: "QUEUED",
        aggregate_version: aggregateVersion,
        lock_version: { increment: 1 },
        ...(actor.type === "bank" ? { updated_by: actor.id } : {}),
      },
    });
    await createOutbox(client, settings, {
      eventType: "UNPUBLISH_PUBLICATION",
      aggregateType: "PUBLICATION",
      aggregateId: id,
      aggregateVersion,
      payload: eventPayload,
      priority: 10,
    });
    return client.sj_publications.findUnique({
      where: { id },
      include: publicationInclude,
    });
}

async function unpublish(id, payload, user) {
  return withDatabaseTransaction((client) =>
    unpublishInTransaction(client, id, payload, { type: "bank", id: user.id }));
}

async function reconfirmInTransaction(client, id, expectedVersion, actor) {
    const settings = await requireSettings(client, "sync_enabled");
    assertReviewAuthority(settings, actor.type === "control");
    const publication = await assertExpectedVersion(client, id, expectedVersion);
    if (publication.state !== "PUBLISHED" || !publication.published_version_id) {
      throw new AppError("Hanya publikasi tayang yang dapat dikonfirmasi.", 409);
    }
    const version = await client.sj_publication_versions.findUnique({
      where: { id: publication.published_version_id },
      include: versionInclude,
    });
    const now = new Date();
    const nextAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const { payload } = await buildPublicationPayload(client, publication, version, {
      publishedAt: version.approved_at || publication.created_at,
      publicUpdatedAt: now,
      confirmedAt: now,
      nextAt,
    });
    const aggregateVersion = publication.aggregate_version + 1;
    await client.sj_publications.update({
      where: { id },
      data: {
        aggregate_version: aggregateVersion,
        lock_version: { increment: 1 },
        sync_state: "QUEUED",
        last_confirmed_at: now,
        next_reconfirmation_at: nextAt,
        ...(actor.type === "bank" ? { updated_by: actor.id } : {}),
      },
    });
    await client.sj_publication_reviews.create({
      data: {
        publication_id: id,
        publication_version_id: version.id,
        action: "RECONFIRMED",
        ...reviewActorData(actor),
      },
    });
    await createOutbox(client, settings, {
      eventType: "UPSERT_PUBLICATION_SNAPSHOT",
      aggregateType: "PUBLICATION",
      aggregateId: id,
      aggregateVersion,
      payload,
      priority: 40,
    });
    return client.sj_publications.findUnique({
      where: { id },
      include: publicationInclude,
    });
}

async function reconfirm(id, expectedVersion, user) {
  return withDatabaseTransaction((client) =>
    reconfirmInTransaction(client, id, expectedVersion, { type: "bank", id: user.id }));
}

async function archiveInTransaction(client, id, expectedVersion, actor) {
    const settings = await requireSettings(client);
    assertReviewAuthority(settings, actor.type === "control");
    const publication = await assertExpectedVersion(client, id, expectedVersion);
    if (publication.state === "PUBLISHED" && actor.type !== "control") {
      throw new AppError("Turunkan publikasi sebelum mengarsipkannya.", 409);
    }
    if (publication.state === "ARCHIVED") return publication;
    const now = new Date();
    const shouldSync = publication.aggregate_version > 0;
    const aggregateVersion = publication.aggregate_version + (shouldSync ? 1 : 0);
    await client.sj_publications.update({
      where: { id },
      data: {
        state: "ARCHIVED",
        archived_at: now,
        aggregate_version: aggregateVersion,
        lock_version: { increment: 1 },
        sync_state: shouldSync ? "QUEUED" : publication.sync_state,
        ...(actor.type === "bank" ? { updated_by: actor.id } : {}),
      },
    });
    if (shouldSync) {
      await createOutbox(client, settings, {
        eventType: "ARCHIVE_PUBLICATION",
        aggregateType: "PUBLICATION",
        aggregateId: id,
        aggregateVersion,
        payload: {
          publication_id: id,
          institution_id: settings.institution_id,
          archived_at: now.toISOString(),
        },
        priority: 10,
      });
    }
    return client.sj_publications.findUnique({
      where: { id },
      include: publicationInclude,
    });
}

async function archive(id, expectedVersion, user) {
  return withDatabaseTransaction((client) =>
    archiveInTransaction(client, id, expectedVersion, { type: "bank", id: user.id }));
}

function safeSettings(settings) {
  if (!settings) return null;
  return {
    institution_id: settings.institution_id,
    installation_id: settings.installation_id,
    key_id: settings.key_id,
    central_base_url: settings.central_base_url,
    contract_version: settings.contract_version,
    taxonomy_version: settings.taxonomy_version,
    connection_state: settings.connection_state,
    module_visible: settings.module_visible,
    draft_enabled: settings.draft_enabled,
    review_enabled: settings.review_enabled,
    review_authority: settings.review_authority || "local",
    review_submission_ready:
      (settings.review_authority || "local") === "local" ||
      (String(process.env.SJ_CONTROL_SNAPSHOT_ENABLED || "false").toLowerCase() === "true" &&
        String(process.env.SJ_CONTROL_INSTANCE_ID || "").trim() === settings.installation_id),
    sync_enabled: settings.sync_enabled,
    publish_enabled: settings.publish_enabled,
    filesystem_upload_enabled: settings.filesystem_upload_enabled,
    s3_upload_enabled: settings.s3_upload_enabled,
    last_success_at: settings.last_success_at,
    last_error_at: settings.last_error_at,
    last_error_code: settings.last_error_code,
  };
}

exports.getSettings = async () => {
  const settings=safeSettings(await prisma.sj_integration_settings.findFirst());
  if(!settings)return null;
  return {...settings,entry_actions:await require('./actionRead').readEntryActions(prisma)};
};

exports.listTaxonomy = async () => {
  const contracts = await getContracts();
  const version = await prisma.sj_taxonomy_versions.findFirst({
    where: { is_active: true },
    orderBy: { version: "desc" },
  });
  if (!version) {
    return {
      version: null,
      categories: [],
      vocabularies: contracts.PUBLIC_ATTRIBUTE_VOCABULARIES,
    };
  }
  const items = await prisma.sj_taxonomy_items.findMany({
    where: { taxonomy_version: version.version, is_active: true },
    orderBy: [{ category: "asc" }, { label_id: "asc" }],
  });
  return {
    version: version.version,
    categories: Object.entries(
      items.reduce((grouped, item) => {
        (grouped[item.category] ||= []).push({
          id: item.id,
          code: item.code,
          label: item.label_id,
          required_fields: item.required_field_schema?.required || [],
        });
        return grouped;
      }, {}),
    ).map(([code, categoryItems]) => ({ code, items: categoryItems })),
    vocabularies: contracts.PUBLIC_ATTRIBUTE_VOCABULARIES,
  };
};

exports.updateSettings = async (payload) => {
  const authority=String(process.env.SJ_CONTROL_REVIEW_AUTHORITY || 'local').trim().toLowerCase();
  if(!['local','central'].includes(authority))throw new AppError('Konfigurasi pemeriksaan belum sesuai.',503);
  if (
    process.env.NODE_ENV === "production" &&
    payload.central_base_url &&
    !payload.central_base_url.startsWith("https://")
  ) {
    throw new AppError("Alamat pusat wajib memakai HTTPS.", 422);
  }
  const existing = await prisma.sj_integration_settings.findFirst();
  if (!existing) {
    const required = [
      "institution_id",
      "installation_id",
      "key_id",
      "central_base_url",
    ];
    if (required.some((key) => !payload[key])) {
      throw new AppError(
        "Identitas BPRS, instalasi, kunci, dan alamat pusat wajib diisi saat koneksi pertama dibuat.",
        422,
      );
    }
  } else {
    for (const field of ["institution_id", "installation_id", "key_id"]) {
      if (payload[field] && payload[field] !== existing[field]) {
        throw new AppError(
          "Identitas koneksi tidak dapat diubah dari halaman ini. Gunakan proses rotasi koneksi yang diaudit.",
          409,
        );
      }
    }
  }
  const next = existing
    ? await prisma.sj_integration_settings.update({
        where: { id: existing.id },
        data: payload,
      })
    : await prisma.sj_integration_settings.create({ data: {...payload, review_authority:authority} });
  return safeSettings(next);
};

exports.getDashboard = async () => {
  const [settings, stateRows, dueSoon, syncRows] = await Promise.all([
    prisma.sj_integration_settings.findFirst(),
    prisma.sj_publications.groupBy({ by: ["state"], _count: { _all: true } }),
    prisma.sj_publications.count({
      where: {
        state: "PUBLISHED",
        next_reconfirmation_at: {
          lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      },
    }),
    prisma.sj_sync_outbox.groupBy({ by: ["state"], _count: { _all: true } }),
  ]);
  return {
    connection: safeSettings(settings),
    count_scope: 'ACCESSIBLE_BANK_RECORDS',
    synchronization_scope: 'SJ_AND_CONTROL_OUTBOX',
    public_observation: require('./readContract').publicObservation,
    publications: Object.fromEntries(
      stateRows.map((row) => [row.state, row._count._all]),
    ),
    need_confirmation_soon: dueSoon,
    synchronization: Object.fromEntries(
      syncRows.map((row) => [row.state, row._count._all]),
    ),
  };
};

exports.getSyncSummary = async () => {
  const rows = await prisma.sj_sync_outbox.groupBy({
    by: ["state"],
    _count: { _all: true },
    _min: { created_at: true },
  });
  return rows.map((row) => ({
    status: row.state,
    total: row._count._all,
    oldest_at: row._min.created_at,
  }));
};

exports.listPublications = async (query) => {
  const where = {
    ...(query.confirmation === 'soon' ? {AND:[{state:'PUBLISHED'},{next_reconfirmation_at:{lte:new Date(Date.now()+7*24*60*60*1000)}}]} : {}),
    ...(query.state ? { state: query.state } : {}),
    ...(query.category ? { asset_category: query.category } : {}),
    ...(query.search
      ? {
          OR: [
            { public_reference_code: { contains: query.search, mode: "insensitive" } },
            {
              current_version: {
                is: { title: { contains: query.search, mode: "insensitive" } },
              },
            },
          ],
        }
      : {}),
  };
  const skip = (query.page - 1) * query.limit;
  const cursor=require('./readCursor');
  const cursorFilter={state:query.state||null,category:query.category||null,search:query.search||null,...(query.confirmation?{confirmation:query.confirmation}:{})};
  const position=query.paged?cursor.decodeBy(query.cursor,cursorFilter,'created_at'):null;
  const [rows, total, settings] = await Promise.all([
    prisma.sj_publications.findMany({
      where: position ? { AND: [where, position] } : where,
      include: publicationInclude,
      orderBy: [{ [query.paged ? 'created_at' : 'updated_at']: "desc" }, { id: "desc" }],
      ...(query.paged?{take:query.limit+1}:{skip,take:query.limit}),
    }),
    query.paged ? null : prisma.sj_publications.count({ where }),
    prisma.sj_integration_settings.findFirst(),
  ]);
  const actions=require('./actionRead'),context=await actions.context(prisma,rows,'publication');
  const summaries=await require('./publicObservation.service').publicationSummaries(rows,settings);
  const serialize=row=>({...serializePublication(row,settings||{}),action_availability:actions.publication(row,context),observation_summary:summaries.get(row.id)??null});
  if(query.paged)return cursor.pageBy(rows,query.limit,cursorFilter,serialize,'created_at');
  return {items: rows.map(serialize),pagination: require('./readContract').pagination(query.page,query.limit,total)};
};

exports.getPublication = async (id, query={}) => {
  const [publication, settings] = await Promise.all([prisma.sj_publications.findUnique({
    where: { id },
    include: {
      ...publicationInclude,
      reviews: query.history==='paged'?false:{
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        select: {
          id: true,
          action: true,
          reason: true,
          reviewer_id: true,
          created_at: true,
        },
      },
    },
  }), prisma.sj_integration_settings.findFirst()]);
  if (!publication) throw new AppError("Publikasi tidak ditemukan.", 404);
  const actions=require('./actionRead'),context=await actions.context(prisma,[publication],'publication');
  const mediaRows=[...new Map([publication.current_version,publication.published_version].flatMap(v=>(v?.media||[]).map(l=>[l.media_asset.id,l.media_asset]))).values()];
  const mediaContext=await actions.context(prisma,mediaRows,'media');
  const dto=serializePublication(publication,settings||{});
  return { ...dto,
    // User-specific controls are not part of immutable approved content.
    media_actions:Object.fromEntries(mediaRows.map(row=>[row.id,actions.media(row,mediaContext)])),
    ...(query.history==='paged'?{review_history:{mode:'PAGED',loaded:false}}:{reviews:publication.reviews}),
    action_availability:actions.publication(publication,context) };
};

exports.createPublication = async (payload, user, transaction) =>
  serializePublication(await createPublicationRecord(payload, user, transaction));
exports.updatePublicationDraft = async (id, payload, user, transaction) =>
  serializePublication(await updatePublicationDraft(id, payload, user, transaction));
exports.submitPublication = async (id, payload, user, transaction) =>
  serializePublication(await submitPublication(id, payload.expected_version, user, transaction));
exports.requestRevision = async (id, payload, user) =>
  serializePublication(await requestRevision(id, payload, user));
exports.approveAndPublish = async (id, payload, user) =>
  serializePublication(await approveAndPublish(id, payload.expected_version, user));
exports.unpublish = async (id, payload, user) =>
  serializePublication(await unpublish(id, payload, user));
exports.reconfirm = async (id, payload, user) =>
  serializePublication(await reconfirm(id, payload.expected_version, user));
exports.archive = async (id, payload, user) =>
  serializePublication(await archive(id, payload.expected_version, user));

exports.listEligibleCollaterals = async ({ page = 1, limit = 20, search = "" }) => {
  const where = {
    deleted_at: null,
    sj_publications: { none: { archived_at: null } },
    ...(search
      ? {
          OR: [
            { collateral_number: { contains: search, mode: "insensitive" } },
            { collateral_type: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.debtor_collaterals.findMany({
      where,
      select: {
        id: true,
        collateral_number: true,
        collateral_type: true,
        location_city_code: true,
        description: true,
        period_month: true,
      },
      orderBy: [{ updated_at: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.debtor_collaterals.count({ where }),
  ]);
  return { items: rows, pagination: require('./readContract').pagination(page,limit,total) };
};

exports.listReviews = async (query={}) => {
  const cursor=require('./readCursor'),filter=['reviews'];
  const rows = await prisma.sj_publications.findMany({
    where: { state: "IN_REVIEW",...(query.paged?cursor.decode(query.cursor,filter):{}) },
    include: publicationInclude,
    orderBy: query.paged?[{created_at:'desc'},{id:'desc'}]:[{ updated_at: "asc" }, { id: "asc" }],
    ...(query.paged?{take:query.limit+1}:{}),
  });
  const evidenceIds = rows
    .filter((row) => row.source_type === "MANUAL" && row.manual_evidence_document_id)
    .map((row) => row.manual_evidence_document_id);
  const collateralIds = rows
    .filter((row) => row.source_type === "COLLATERAL" && row.source_collateral_id)
    .map((row) => row.source_collateral_id);
  const [evidenceDocuments, collaterals] = await Promise.all([
    evidenceIds.length
      ? prisma.digital_documents.findMany({
          where: { id: { in: evidenceIds }, deleted_at: null },
          select: {
            id: true,
            document_number: true,
            document_name: true,
            description: true,
          },
        })
      : [],
    collateralIds.length
      ? prisma.debtor_collaterals.findMany({
          where: { id: { in: collateralIds }, deleted_at: null },
          select: {
            id: true,
            collateral_number: true,
            collateral_type: true,
            description: true,
            location_city_code: true,
            period_month: true,
          },
        })
      : [],
  ]);
  const evidenceById = new Map(evidenceDocuments.map((row) => [row.id, row]));
  const collateralById = new Map(collaterals.map((row) => [row.id, row]));
  const actionRead = require('./actionRead');
  const actionContext = await actionRead.context(prisma, rows, 'publication');
  const serializeReview=(row) => ({
    ...serializePublication(row),
    action_availability: actionRead.publication(row, actionContext),
    review_source:
      row.source_type === "MANUAL"
        ? {
            type: "MANUAL",
            reason: row.manual_reason,
            evidence_document: evidenceById.get(row.manual_evidence_document_id) || null,
          }
        : {
            type: "COLLATERAL",
            collateral: collateralById.get(row.source_collateral_id) || null,
          },
  });
  return query.paged?cursor.page(rows,query.limit,filter,serializeReview):rows.map(serializeReview);
};

// Deliberately excludes payloads, signatures, nonce and lease internals.
function syncEventSummary(row, context) {
  return {
    id:row.id,event_id:row.event_id,aggregate_type:row.aggregate_type,
    aggregate_id:row.aggregate_id,aggregate_version:row.aggregate_version,event_type:row.event_type,
    state:row.state,attempt_count:row.attempt_count,last_error_code:row.last_error_code,
    available_at:row.available_at,created_at:row.created_at,acknowledged_at:row.acknowledged_at,
    action_availability:require('./actionRead').syncEvent(row,context),
  };
}
exports.listSyncEvents = async (query) => {
  const cursor=require('./readCursor');
  const filter={state:query.state||'NEEDS_ATTENTION',event_id:query.event_id||null};
  const where={state:filter.state==='NEEDS_ATTENTION'?{in:['FAILED','QUARANTINED']}:filter.state,
    ...(filter.event_id?{event_id:filter.event_id}:{})};
  const position=cursor.decodeBy(query.cursor,filter);
  const rows=await prisma.sj_sync_outbox.findMany({where:position?{AND:[where,position]}:where,
    orderBy:[{created_at:'desc'},{id:'desc'}],take:query.limit+1});
  const context=await require('./actionRead').context(prisma,rows,'sync');
  return cursor.pageBy(rows,query.limit,filter,row=>syncEventSummary(row,context));
};
exports.getLatestReconciliation = () => prisma.sj_reconciliation_runs.findFirst({
  orderBy:[{started_at:'desc'},{id:'desc'}],
  select:{id:true,state:true,count_checked:true,count_mismatch:true,started_at:true,finished_at:true},
});

exports.getSyncEvent = async (id) => {
  const row = await prisma.sj_sync_outbox.findUnique({
    where: { id },
    include: {
      attempts: {
        orderBy: { attempt_number: "desc" },
        select: {
          attempt_number: true,
          started_at: true,
          finished_at: true,
          result: true,
          http_status: true,
          error_code: true,
          request_id: true,
        },
      },
    },
  });
  if (!row) throw new AppError("Catatan sinkronisasi tidak ditemukan.", 404);
  const actions=require('./actionRead'),context=await actions.context(prisma,[row],'sync');
  return {
    action_availability:actions.syncEvent(row,context),
    id: row.id,
    event_id: row.event_id,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    aggregate_version: row.aggregate_version,
    event_type: row.event_type,
    state: row.state,
    attempt_count: row.attempt_count,
    last_error_code: row.last_error_code,
    available_at: row.available_at,
    created_at: row.created_at,
    acknowledged_at: row.acknowledged_at,
    attempts: row.attempts,
  };
};

exports.retrySyncEvent = async (id) => {
  await withDatabaseTransaction(async client=>{
  const row = await client.sj_sync_outbox.findUnique({ where: { id } });
  if (!row) throw new AppError("Catatan sinkronisasi tidak ditemukan.", 404);
  if (!["FAILED", "QUARANTINED", "RETRYING"].includes(row.state)) {
    throw new AppError("Sinkronisasi ini belum dapat diulangi.", 409);
  }
  const settings = await client.sj_integration_settings.findFirst();
  const targetBlock = require('./outboxTarget').outboxTargetBlock(row, settings);
  if (targetBlock) throw new AppError(targetBlock.reason, 409);
  const changed=await client.sj_sync_outbox.updateMany({
    where: { id, state:row.state,attempt_count:row.attempt_count,locked_at:row.locked_at,locked_by:row.locked_by },
    data: {
      state: "QUEUED",
      available_at: new Date(),
      last_error_code: null,
      locked_at: null,
      locked_by: null,
    },
  });
  if(changed.count!==1)throw new AppError('Status sinkronisasi sudah berubah. Muat ulang sebelum mencoba lagi.',409);
  // Bank lifecycle already applied; only its delivery is being retried.
  await client.sj_control_change_requests.updateMany({where:{sync_event_id:row.event_id,state:'FAILED'},data:{state:'APPLIED',failure_code:null}});
  });
  return exports.getSyncEvent(id);
};

exports.createReconciliation = async (user) => withDatabaseTransaction(async client => {
  const settings = await requireSettings(client, "sync_enabled");
  // Two tabs or a timed-out response reuse the active run, not a duplicate job.
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ruwang:sj:reconciliation-create'))`;
  const active = await client.sj_reconciliation_runs.findFirst({
    where:{state:{in:['PENDING','RUNNING']}},orderBy:[{started_at:'desc'},{id:'desc'}],
    select:{id:true,state:true,count_checked:true,count_mismatch:true,started_at:true,finished_at:true},
  });
  if(active)return active;
  const contracts = await getContracts();
  const events = await client.sj_sync_outbox.findMany({
    where: { aggregate_version: { gt: 0 }, event_type: { in: Object.keys(PUBLIC_STATE_BY_EVENT) } },
    orderBy: [{ aggregate_id: "asc" }, { aggregate_version: "desc" }],
    select: {
      aggregate_type: true,
      aggregate_id: true,
      aggregate_version: true,
      event_type: true,
      payload_checksum: true,
    },
  });
  const latestByAggregate = new Map();
  for (const event of events) {
    if (!latestByAggregate.has(event.aggregate_id)) {
      latestByAggregate.set(event.aggregate_id, event);
    }
  }
  const items = [...latestByAggregate.values()]
    .map((event) => ({
      aggregate_type: event.aggregate_type,
      aggregate_id: event.aggregate_id,
      aggregate_version: event.aggregate_version,
      expected_public_state: PUBLIC_STATE_BY_EVENT[event.event_type],
      payload_checksum: event.payload_checksum,
    }))
    .sort((left, right) =>
      `${left.aggregate_type}:${left.aggregate_id}`.localeCompare(
        `${right.aggregate_type}:${right.aggregate_id}`,
      ),
    );
  const manifest = {
    institution_id: settings.institution_id,
    generated_at: new Date().toISOString(),
    items,
  };
  const validation = contracts.validateSchema(
    "https://seputarjaminan.com/contracts/v1/reconciliation-manifest.schema.json",
    manifest,
  );
  if (!validation.valid) {
    throw new AppError("Manifest rekonsiliasi lokal tidak valid.", 422);
  }
  const checksum = contracts.payloadChecksum(manifest);
  return client.sj_reconciliation_runs.create({
    data: {
      initiated_by_type: "USER",
      initiated_by: user.id,
      state: "PENDING",
      local_manifest_checksum: checksum,
      safe_report_json: manifest,
    },
    select: {
      id: true,
      state: true,
      count_checked: true,
      count_mismatch: true,
      started_at: true,
    },
  });
});

exports.ROOT_MENU_URL = ROOT_MENU_URL;
exports.createOutbox = createOutbox;
exports.requireSettings = requireSettings;
exports.serializePublication = serializePublication;
exports.PUBLIC_STATE_BY_EVENT = PUBLIC_STATE_BY_EVENT;
exports.applyControlPublicationDecision = async (client, command) => {
  const actor = { type: "control", subject: command.actor_subject };
  const row = command.decision === "approve"
    ? await approveAndPublishInTransaction(client, command.resource.id, command.expected_version, actor)
    : await requestRevisionInTransaction(client, command.resource.id, { expected_version: command.expected_version, reason: command.reason }, actor);
  return serializePublication(row);
};
exports.applyControlPublicationLifecycle = async (client, action, id, expectedVersion, actorSubject) => {
  const actor = { type: "control", subject: actorSubject };
  if (action === "UNPUBLISH_PUBLICATION") {
    return unpublishInTransaction(client, id, { expected_version: expectedVersion, reason_code: "OWNER_REQUEST" }, actor);
  }
  if (action === "RECONFIRM_PUBLICATION") {
    return reconfirmInTransaction(client, id, expectedVersion, actor);
  }
  if (action === "ARCHIVE_PUBLICATION") {
    return archiveInTransaction(client, id, expectedVersion, actor);
  }
  throw new AppError("Tindakan publikasi tidak didukung.", 422);
};
