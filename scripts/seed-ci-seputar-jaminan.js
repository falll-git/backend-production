const crypto = require("node:crypto");
const sharp = require("sharp");

const { assertSafeCiDatabase, CI_COLLATERAL_ID } = require("./seed-ci-test-data");
const { getContracts } = require("../src/modules/seputar-jaminan/contracts");
const {
  FilesystemMediaStorage,
  storageRoot,
} = require("../src/modules/seputar-jaminan/mediaStorage");

const CI_SJ = Object.freeze({
  settingsId: "00000000-0000-4000-8000-00000000d001",
  institutionId: "00000000-0000-4000-8000-00000000d002",
  installationId: "00000000-0000-4000-8000-00000000d003",
  logoMediaId: "00000000-0000-4000-8000-00000000d101",
  coverMediaId: "00000000-0000-4000-8000-00000000d102",
  profileId: "00000000-0000-4000-8000-00000000d201",
  profileVersionId: "00000000-0000-4000-8000-00000000d202",
  contactId: "00000000-0000-4000-8000-00000000d301",
  contactVersionId: "00000000-0000-4000-8000-00000000d302",
  publicationId: "00000000-0000-4000-8000-00000000d401",
  publicationVersionId: "00000000-0000-4000-8000-00000000d402",
  submittedReviewId: "00000000-0000-4000-8000-00000000d501",
  approvedReviewId: "00000000-0000-4000-8000-00000000d502",
  referenceCode: "SJ-MDENGFCA",
  reviewerUsername: "ci-sj-reviewer",
  reviewerEmail: "ci-sj-reviewer@example.test",
});

function assertSafeCiStorage(env = process.env) {
  const provider = String(env.SJ_MEDIA_STORAGE_PROVIDER || "FILESYSTEM").toUpperCase();
  if (provider !== "FILESYSTEM") {
    throw new Error("Fixture Seputar Jaminan CI hanya boleh memakai storage FILESYSTEM.");
  }
  const root = storageRoot(env);
  if (!/(?:^|[\\/._-])(?:ci|test|local)(?:[\\/._-]|$)/i.test(root)) {
    throw new Error("Storage fixture Seputar Jaminan wajib berada di path CI/test/local.");
  }
  return root;
}

