const crypto = require("node:crypto");

const { AppError } = require("../../utils/errors");
const {
  canonicalJson,
  payloadDigest,
} = require("./controlReview.contract");

const SNAPSHOT_EVENT_TYPE = "CONTROL_REVIEW_SNAPSHOT";
const SNAPSHOT_AGGREGATE_TYPE = "CONTROL_REVIEW";

const publicationInclude = Object.freeze({
  current_version: {
    include: {
      taxonomy_item: true,
      land_detail: true,
      building_detail: true,
      machine_detail: true,
      vehicle_detail: true,
      media: {
        orderBy: { sort_order: "asc" },
        include: { media_asset: true },
      },
      whatsapp_contact_version: { include: { contact: true } },
      profile_version: { include: { profile: true } },
    },
  },
});

function bankSubject(userId) {
  return `ruwang-bank:${userId}`;
}

function uniqueSubjects(values) {
  return [...new Set(values.filter(Boolean).map(bankSubject))].sort();
}

function deterministicSnapshotId(parts) {
  const bytes = crypto.createHash("sha256").update(parts.join(":"), "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function mediaDetail(media, extra = {}) {
  if (
    media?.state !== "READY" ||
    !media.central_media_id ||
    !media.detected_mime ||
    !media.width ||
    !media.height
  ) {
    throw new AppError("Media pemeriksaan belum siap.", 409);
  }
  return {
    source_media_id: media.id,
    central_media_id: media.central_media_id,
    state: "READY",
    detected_mime: media.detected_mime,
    width: media.width,
    height: media.height,
    ...extra,
  };
}

function number(value) {
  return value === null || value === undefined ? null : Number(value);
}

function publicationAttributes(version) {
  if (version.land_detail) {
    return {
      land_area_m2: number(version.land_detail.land_area_m2),
      ...(version.land_detail.contour ? { contour: version.land_detail.contour } : {}),
      ...(version.land_detail.road_access ? { road_access: version.land_detail.road_access } : {}),
    };
  }
  if (version.building_detail) {
    return {
      ...(version.building_detail.land_area_m2 === null
        ? {}
        : { land_area_m2: number(version.building_detail.land_area_m2) }),
      building_area_m2: number(version.building_detail.building_area_m2),
      ...(version.building_detail.floor_count
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
  return Object.fromEntries(
    Object.entries({
      brand: version.vehicle_detail?.brand,
      model_or_type: version.vehicle_detail?.model_or_type,
      manufacture_year: version.vehicle_detail?.manufacture_year,
      transmission: version.vehicle_detail?.transmission,
      fuel_type: version.vehicle_detail?.fuel_type,
      mileage_km: number(version.vehicle_detail?.mileage_km),
      public_condition: version.vehicle_detail?.public_condition,
    }).filter(([, value]) => value !== null && value !== undefined),
  );
}

function assertCentralSnapshotConfig(settings) {
  if ((settings.review_authority || "local") !== "central") return false;
  if (String(process.env.SJ_CONTROL_SNAPSHOT_ENABLED || "false").toLowerCase() !== "true") {
    throw new AppError("Pengiriman antrean pemeriksaan pusat belum diaktifkan.", 503);
  }
  const instanceId = String(process.env.SJ_CONTROL_INSTANCE_ID || "").trim();
  if (!instanceId || instanceId !== settings.installation_id) {
    throw new AppError("Identitas antrean pemeriksaan pusat tidak sesuai.", 503);
  }
  return true;
}

async function buildSnapshot(client, settings, kind, aggregateId) {
  if (kind === "change_request") {
    const request = await client.sj_control_change_requests.findUnique({
      where: { id: aggregateId },
    });
    if (!request || request.state !== "IN_REVIEW") {
      throw new AppError("Snapshot permintaan perubahan tidak tersedia.", 409);
    }
    const impact = request.impact_json || {};
    return {
      contract_version: 1,
      snapshot_id: deterministicSnapshotId([
        "change-request",
        request.id,
        String(request.request_version),
        request.impact_checksum,
      ]),
      instance_id: settings.installation_id,
      resource: { kind, id: request.id },
      source_version: request.request_version,
      payload_checksum: request.impact_checksum,
      state: "IN_REVIEW",
      contributor_subjects: uniqueSubjects([request.submitted_by]),
      submitted_at: request.submitted_at.toISOString(),
      detail: {
        kind,
        action: request.action,
        target_kind: request.resource_kind,
        target_id: request.resource_id,
        target_label: impact.target_label,
        current_state: impact.current_state,
        reason: request.reason,
        expected_public_visibility: impact.expected_public_visibility,
        blockers: Array.isArray(impact.blockers) ? impact.blockers : [],
        affected_publications: Number(impact.affected_publications || 0),
        affected_media: Number(impact.affected_media || 0),
        central_synced: Boolean(impact.central_synced),
        reference_code: impact.reference_code || null,
        public_slug: impact.public_slug || null,
        media: Array.isArray(impact.media) ? impact.media : [],
      },
    };
  }

  if (kind === "profile") {
    const aggregate = await client.sj_public_profiles.findUnique({
      where: { id: aggregateId },
      include: {
        logo_media: true,
        versions: { orderBy: { version_number: "desc" }, take: 1 },
      },
    });
    const version = aggregate?.versions?.[0];
    if (!aggregate || !version || version.state !== "IN_REVIEW" || !version.submitted_at) {
      throw new AppError("Snapshot profil pemeriksaan tidak tersedia.", 409);
    }
    return {
      contract_version: 1,
      snapshot_id: version.id,
      instance_id: settings.installation_id,
      resource: { kind, id: aggregate.id },
      source_version: aggregate.lock_version,
      payload_checksum: version.payload_checksum,
      state: "IN_REVIEW",
      contributor_subjects: uniqueSubjects([version.created_by, aggregate.updated_by]),
      submitted_at: version.submitted_at.toISOString(),
      detail: {
        kind,
        public_name: aggregate.display_name,
        public_slug: aggregate.public_slug,
        short_description: aggregate.short_description,
        city_regency: aggregate.city_regency,
        province: aggregate.province,
        website_url: aggregate.website_url || null,
        logo: mediaDetail(aggregate.logo_media),
      },
    };
  }

  if (kind === "contact") {
    const aggregate = await client.sj_whatsapp_contacts.findUnique({
      where: { id: aggregateId },
      include: { versions: { orderBy: { version_number: "desc" }, take: 1 } },
    });
    const version = aggregate?.versions?.[0];
    if (!aggregate || !version || version.state !== "IN_REVIEW" || !version.submitted_at) {
      throw new AppError("Snapshot kontak pemeriksaan tidak tersedia.", 409);
    }
    return {
      contract_version: 1,
      snapshot_id: version.id,
      instance_id: settings.installation_id,
      resource: { kind, id: aggregate.id },
      source_version: aggregate.lock_version,
      payload_checksum: version.checksum,
      state: "IN_REVIEW",
      contributor_subjects: uniqueSubjects([version.created_by, aggregate.updated_by]),
      submitted_at: version.submitted_at.toISOString(),
      detail: {
        kind,
        label: version.label,
        phone_e164: version.phone_e164,
        message_template_version: version.message_template_version,
      },
    };
  }

  const aggregate = await client.sj_publications.findUnique({
    where: { id: aggregateId },
    include: publicationInclude,
  });
  const version = aggregate?.current_version;
  if (!aggregate || !version || version.state !== "IN_REVIEW" || !version.submitted_at) {
    throw new AppError("Snapshot publikasi pemeriksaan tidak tersedia.", 409);
  }
  return {
    contract_version: 1,
    snapshot_id: version.id,
    instance_id: settings.installation_id,
    resource: { kind, id: aggregate.id },
    source_version: aggregate.lock_version,
    payload_checksum: version.payload_checksum,
    state: "IN_REVIEW",
    contributor_subjects: uniqueSubjects([version.last_edited_by, version.submitted_by]),
    submitted_at: version.submitted_at.toISOString(),
    detail: {
      kind,
      reference_code: aggregate.public_reference_code,
      category: aggregate.asset_category,
      subcategory: version.taxonomy_item.code,
      title: version.title,
      description: version.description,
      city_regency: version.city_regency,
      province: version.province,
      availability: version.availability,
      attributes: publicationAttributes(version),
      media: version.media.map((link) => mediaDetail(link.media_asset, {
        is_cover: link.is_cover,
        position: link.sort_order + 1,
        ...(link.alt_text ? { alt_text: link.alt_text } : {}),
      })),
      contact: {
        label: version.whatsapp_contact_version.label,
        phone_e164: version.whatsapp_contact_version.phone_e164,
      },
      profile: {
        public_name: version.profile_version.profile.display_name,
        public_slug: version.profile_version.profile.public_slug,
      },
    },
  };
}

async function queueReviewSnapshot(client, settings, kind, aggregateId) {
  if (!assertCentralSnapshotConfig(settings)) return null;
  const snapshot = await buildSnapshot(client, settings, kind, aggregateId);
  const body = canonicalJson(snapshot);
  const digest = payloadDigest(snapshot);
  return client.sj_sync_outbox.create({
    data: {
      event_id: crypto.randomUUID(),
      aggregate_type: SNAPSHOT_AGGREGATE_TYPE,
      aggregate_id: snapshot.snapshot_id,
      aggregate_version: snapshot.source_version,
      event_type: SNAPSHOT_EVENT_TYPE,
      schema_version: 1,
      payload_json: JSON.parse(body),
      payload_checksum: digest,
      target_binding_json: require('./outboxTarget').captureTarget(SNAPSHOT_EVENT_TYPE, settings),
      priority: 5,
      state: "QUEUED",
    },
  });
}

module.exports = {
  assertCentralSnapshotConfig,
  SNAPSHOT_AGGREGATE_TYPE,
  SNAPSHOT_EVENT_TYPE,
  buildSnapshot,
  queueReviewSnapshot,
};