async function makeCiImage({ width, height, background }) {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background,
    },
  })
    .webp({ quality: 82 })
    .toBuffer();
  return {
    buffer,
    width,
    height,
    sizeBytes: BigInt(buffer.length),
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

async function writeCiMedia(env, items) {
  const storage = new FilesystemMediaStorage(assertSafeCiStorage(env));
  for (const item of items) {
    try {
      const existing = await storage.read(item.logicalKey);
      if (!existing.equals(item.image.buffer)) {
        throw new Error(`Isi fixture media berubah untuk ${item.logicalKey}.`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await storage.put(item.logicalKey, item.image.buffer);
    }
  }
}

async function seedCiSeputarJaminan(env = process.env, client, dependencies = {}) {
  assertSafeCiDatabase(env);
  assertSafeCiStorage(env);
  const prisma = client || require("../src/config/prisma");
  const adminUsername = String(
    env.SEED_ADMIN_USERNAME || env.API_TEST_ADMIN_USERNAME || "",
  )
    .trim()
    .toLowerCase();
  if (!adminUsername) {
    throw new Error("SEED_ADMIN_USERNAME atau API_TEST_ADMIN_USERNAME wajib diisi.");
  }

  const admin = await prisma.users.findUnique({
    where: { username: adminUsername },
    select: {
      id: true,
      role_id: true,
      division_id: true,
      password: true,
    },
  });
  if (!admin) {
    throw new Error("Admin CI belum tersedia. Jalankan seed utama terlebih dahulu.");
  }

  const logo = await makeCiImage({ width: 320, height: 320, background: "#0f5f8f" });
  const cover = await makeCiImage({ width: 1200, height: 800, background: "#d7e8ef" });
  const logoKey = `${admin.division_id}/ci/seputar-jaminan-logo.webp`;
  const coverKey = `${admin.division_id}/ci/seputar-jaminan-cover.webp`;
  const mediaItems = [
    { logicalKey: logoKey, image: logo },
    { logicalKey: coverKey, image: cover },
  ];
  const mediaWriter = dependencies.writeMedia || writeCiMedia;
  await mediaWriter(env, mediaItems);

  const contracts = await getContracts();
  const submittedAt = new Date("2026-08-31T00:00:00.000Z");
  const approvedAt = new Date("2026-08-31T00:05:00.000Z");
  const nextConfirmationAt = new Date("2026-09-30T00:05:00.000Z");

  await prisma.$transaction(async (tx) => {
    const reviewer = await tx.users.upsert({
      where: { username: CI_SJ.reviewerUsername },
      update: {
        name: "Pemeriksa Fixture SJ",
        email: CI_SJ.reviewerEmail,
        password: admin.password,
        role_id: admin.role_id,
        division_id: admin.division_id,
        is_active: true,
        onboarding_status: "ACTIVE",
      },
      create: {
        name: "Pemeriksa Fixture SJ",
        username: CI_SJ.reviewerUsername,
        email: CI_SJ.reviewerEmail,
        password: admin.password,
        role_id: admin.role_id,
        division_id: admin.division_id,
        is_active: true,
        onboarding_status: "ACTIVE",
        email_verified_at: approvedAt,
        password_set_at: approvedAt,
        activated_at: approvedAt,
      },
      select: { id: true },
    });

    await tx.sj_integration_settings.upsert({
      where: { institution_id: CI_SJ.institutionId },
      update: {
        installation_id: CI_SJ.installationId,
        key_id: "ci-sj-key-v1",
        central_base_url: "http://127.0.0.1:4010/api/v1",
        connection_state: "ACTIVE",
        module_visible: true,
        draft_enabled: true,
        review_enabled: true,
        sync_enabled: true,
        publish_enabled: true,
        filesystem_upload_enabled: true,
        s3_upload_enabled: false,
        last_success_at: approvedAt,
        last_error_at: null,
        last_error_code: null,
      },
      create: {
        id: CI_SJ.settingsId,
        institution_id: CI_SJ.institutionId,
        installation_id: CI_SJ.installationId,
        key_id: "ci-sj-key-v1",
        central_base_url: "http://127.0.0.1:4010/api/v1",
        connection_state: "ACTIVE",
        module_visible: true,
        draft_enabled: true,
        review_enabled: true,
        sync_enabled: true,
        publish_enabled: true,
        filesystem_upload_enabled: true,
        s3_upload_enabled: false,
        last_success_at: approvedAt,
      },
    });

    const mediaRows = [
      {
        id: CI_SJ.logoMediaId,
        purpose: "BPRS_PUBLIC_MARK",
        logical_object_key: logoKey,
        source_file_name_sanitized: "logo-bprs-uji.webp",
        central_media_id: "ci-central-logo-v1",
        image: logo,
      },
      {
        id: CI_SJ.coverMediaId,
        purpose: "PUBLICATION_IMAGE",
        logical_object_key: coverKey,
        source_file_name_sanitized: "rumah-dua-lantai.webp",
        central_media_id: "ci-central-cover-v1",
        image: cover,
      },
    ];
    for (const media of mediaRows) {
      await tx.sj_media_assets.upsert({
        where: { id: media.id },
        update: {
          owner_division_id: admin.division_id,
          purpose: media.purpose,
          logical_object_key: media.logical_object_key,
          source_file_name_sanitized: media.source_file_name_sanitized,
          detected_mime: "image/webp",
          size_bytes: media.image.sizeBytes,
          width: media.image.width,
          height: media.image.height,
          sha256: media.image.sha256,
          state: "READY",
          central_media_id: media.central_media_id,
          rejection_code: null,
          revoked_at: null,
        },
        create: {
          id: media.id,
          owner_division_id: admin.division_id,
          purpose: media.purpose,
          logical_object_key: media.logical_object_key,
          storage_backend: "FILESYSTEM",
          source_file_name_sanitized: media.source_file_name_sanitized,
          detected_mime: "image/webp",
          size_bytes: media.image.sizeBytes,
          width: media.image.width,
          height: media.image.height,
          sha256: media.image.sha256,
          state: "READY",
          central_media_id: media.central_media_id,
          created_by: admin.id,
        },
      });
    }

    const profilePayload = {
      public_name: "BPRS Uji Integrasi",
      public_slug: "bprs-uji-integrasi",
      short_description: "Profil BPRS khusus untuk pengujian integrasi yang bersifat sementara.",
      office_city_regency: "Bandung",
      office_province: "Jawa Barat",
      logo_media_id: "ci-central-logo-v1",
      website_url: "https://example.test",
    };
    const profile = await tx.sj_public_profiles.upsert({
      where: { singleton_key: "BPRS_PUBLIC_PROFILE" },
      update: {
        current_version_id: null,
        display_name: "BPRS Uji Integrasi",
        public_slug: "bprs-uji-integrasi",
        city_regency: "Bandung",
        province: "Jawa Barat",
        short_description: profilePayload.short_description,
        logo_media_id: CI_SJ.logoMediaId,
        website_url: "https://example.test",
        state: "DRAFT",
        sync_state: "NOT_QUEUED",
        updated_by: admin.id,
      },
      create: {
        id: CI_SJ.profileId,
        display_name: "BPRS Uji Integrasi",
        public_slug: "bprs-uji-integrasi",
        city_regency: "Bandung",
        province: "Jawa Barat",
        short_description: profilePayload.short_description,
        logo_media_id: CI_SJ.logoMediaId,
        website_url: "https://example.test",
        created_by: admin.id,
        updated_by: admin.id,
      },
      select: { id: true },
    });
    let profileVersion = await tx.sj_public_profile_versions.findUnique({
      where: { id: CI_SJ.profileVersionId },
      select: { id: true },
    });
    if (!profileVersion) {
      profileVersion = await tx.sj_public_profile_versions.create({
        data: {
          id: CI_SJ.profileVersionId,
          profile_id: profile.id,
          version_number: 1,
          payload_json: profilePayload,
          payload_checksum: contracts.payloadChecksum(profilePayload),
          created_by: admin.id,
        },
        select: { id: true },
      });
      await tx.sj_public_profile_versions.update({
        where: { id: profileVersion.id },
        data: {
          state: "APPROVED",
          submitted_at: submittedAt,
          approved_by: reviewer.id,
          approved_at: approvedAt,
        },
      });
    }
    await tx.sj_public_profiles.update({
      where: { id: profile.id },
      data: {
        current_version_id: CI_SJ.profileVersionId,
        state: "VERIFIED",
        sync_state: "ACKNOWLEDGED",
        aggregate_version: 1,
        lock_version: 1,
        updated_by: reviewer.id,
      },
    });

    const contactChecksum = crypto
      .createHash("sha256")
      .update("Marketing katalog\n+6281234567890\n1")
      .digest("hex");
    const contact = await tx.sj_whatsapp_contacts.upsert({
      where: { phone_normalized: "6281234567890" },
      update: {
        current_version_id: null,
        label: "Marketing katalog",
        phone_e164: "+6281234567890",
        state: "DRAFT",
        is_default: true,
        sync_state: "NOT_QUEUED",
        revoked_at: null,
        updated_by: admin.id,
      },
      create: {
        id: CI_SJ.contactId,
        label: "Marketing katalog",
        phone_e164: "+6281234567890",
        phone_normalized: "6281234567890",
        is_default: true,
        created_by: admin.id,
        updated_by: admin.id,
      },
      select: { id: true },
    });
    let contactVersion = await tx.sj_whatsapp_contact_versions.findUnique({
      where: { id: CI_SJ.contactVersionId },
      select: { id: true },
    });
    if (!contactVersion) {
      contactVersion = await tx.sj_whatsapp_contact_versions.create({
        data: {
          id: CI_SJ.contactVersionId,
          contact_id: contact.id,
          version_number: 1,
          label: "Marketing katalog",
          phone_e164: "+6281234567890",
          checksum: contactChecksum,
          created_by: admin.id,
        },
        select: { id: true },
      });
      await tx.sj_whatsapp_contact_versions.update({
        where: { id: contactVersion.id },
        data: {
          state: "VERIFIED",
          submitted_at: submittedAt,
          verified_by: reviewer.id,
          verified_at: approvedAt,
        },
      });
    }
    await tx.sj_whatsapp_contacts.update({
      where: { id: contact.id },
      data: {
        current_version_id: CI_SJ.contactVersionId,
        state: "VERIFIED",
        sync_state: "ACKNOWLEDGED",
        aggregate_version: 1,
        lock_version: 1,
        last_verified_at: approvedAt,
        updated_by: reviewer.id,
      },
    });

    const publication = await tx.sj_publications.upsert({
      where: { public_reference_code: CI_SJ.referenceCode },
      update: {
        current_version_id: null,
        published_version_id: null,
        source_type: "COLLATERAL",
        source_collateral_id: CI_COLLATERAL_ID,
        owner_division_id: admin.division_id,
        asset_category: "BUILDING",
        state: "DRAFT",
        sync_state: "NOT_QUEUED",
        updated_by: admin.id,
      },
      create: {
        id: CI_SJ.publicationId,
        public_reference_code: CI_SJ.referenceCode,
        source_type: "COLLATERAL",
        source_collateral_id: CI_COLLATERAL_ID,
        owner_division_id: admin.division_id,
        asset_category: "BUILDING",
        created_by: admin.id,
        updated_by: admin.id,
      },
      select: { id: true },
    });

    const draftPayload = {
      title: "Rumah tinggal dua lantai",
      description: "Hunian dua lantai dengan akses lingkungan yang mudah dijangkau.",
      location: { city_regency: "Bandung", province: "Jawa Barat" },
      attributes: {
        land_area_m2: 126,
        building_area_m2: 148,
        floor_count: 2,
        public_usage: "Rumah tinggal",
      },
    };
    const publishedPayload = {
      publication_id: publication.id,
      reference_code: CI_SJ.referenceCode,
      institution_id: CI_SJ.institutionId,
      taxonomy_version: 1,
      category: "BANGUNAN",
      subcategory: "RUMAH",
      title: draftPayload.title,
      description: draftPayload.description,
      location: draftPayload.location,
      availability: "AVAILABLE",
      attributes: draftPayload.attributes,
      media: [
        {
          media_id: "ci-central-cover-v1",
          checksum: cover.sha256,
          position: 1,
          is_cover: true,
          alt_text: "Rumah tinggal dua lantai",
        },
      ],
      whatsapp_contact_id: contact.id,
      published_at: approvedAt.toISOString(),
      public_updated_at: approvedAt.toISOString(),
      availability_confirmed_at: approvedAt.toISOString(),
      next_confirmation_at: nextConfirmationAt.toISOString(),
    };
    let publicationVersion = await tx.sj_publication_versions.findUnique({
      where: { id: CI_SJ.publicationVersionId },
      select: { id: true },
    });
    if (!publicationVersion) {
      publicationVersion = await tx.sj_publication_versions.create({
        data: {
          id: CI_SJ.publicationVersionId,
          publication_id: publication.id,
          version_number: 1,
          taxonomy_version: 1,
          taxonomy_item_id: "11000000-0000-4000-8000-000000000002",
          title: draftPayload.title,
          description: draftPayload.description,
          city_regency: "Bandung",
          province: "Jawa Barat",
          availability: "AVAILABLE",
          whatsapp_contact_version_id: CI_SJ.contactVersionId,
          profile_version_id: CI_SJ.profileVersionId,
          public_payload_json: draftPayload,
          payload_checksum: contracts.payloadChecksum(draftPayload),
          last_edited_by: admin.id,
        },
        select: { id: true },
      });
      await tx.sj_building_details.create({
        data: {
          publication_version_id: publicationVersion.id,
          land_area_m2: 126,
          building_area_m2: 148,
          floor_count: 2,
          public_usage: "Rumah tinggal",
        },
      });
      await tx.sj_publication_version_media.create({
        data: {
          publication_version_id: publicationVersion.id,
          media_asset_id: CI_SJ.coverMediaId,
          sort_order: 0,
          is_cover: true,
          alt_text: "Rumah tinggal dua lantai",
        },
      });
      await tx.sj_publication_versions.update({
        where: { id: publicationVersion.id },
        data: {
          state: "IN_REVIEW",
          submitted_by: admin.id,
          submitted_at: submittedAt,
        },
      });
      await tx.sj_publication_versions.update({
        where: { id: publicationVersion.id },
        data: {
          state: "APPROVED",
          approved_by: reviewer.id,
          approved_at: approvedAt,
          public_payload_json: publishedPayload,
          payload_checksum: contracts.payloadChecksum(publishedPayload),
        },
      });
    }

    await tx.sj_publications.update({
      where: { id: publication.id },
      data: {
        current_version_id: CI_SJ.publicationVersionId,
        published_version_id: CI_SJ.publicationVersionId,
        state: "PUBLISHED",
        sync_state: "ACKNOWLEDGED",
        central_publication_id: "ci-central-publication-v1",
        aggregate_version: 1,
        lock_version: 1,
        last_confirmed_at: approvedAt,
        next_reconfirmation_at: nextConfirmationAt,
        last_sync_error_code: null,
        updated_by: reviewer.id,
      },
    });

    await tx.sj_publication_reviews.upsert({
      where: { id: CI_SJ.submittedReviewId },
      update: {},
      create: {
        id: CI_SJ.submittedReviewId,
        publication_id: publication.id,
        publication_version_id: CI_SJ.publicationVersionId,
        action: "SUBMITTED",
        reviewer_id: admin.id,
        created_at: submittedAt,
      },
    });
    await tx.sj_publication_reviews.upsert({
      where: { id: CI_SJ.approvedReviewId },
      update: {},
      create: {
        id: CI_SJ.approvedReviewId,
        publication_id: publication.id,
        publication_version_id: CI_SJ.publicationVersionId,
        action: "APPROVED",
        reviewer_id: reviewer.id,
        created_at: approvedAt,
      },
    });
  });

  console.log("CI Seputar Jaminan fixture seeded.");
}

async function main() {
  const prisma = require("../src/config/prisma");
  try {
    await seedCiSeputarJaminan(process.env, prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  CI_SJ,
  assertSafeCiStorage,
  makeCiImage,
  seedCiSeputarJaminan,
};
