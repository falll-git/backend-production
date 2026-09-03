const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const pg = require("pg");
const sharp = require("sharp");
const request = require("supertest");

const { loadEnv } = require("../config/env");

loadEnv();

const {
  buildAuthorization,
  loginAgent,
} = require("./support/integration-test-helpers");

const { Client } = pg;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function clearCentralInstitution(owner, institutionId) {
  for (const table of [
    "quarantine_records",
    "publication_media",
    "public_search_documents",
    "land_details",
    "building_details",
    "machine_details",
    "vehicle_details",
    "publications",
    "bprs_profiles",
    "whatsapp_contacts",
    "media_upload_sessions",
    "central_jobs",
    "media_objects",
    "reconciliation_runs",
    "aggregate_cursors",
    "ingest_events",
  ]) {
    await owner.query(`DELETE FROM ${table} WHERE institution_id = $1`, [institutionId]);
  }
  await owner.query(
    "DELETE FROM request_nonces WHERE key_id IN (SELECT key_id FROM institution_keys WHERE institution_id = $1)",
    [institutionId],
  );
  await owner.query("DELETE FROM institution_keys WHERE institution_id = $1", [institutionId]);
  await owner.query("DELETE FROM institution_installations WHERE institution_id = $1", [institutionId]);
  await owner.query("DELETE FROM institutions WHERE id = $1", [institutionId]);
}

function requiredCredential(prefix) {
  const username = String(process.env[`${prefix}_USERNAME`] || "").trim();
  const password = String(process.env[`${prefix}_PASSWORD`] || "");
  if (!username || !password) {
    throw new Error(`${prefix}_USERNAME dan ${prefix}_PASSWORD wajib diisi.`);
  }
  return { username, password };
}

function assertLocalDisposableDatabaseUrl(value, label) {
  const parsed = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error(`${label} hanya boleh mengarah ke database loopback.`);
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!databaseName.endsWith("_local")) {
    throw new Error(`${label} hanya boleh memakai database disposable berakhiran _local.`);
  }
}

async function grantTestCapabilities(prisma, user, features, snapshots) {
  const menus = await prisma.menus.findMany({
    where: { url: { startsWith: "/dashboard/seputar-jaminan" } },
  });
  const permissionByUrl = {
    "/dashboard/seputar-jaminan": {
      can_create: true,
      can_read: true,
      can_update: true,
      can_delete: true,
      features,
    },
    "/dashboard/seputar-jaminan/katalog": {
      can_create: true,
      can_read: true,
      can_update: true,
      can_delete: true,
      features: [],
    },
    "/dashboard/seputar-jaminan/pemeriksaan": {
      can_create: false,
      can_read: true,
      can_update: true,
      can_delete: false,
      features: [],
    },
    "/dashboard/seputar-jaminan/profil-kontak": {
      can_create: true,
      can_read: true,
      can_update: true,
      can_delete: true,
      features: [],
    },
  };
  for (const menu of menus) {
    const permission = permissionByUrl[menu.url];
    if (!permission) continue;
    const key = `${user.role_id}:${menu.id}`;
    if (!snapshots.has(key)) {
      const existing = await prisma.role_menus.findUnique({
        where: { role_id_menu_id: { role_id: user.role_id, menu_id: menu.id } },
      });
      snapshots.set(key, {
        role_id: user.role_id,
        menu_id: menu.id,
        existing,
      });
    }
    await prisma.role_menus.upsert({
      where: { role_id_menu_id: { role_id: user.role_id, menu_id: menu.id } },
      create: { role_id: user.role_id, menu_id: menu.id, ...permission },
      update: permission,
    });
  }
}

test(
  "workflow katalog Ruwang menerapkan maker-checker, kontak reusable, allowlist, dan outbox",
  { skip: process.env.RUN_SEPUTAR_JAMINAN_INTEGRATION !== "true", timeout: 120_000 },
  async (t) => {
    const keepLocalFixture = process.env.SJ_TEST_KEEP_LOCAL_FIXTURE === "true";
    const centralBaseUrl = String(process.env.SJ_TEST_CENTRAL_BASE_URL || "").replace(/\/+$/, "");
    const centralOwnerDatabaseUrl = String(
      process.env.SJ_TEST_CENTRAL_OWNER_DATABASE_URL || "",
    ).trim();
    const centralPublicDatabaseUrl = String(
      process.env.SJ_TEST_CENTRAL_PUBLIC_DATABASE_URL || "",
    ).trim();
    const publicWebBaseUrl = String(
      process.env.SJ_TEST_PUBLIC_WEB_BASE_URL || "",
    ).replace(/\/+$/, "");
    const usesRealCentral = Boolean(
      centralBaseUrl && centralOwnerDatabaseUrl && centralPublicDatabaseUrl,
    );
    if (
      new Set([
        Boolean(centralBaseUrl),
        Boolean(centralOwnerDatabaseUrl),
        Boolean(centralPublicDatabaseUrl),
      ]).size !== 1
    ) {
      throw new Error(
        "SJ_TEST_CENTRAL_BASE_URL, SJ_TEST_CENTRAL_OWNER_DATABASE_URL, dan "
          + "SJ_TEST_CENTRAL_PUBLIC_DATABASE_URL harus diisi bersama.",
      );
    }
    const app = require("../app");
    const appPrisma = require("../config/prisma");
    const prisma = require("../config/prisma-system");
    const { createBasePrismaClient } = require("../config/prisma-client-factory");
    const { getContracts } = require("../modules/seputar-jaminan/contracts");
    const { runSyncCycle } = require("../modules/seputar-jaminan/syncWorker.service");
    const { createMediaStorage } = require("../modules/seputar-jaminan/mediaStorage");
    const ruwangOwnerDatabaseUrl = String(
      process.env.SJ_TEST_RUWANG_OWNER_DATABASE_URL || "",
    ).trim();
    if (!ruwangOwnerDatabaseUrl) {
      throw new Error(
        "SJ_TEST_RUWANG_OWNER_DATABASE_URL wajib untuk cleanup database disposable.",
      );
    }
    if (keepLocalFixture) {
      if (!usesRealCentral) {
        throw new Error("Fixture lokal hanya boleh dipertahankan ketika API pusat nyata digunakan.");
      }
      assertLocalDisposableDatabaseUrl(centralOwnerDatabaseUrl, "Database pusat");
      assertLocalDisposableDatabaseUrl(ruwangOwnerDatabaseUrl, "Database Ruwang");
    }
    const ownerPrisma = createBasePrismaClient({
      applicationName: "ruwang-arsip-sj-integration-cleanup",
      connectionString: ruwangOwnerDatabaseUrl,
    });
    const makerCredentials = requiredCredential("SJ_TEST_MAKER");
    const checkerCredentials = requiredCredential("SJ_TEST_CHECKER");
    const makerAgent = request.agent(app);
    const checkerAgent = request.agent(app);
    const userAgent = `RuwangArsipIntegration/SeputarJaminan/${crypto.randomUUID()}`;
    const runId = crypto.randomUUID();
    let makerToken;
    let checkerToken;
    const rolePermissionSnapshots = new Map();

    const maker = await prisma.users.findUnique({
      where: { username: makerCredentials.username.toLowerCase() },
    });
    const checker = await prisma.users.findUnique({
      where: { username: checkerCredentials.username.toLowerCase() },
    });
    assert.ok(maker, "Akun maker uji harus tersedia.");
    assert.ok(checker, "Akun checker uji harus tersedia.");
    assert.notEqual(maker.id, checker.id);

    const features = [
      "sj_review",
      "sj_publish",
      "sj_unpublish",
      "sj_archive",
      "sj_reconfirm",
      "sj_contact_verify",
      "sj_profile_verify",
      "sj_sync_retry",
    ];
    await grantTestCapabilities(prisma, maker, features, rolePermissionSnapshots);
    await grantTestCapabilities(prisma, checker, features, rolePermissionSnapshots);

    const institutionId = crypto.randomUUID();
    const installationId = crypto.randomUUID();
    const keyId = crypto.randomUUID();
    let profileMarkId = crypto.randomUUID();
    let publicationMediaId = crypto.randomUUID();
    const centralProfileMarkId = crypto.randomUUID();
    const centralPublicationMediaId = crypto.randomUUID();
    const debtorNumber = `SJ-IT-${runId.slice(0, 8)}`;
    let debtor;
    let collateral;
    let profile;
    let contact;
    let publication;
    let centralOwner;
    let centralPublic;
    const uploadedMediaKeys = [];
    const previousPrivateKey = process.env.SJ_INTEGRATION_PRIVATE_KEY;

    if (usesRealCentral) {
      const health = await fetch(`${centralBaseUrl}/health/ready`);
      assert.equal(health.status, 200, "API pusat lokal harus siap sebelum tes lintas sistem.");
      const suppliedPrivateKey = String(
        process.env.SJ_TEST_INTEGRATION_PRIVATE_KEY || "",
      ).trim();
      const privateKey = suppliedPrivateKey
        ? crypto.createPrivateKey(suppliedPrivateKey)
        : crypto.generateKeyPairSync("ed25519").privateKey;
      const publicKey = crypto.createPublicKey(privateKey);
      process.env.SJ_INTEGRATION_PRIVATE_KEY = privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString();
      centralOwner = new Client({ connectionString: centralOwnerDatabaseUrl });
      centralPublic = new Client({ connectionString: centralPublicDatabaseUrl });
      await Promise.all([centralOwner.connect(), centralPublic.connect()]);
      await clearCentralInstitution(centralOwner, institutionId);
      await centralOwner.query(
        `INSERT INTO institutions
          (id, legal_name_internal, public_slug, state, onboarded_at, created_at, updated_at)
         VALUES ($1, 'BPRS Uji Lintas Sistem', $2, 'ACTIVE', now(), now(), now())`,
        [institutionId, `bprs-uji-${runId.slice(0, 8)}`],
      );
      await centralOwner.query(
        `INSERT INTO institution_installations
          (id, institution_id, installation_name, state, contract_version, created_at, updated_at)
         VALUES ($1, $2, 'Ruwang Arsip Lokal', 'ACTIVE', 1, now(), now())`,
        [installationId, institutionId],
      );
      await centralOwner.query(
        `INSERT INTO institution_keys
          (key_id, institution_id, installation_id, public_key, algorithm, state, valid_from, created_at)
         VALUES ($1, $2, $3, $4, 'ED25519', 'ACTIVE', now(), now())`,
        [
          keyId,
          institutionId,
          installationId,
          publicKey.export({ type: "spki", format: "pem" }).toString(),
        ],
      );
    }

    t.after(async () => {
      try {
        const logout = (agent, token) => (
          token
            ? agent
              .post("/api/v1/auth/logout")
              .set("User-Agent", userAgent)
              .set(buildAuthorization(token))
              .timeout({ response: 5_000, deadline: 10_000 })
            : Promise.resolve()
        );
        // Logout adalah best-effort dalam cleanup fixture. Batas waktu mencegah
        // teardown menggantung, sementara token fixture tetap dihapus eksplisit
        // di transaksi disposable di bawah.
        await Promise.allSettled([
          logout(makerAgent, makerToken),
          logout(checkerAgent, checkerToken),
        ]);

        if (!keepLocalFixture) {
          // Snapshot yang sudah APPROVED/VERIFIED sengaja immutable. Database ini
          // khusus disposable integration test, jadi cleanup fixture dilakukan
          // sebagai pemilik database dengan trigger dinonaktifkan hanya di dalam
          // transaksi ini. Kode runtime tidak memiliki jalur ini.
          await ownerPrisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
            await tx.sj_publication_reviews.deleteMany();
            await tx.sj_sync_attempts.deleteMany();
            await tx.sj_sync_outbox.deleteMany();
            await tx.sj_reconciliation_runs.deleteMany();
            await tx.sj_publication_version_media.deleteMany();
            await tx.sj_land_details.deleteMany();
            await tx.sj_building_details.deleteMany();
            await tx.sj_machine_details.deleteMany();
            await tx.sj_vehicle_details.deleteMany();
            await tx.sj_publication_versions.deleteMany();
            await tx.sj_publications.deleteMany();
            await tx.sj_whatsapp_contact_versions.deleteMany();
            await tx.sj_whatsapp_contacts.deleteMany();
            await tx.sj_public_profile_versions.deleteMany();
            await tx.sj_public_profiles.deleteMany();
            await tx.sj_media_assets.deleteMany({
              where: { id: { in: [profileMarkId, publicationMediaId] } },
            });
            await tx.sj_integration_settings.deleteMany();
            if (collateral) {
              await tx.debtor_collaterals.deleteMany({ where: { id: collateral.id } });
            }
            if (debtor) {
              await tx.digital_debtors.deleteMany({ where: { id: debtor.id } });
            }
            await tx.refresh_tokens.deleteMany({ where: { user_agent: userAgent } });
            for (const snapshot of rolePermissionSnapshots.values()) {
              const key = {
                role_id_menu_id: {
                  role_id: snapshot.role_id,
                  menu_id: snapshot.menu_id,
                },
              };
              if (!snapshot.existing) {
                await tx.role_menus.deleteMany({
                  where: { role_id: snapshot.role_id, menu_id: snapshot.menu_id },
                });
                continue;
              }
              await tx.role_menus.update({
                where: key,
                data: {
                  can_create: snapshot.existing.can_create,
                  can_read: snapshot.existing.can_read,
                  can_update: snapshot.existing.can_update,
                  can_delete: snapshot.existing.can_delete,
                  features: snapshot.existing.features,
                },
              });
            }
          });
          if (uploadedMediaKeys.length > 0) {
            const storage = createMediaStorage();
            await Promise.allSettled(uploadedMediaKeys.map((key) => storage.remove(key)));
          }
          if (centralOwner) {
            await clearCentralInstitution(centralOwner, institutionId);
          }
        }
        if (centralOwner) await centralOwner.end();
        if (centralPublic) {
          await centralPublic.end();
        }
      } finally {
        if (previousPrivateKey === undefined) delete process.env.SJ_INTEGRATION_PRIVATE_KEY;
        else process.env.SJ_INTEGRATION_PRIVATE_KEY = previousPrivateKey;
        await Promise.allSettled([
          appPrisma.$disconnect(),
          prisma.$disconnect(),
          ownerPrisma.$disconnect(),
        ]);
      }
    });

    const makerLogin = await loginAgent(makerAgent, makerCredentials, userAgent);
    makerToken = makerLogin.accessToken;
    const checkerLogin = await loginAgent(checkerAgent, checkerCredentials, userAgent);
    checkerToken = checkerLogin.accessToken;

    await makerAgent
      .patch("/api/v1/seputar-jaminan/settings")
      .set("User-Agent", userAgent)
      .set(makerLogin.authorization)
      .send({
        institution_id: institutionId,
        installation_id: installationId,
        key_id: keyId,
        central_base_url: usesRealCentral ? centralBaseUrl : "http://127.0.0.1:39999",
        module_visible: true,
        draft_enabled: true,
        review_enabled: true,
        sync_enabled: true,
        publish_enabled: true,
        filesystem_upload_enabled: true,
        s3_upload_enabled: false,
      })
      .expect(200);

    await makerAgent
      .patch("/api/v1/seputar-jaminan/settings")
      .set("User-Agent", userAgent)
      .set(makerLogin.authorization)
      .send({ institution_id: crypto.randomUUID() })
      .expect(409);

    async function runSyncUntil(readState, isReady, label) {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await runSyncCycle({ workerId: `integration-${runId}`, batchSize: 10 });
        const state = await readState();
        if (isReady(state)) return state;
        if (state?.state === "REJECTED" || state?.sync_state === "QUARANTINED") {
          throw new Error(`${label} ditolak saat sinkronisasi: ${state.rejection_code || state.last_sync_error_code || "UNKNOWN"}`);
        }
        const failedEvent = await prisma.sj_sync_outbox.findFirst({
          where: { state: { in: ["FAILED", "QUARANTINED"] } },
          orderBy: { created_at: "asc" },
          select: { event_type: true, state: true, last_error_code: true },
        });
        if (failedEvent) {
          throw new Error(
            `${label} gagal disinkronkan. Status aman: ${JSON.stringify(failedEvent)}`,
          );
        }
        await sleep(250);
      }
      const safeOutbox = await prisma.sj_sync_outbox.findMany({
        where: { state: { not: "ACKNOWLEDGED" } },
        orderBy: { created_at: "asc" },
        select: {
          event_type: true,
          state: true,
          attempt_count: true,
          last_error_code: true,
        },
      });
      throw new Error(
        `${label} tidak selesai disinkronkan dalam batas waktu pengujian. `
        + `Status aman: ${JSON.stringify(safeOutbox)}`,
      );
    }

    async function uploadRealImage(purpose, fileName, width, height, color) {
      const image = await sharp({
        create: { width, height, channels: 3, background: color },
      }).png().toBuffer();
      const response = await makerAgent
        .post("/api/v1/seputar-jaminan/media")
        .set("User-Agent", userAgent)
        .set(makerLogin.authorization)
        .field("purpose", purpose)
        .attach("image", image, { filename: fileName, contentType: "image/png" })
        .expect(201);
      const stored = await prisma.sj_media_assets.findUnique({ where: { id: response.body.data.id } });
      assert.ok(stored);
      uploadedMediaKeys.push(stored.logical_object_key);
      return response.body.data.id;
    }

    async function waitForMediaReady(mediaId, label) {
      return runSyncUntil(
        () => prisma.sj_media_assets.findUnique({ where: { id: mediaId } }),
        (row) => row?.state === "READY" && Boolean(row.central_media_id),
        label,
      );
    }

    async function waitForAggregateAcknowledged(delegate, id, label) {
      return runSyncUntil(
        () => prisma[delegate].findUnique({ where: { id } }),
        (row) => row?.sync_state === "ACKNOWLEDGED",
        label,
      );
    }

    async function assertQueuedEventContract(eventType, aggregateId) {
      const row = await prisma.sj_sync_outbox.findFirst({
        where: { event_type: eventType, aggregate_id: aggregateId },
        orderBy: { aggregate_version: "desc" },
      });
      assert.ok(row, `${eventType} harus tersedia di outbox.`);
      const contracts = await getContracts();
      const validation = contracts.validateIntegrationEvent({
        event_id: row.event_id,
        schema_version: row.schema_version,
        event_type: row.event_type,
        institution_id: institutionId,
        aggregate_id: row.aggregate_id,
        aggregate_version: row.aggregate_version,
        occurred_at: row.created_at.toISOString(),
        payload_checksum: row.payload_checksum,
        payload: row.payload_json,
      });
      assert.equal(
        validation.valid,
        true,
        `${eventType} berubah setelah round-trip database: ${JSON.stringify(validation.errors)}`,
      );
      return row;
    }

    const taxonomyResponse = await makerAgent
      .get("/api/v1/seputar-jaminan/taxonomy")
      .set("User-Agent", userAgent)
      .set(makerLogin.authorization)
      .expect(200);
    const houseTaxonomy = taxonomyResponse.body.data.categories
      .find((category) => category.code === "BUILDING")
      ?.items.find((item) => item.code === "RUMAH");
    assert.ok(houseTaxonomy);

    await makerAgent
      .post("/api/v1/seputar-jaminan/contacts")
      .set("User-Agent", userAgent)
      .set(makerLogin.authorization)
      .send({ label: "Marketing katalog", phone_e164: "+6281234567890", is_default: true })
      .expect(422);

    const contactCreated = await makerAgent
      .post("/api/v1/seputar-jaminan/contacts")
      .set("User-Agent", userAgent)
      .set(makerLogin.authorization)
      .send({ label: "Marketing katalog", phone_e164: "+6281234567890" })
      .expect(201);
    contact = contactCreated.body.data;
    assert.equal(contact.is_default, false);

    const contactSubmitted = await makerAgent
      .post(`/api/v1/seputar-jaminan/contacts/${contact.id}/submit`)
      .set("User-Agent", userAgent)
      .set(makerLogin.authorization)
      .send({ expected_version: contact.lock_version })
      .expect(200);
    await makerAgent
      .post(`/api/v1/seputar-jaminan/contacts/${contact.id}/verify`)
      .set("User-Agent", userAgent)
      .set(makerLogin.authorization)
      .send({ expected_version: contactSubmitted.body.data.lock_version })
      .expect(409);
    const contactVerified = await checkerAgent
      .post(`/api/v1/seputar-jaminan/contacts/${contact.id}/verify`)
      .set("User-Agent", userAgent)
      .set(checkerLogin.authorization)
      .send({ expected_version: contactSubmitted.body.data.lock_version })
      .expect(200);
    contact = contactVerified.body.data;
    const defaultContact = await makerAgent
      .post(`/api/v1/seputar-jaminan/contacts/${contact.id}/set-default`)
      .set("User-Agent", userAgent)
      .set(makerLogin.authorization)
      .send({ expected_version: contact.lock_version })
      .expect(200);
    contact = defaultContact.body.data;
    assert.equal(contact.is_default, true);
    if (usesRealCentral) {
      const contactOutbox = await assertQueuedEventContract(
        "UPSERT_WHATSAPP_CONTACT",
        contact.id,
      );
      await makerAgent
        .patch("/api/v1/seputar-jaminan/settings")
        .set("User-Agent", userAgent)
        .set(makerLogin.authorization)
        .send({ central_base_url: "http://127.0.0.1:1" })
        .expect(200);
      await runSyncCycle({ workerId: `integration-retry-${runId}`, batchSize: 10 });
      const recoverableContactEvent = await prisma.sj_sync_outbox.findUnique({
        where: { id: contactOutbox.id },
      });
      assert.equal(recoverableContactEvent.state, "RETRYING");
      assert.equal(recoverableContactEvent.attempt_count, 1);
      assert.equal(recoverableContactEvent.last_error_code, "CENTRAL_UNREACHABLE");
      await makerAgent
        .patch("/api/v1/seputar-jaminan/settings")
        .set("User-Agent", userAgent)
        .set(makerLogin.authorization)
        .send({ central_base_url: centralBaseUrl })
        .expect(200);
      const retriedContactEvent = await checkerAgent
        .post(`/api/v1/seputar-jaminan/sync-events/${contactOutbox.id}/retry`)
        .set("User-Agent", userAgent)
        .set(checkerLogin.authorization)
        .expect(200);
      assert.equal(retriedContactEvent.body.data.state, "QUEUED");
      assert.equal(retriedContactEvent.body.data.last_error_code, null);
      contact = await waitForAggregateAcknowledged(
        "sj_whatsapp_contacts",
        contact.id,
        "Kontak WhatsApp",
      );
    }

    if (usesRealCentral) {
      profileMarkId = await uploadRealImage(
        "BPRS_PUBLIC_MARK",
        "logo-bprs-uji.png",
        640,
        640,
        { r: 47, g: 51, b: 62 },
      );
      await waitForMediaReady(profileMarkId, "Logo publik BPRS");
      publicationMediaId = await uploadRealImage(
        "PUBLICATION_IMAGE",
        "rumah-uji.png",
        1280,
        960,
        { r: 225, g: 218, b: 201 },
      );
    } else {
      await prisma.sj_media_assets.createMany({
        data: [
          {
            id: profileMarkId,
            owner_division_id: maker.division_id,
            purpose: "BPRS_PUBLIC_MARK",
            logical_object_key: `integration/${runId}/profile.webp`,
            storage_backend: "FILESYSTEM",
            source_file_name_sanitized: "profile.webp",
            detected_mime: "image/webp",
            size_bytes: 1024,
            width: 640,
            height: 640,
            sha256: "c".repeat(64),
            state: "READY",
            central_media_id: centralProfileMarkId,
            created_by: maker.id,
          },
          {
            id: publicationMediaId,
            owner_division_id: maker.division_id,
            purpose: "PUBLICATION_IMAGE",
            logical_object_key: `integration/${runId}/publication.webp`,
            storage_backend: "FILESYSTEM",
            source_file_name_sanitized: "publication.webp",
            detected_mime: "image/webp",
            size_bytes: 2048,
            width: 1280,
            height: 960,
            sha256: "d".repeat(64),
            state: "READY",
            central_media_id: centralPublicationMediaId,
            created_by: maker.id,
          },
        ],
      });
    }

    const profileDraft = await makerAgent
      .patch("/api/v1/seputar-jaminan/profile/draft")
      .set("User-Agent", userAgent)
      .set(makerLogin.authorization)
      .send({
        display_name: "BPRS Uji Integrasi",
        public_slug: `bprs-uji-${runId.slice(0, 8)}`,
        city_regency: "Bandung",
        province: "Jawa Barat",
        short_description: "Profil publik BPRS untuk pengujian integrasi terkontrol.",
        logo_media_id: profileMarkId,
        website_url: "https://example.invalid",
      })
      .expect(200);
    profile = profileDraft.body.data;
    const profileSubmitted = await makerAgent
      .post("/api/v1/seputar-jaminan/profile/submit")
      .set("User-Agent", userAgent)
      .set(makerLogin.authorization)
      .send({ expected_version: profile.lock_version })
      .expect(200);
    await makerAgent
      .post("/api/v1/seputar-jaminan/profile/verify")
      .set("User-Agent", userAgent)
      .set(makerLogin.authorization)
      .send({ expected_version: profileSubmitted.body.data.lock_version })
      .expect(409);
    const profileVerified = await checkerAgent
      .post("/api/v1/seputar-jaminan/profile/verify")
      .set("User-Agent", userAgent)
      .set(checkerLogin.authorization)
      .send({ expected_version: profileSubmitted.body.data.lock_version })
      .expect(200);
    profile = profileVerified.body.data;
    if (usesRealCentral) {
      await assertQueuedEventContract("UPSERT_BPRS_PROFILE", institutionId);
      profile = await waitForAggregateAcknowledged(
        "sj_public_profiles",
        profile.id,
        "Profil publik BPRS",
      );
    } else {
      await prisma.sj_whatsapp_contacts.update({
        where: { id: contact.id },
        data: { sync_state: "ACKNOWLEDGED" },
      });
      await prisma.sj_public_profiles.update({
        where: { id: profile.id },
        data: { sync_state: "ACKNOWLEDGED" },
      });
      await prisma.sj_integration_settings.updateMany({
        data: { connection_state: "ACTIVE" },
      });
    }

    debtor = await prisma.digital_debtors.create({
      data: {
        debtor_number: debtorNumber,
        name: "Debitur fixture Seputar Jaminan",
        status: "ACTIVE",
        customer_type: "INDIVIDUAL",
        created_by: maker.id,
      },
    });
    collateral = await prisma.debtor_collaterals.create({
      data: {
        debtor_id: debtor.id,
        collateral_number: `AGUNAN-${runId.slice(0, 8)}`,
        collateral_type: "SHM",
        owner_name: "Pemilik fixture",
        proof_number: `BUKTI-${runId.slice(0, 8)}`,
        address: "Alamat internal tidak boleh keluar",
        market_value: 500000000,
        description: "Catatan internal tidak boleh keluar",
        period_month: "202608",
        created_by: maker.id,
      },
    });

    const publicationCreated = await makerAgent
      .post("/api/v1/seputar-jaminan/publications")
      .set("User-Agent", userAgent)
      .set(makerLogin.authorization)
      .send({
        source_type: "COLLATERAL",
        source_collateral_id: collateral.id,
        asset_category: "BUILDING",
        taxonomy_item_id: houseTaxonomy.id,
        title: "Rumah tinggal dua lantai",
        description: "Hunian dua lantai dengan akses lingkungan yang mudah dijangkau.",
        city_regency: "Bandung",
        province: "Jawa Barat",
        whatsapp_contact_version_id: contact.current_version_id,
        profile_version_id: profile.current_version_id,
        attributes: {
          land_area_m2: 126,
          building_area_m2: 148,
          floor_count: 2,
          public_usage: "HUNIAN",
        },
        media: [
          {
            media_asset_id: publicationMediaId,
            sort_order: 0,
            is_cover: true,
            alt_text: "Tampak depan rumah dua lantai",
          },
        ],
      })
      .expect(201);
    publication = publicationCreated.body.data;
    if (usesRealCentral) {
      await waitForMediaReady(publicationMediaId, "Gambar katalog publik");
    }

    let publicationSubmitted = await makerAgent
      .post(`/api/v1/seputar-jaminan/publications/${publication.id}/submit`)
      .set("User-Agent", userAgent)
      .set(makerLogin.authorization)
      .send({ expected_version: publication.lock_version })
      .expect(200);

    const publicationRevision = await checkerAgent
      .post(`/api/v1/seputar-jaminan/publications/${publication.id}/request-revision`)
      .set("User-Agent", userAgent)
      .set(checkerLogin.authorization)
      .send({
        expected_version: publicationSubmitted.body.data.lock_version,
        reason: "Perjelas judul publik agar mudah dipahami calon peminat.",
      })
      .expect(200);
    assert.equal(publicationRevision.body.data.state, "REVISION_REQUIRED");

    const publicationEdited = await makerAgent
      .patch(`/api/v1/seputar-jaminan/publications/${publication.id}/draft`)
      .set("User-Agent", userAgent)
      .set(makerLogin.authorization)
      .send({
        expected_version: publicationRevision.body.data.lock_version,
        title: "Rumah tinggal dua lantai siap huni",
      })
      .expect(200);
    publication = publicationEdited.body.data;
    assert.equal(publication.state, "DRAFT");

    publicationSubmitted = await makerAgent
      .post(`/api/v1/seputar-jaminan/publications/${publication.id}/submit`)
      .set("User-Agent", userAgent)
      .set(makerLogin.authorization)
      .send({ expected_version: publication.lock_version })
      .expect(200);
    await makerAgent
      .post(`/api/v1/seputar-jaminan/publications/${publication.id}/approve-and-publish`)
      .set("User-Agent", userAgent)
      .set(makerLogin.authorization)
      .send({ expected_version: publicationSubmitted.body.data.lock_version })
      .expect(409);
    const publicationApproved = await checkerAgent
      .post(`/api/v1/seputar-jaminan/publications/${publication.id}/approve-and-publish`)
      .set("User-Agent", userAgent)
      .set(checkerLogin.authorization)
      .send({ expected_version: publicationSubmitted.body.data.lock_version })
      .expect(200);
    publication = publicationApproved.body.data;
    assert.equal(publication.state, "APPROVED");
    assert.equal(publication.sync_state, "QUEUED");
    const referenceCode = publication.reference_code;
    assert.match(referenceCode, /^SJ-[A-Z0-9]{8}$/u);

    const outbox = await prisma.sj_sync_outbox.findFirst({
      where: { aggregate_id: publication.id, event_type: "UPSERT_PUBLICATION_SNAPSHOT" },
      orderBy: { aggregate_version: "desc" },
    });
    assert.ok(outbox);
    assert.equal(outbox.payload_json.reference_code, referenceCode);
    assert.equal(outbox.payload_json.price, undefined);
    assert.equal(outbox.payload_json.owner_name, undefined);
    assert.equal(outbox.payload_json.proof_number, undefined);
    assert.equal(JSON.stringify(outbox.payload_json).includes("Alamat internal"), false);
    assert.equal(JSON.stringify(outbox.payload_json).includes("Catatan internal"), false);

    if (usesRealCentral) {
      publication = await waitForAggregateAcknowledged(
        "sj_publications",
        publication.id,
        "Publikasi katalog",
      );
      assert.equal(publication.state, "PUBLISHED");
      assert.equal(publication.public_reference_code, referenceCode);

      let publicAsset;
      let lastPublicResponse = { status: null, error_code: null };
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const response = await fetch(
          `${centralBaseUrl}/v1/public/assets/${encodeURIComponent(referenceCode)}`,
        );
        if (response.status === 200) {
          publicAsset = await response.json();
          break;
        }
        const errorBody = await response.json().catch(() => ({}));
        lastPublicResponse = {
          status: response.status,
          error_code: typeof errorBody?.error?.code === "string" ? errorBody.error.code : null,
        };
        assert.equal(response.status, 404, "Endpoint publik hanya boleh menunggu proyeksi atau berhasil.");
        await sleep(250);
      }
      if (!publicAsset) {
        const [
          publicationRows,
          publicationMediaRows,
          searchRows,
          jobRows,
          eventRows,
          mediaRows,
          profileRows,
          contactRows,
          publicRoleRows,
          publicVisibilityRows,
        ] =
          await Promise.all([
            centralOwner.query(
              `SELECT state,
                      availability,
                      next_reconfirmation_at > CURRENT_TIMESTAMP AS reconfirmation_valid,
                      unpublished_at IS NULL AS not_unpublished,
                      archived_at IS NULL AS not_archived
                 FROM publications
                WHERE institution_id = $1
                ORDER BY created_at`,
              [institutionId],
            ),
            centralOwner.query(
              `SELECT pm.is_cover, mo.state AS media_state
                 FROM publication_media pm
                 JOIN media_objects mo ON mo.id = pm.media_object_id
                WHERE pm.institution_id = $1
                ORDER BY pm.sort_order`,
              [institutionId],
            ),
            centralOwner.query(
              "SELECT count(*)::int AS count FROM public_search_documents WHERE institution_id = $1",
              [institutionId],
            ),
            centralOwner.query(
              `SELECT job_type, state, attempt_count, last_error_code
                 FROM central_jobs WHERE institution_id = $1 ORDER BY created_at`,
              [institutionId],
            ),
            centralOwner.query(
              `SELECT event_type, state, error_code
                 FROM ingest_events WHERE institution_id = $1 ORDER BY received_at`,
              [institutionId],
            ),
            centralOwner.query(
              "SELECT purpose, state FROM media_objects WHERE institution_id = $1 ORDER BY created_at",
              [institutionId],
            ),
            centralOwner.query(
              "SELECT state FROM bprs_profiles WHERE institution_id = $1",
              [institutionId],
            ),
            centralOwner.query(
              "SELECT state FROM whatsapp_contacts WHERE institution_id = $1",
              [institutionId],
            ),
            centralPublic.query(
              `SELECT pg_has_role(current_user, 'sj_public', 'member') AS member,
                      sj_has_database_role('sj_public') AS accepted`,
            ),
            centralPublic.query(
              `SELECT p.public_reference_code = $2 AS reference_matches,
                      p.state = 'PUBLISHED' AS state_matches,
                      p.availability = 'AVAILABLE' AS availability_matches,
                      p.next_reconfirmation_at > CURRENT_TIMESTAMP AS reconfirmation_matches,
                      EXISTS (
                        SELECT 1 FROM institutions i
                         WHERE i.id = p.institution_id AND i.state = 'ACTIVE'
                      ) AS institution_matches,
                      EXISTS (
                        SELECT 1 FROM bprs_profiles bp
                         WHERE bp.id = p.profile_id AND bp.state = 'ACTIVE'
                      ) AS profile_matches,
                      EXISTS (
                        SELECT 1 FROM whatsapp_contacts wc
                         WHERE wc.id = p.whatsapp_contact_id AND wc.state = 'VERIFIED'
                      ) AS contact_matches,
                      EXISTS (
                        SELECT 1
                          FROM publication_media pm
                          JOIN media_objects mo ON mo.id = pm.media_object_id
                         WHERE pm.publication_id = p.id
                           AND pm.is_cover = true
                           AND mo.state = 'READY'
                      ) AS cover_matches
                 FROM publications p
                WHERE p.institution_id = $1
                ORDER BY p.created_at`,
              [institutionId, referenceCode],
            ),
          ]);
        const safeCentralState = {
          publications: publicationRows.rows,
          publication_media: publicationMediaRows.rows,
          search_documents: searchRows.rows,
          jobs: jobRows.rows,
          events: eventRows.rows,
          media: mediaRows.rows,
          profiles: profileRows.rows,
          contacts: contactRows.rows,
          public_role: publicRoleRows.rows,
          public_visible_publications: publicVisibilityRows.rows,
          public_endpoint: lastPublicResponse,
        };
        assert.fail(
          `Aset harus tampil melalui endpoint publik pusat. Status aman: ${JSON.stringify(safeCentralState)}`,
        );
      }
      assert.equal(publicAsset.reference_code, referenceCode);
      assert.equal(publicAsset.title, "Rumah tinggal dua lantai siap huni");
      assert.equal(publicAsset.institution.public_name, "BPRS Uji Integrasi");
      assert.match(publicAsset.whatsapp_url, /^https:\/\/wa\.me\/6281234567890\?text=/u);
      const publicJson = JSON.stringify(publicAsset);
      for (const forbidden of [
        "price",
        "owner_name",
        "proof_number",
        "Alamat internal tidak boleh keluar",
        "Catatan internal tidak boleh keluar",
      ]) {
        assert.equal(publicJson.includes(forbidden), false, `${forbidden} tidak boleh keluar ke publik.`);
      }
      if (publicWebBaseUrl) {
        const publicWebUrl = new URL(publicWebBaseUrl);
        assert.ok(
          ["127.0.0.1", "localhost"].includes(publicWebUrl.hostname),
          "Web publik pengujian hanya boleh memakai loopback.",
        );
        const publicWebResponse = await fetch(publicWebBaseUrl);
        assert.equal(publicWebResponse.status, 200);
        const publicHtml = await publicWebResponse.text();
        assert.equal(publicHtml.includes("Rumah tinggal dua lantai siap huni"), true);
        assert.equal(publicHtml.includes("Alamat internal tidak boleh keluar"), false);
        assert.equal(publicHtml.includes("Catatan internal tidak boleh keluar"), false);
        const sameOriginMediaPath = publicHtml.match(/\/media\/[0-9a-f-]{36}/u)?.[0];
        assert.ok(sameOriginMediaPath, "Web publik harus merender media melalui proxy same-origin.");
        const publicMediaResponse = await fetch(`${publicWebBaseUrl}${sameOriginMediaPath}`);
        assert.equal(publicMediaResponse.status, 200);
        assert.match(publicMediaResponse.headers.get("content-type") || "", /^image\//u);
      }
      const publicInstitutions = await fetch(
        `${centralBaseUrl}/v1/public/institutions?q=${encodeURIComponent("BPRS Uji Integrasi")}`,
      );
      assert.equal(publicInstitutions.status, 200);
      const institutionDirectory = await publicInstitutions.json();
      assert.equal(institutionDirectory.items.length, 1);
      assert.equal(institutionDirectory.items[0].published_asset_count, 1);

      const updatedDraft = await makerAgent
        .patch(`/api/v1/seputar-jaminan/publications/${publication.id}/draft`)
        .set("User-Agent", userAgent)
        .set(makerLogin.authorization)
        .send({
          expected_version: publication.lock_version,
          title: "Rumah tinggal dua lantai siap huni dan terawat",
        })
        .expect(200);
      publication = updatedDraft.body.data;
      assert.equal(publication.state, "DRAFT");
      const updatedSubmission = await makerAgent
        .post(`/api/v1/seputar-jaminan/publications/${publication.id}/submit`)
        .set("User-Agent", userAgent)
        .set(makerLogin.authorization)
        .send({ expected_version: publication.lock_version })
        .expect(200);
      const updatedApproval = await checkerAgent
        .post(`/api/v1/seputar-jaminan/publications/${publication.id}/approve-and-publish`)
        .set("User-Agent", userAgent)
        .set(checkerLogin.authorization)
        .send({ expected_version: updatedSubmission.body.data.lock_version })
        .expect(200);
      publication = await waitForAggregateAcknowledged(
        "sj_publications",
        updatedApproval.body.data.id,
        "Pembaruan publikasi katalog",
      );
      assert.equal(publication.state, "PUBLISHED");
      const updatedPublicResponse = await fetch(
        `${centralBaseUrl}/v1/public/assets/${encodeURIComponent(referenceCode)}`,
      );
      assert.equal(updatedPublicResponse.status, 200);
      const updatedPublicAsset = await updatedPublicResponse.json();
      assert.equal(
        updatedPublicAsset.title,
        "Rumah tinggal dua lantai siap huni dan terawat",
      );
      assert.match(updatedPublicAsset.whatsapp_url, /6281234567890/u);
      if (publicWebBaseUrl) {
        const updatedPublicHtml = await (
          await fetch(publicWebBaseUrl, { cache: "no-store" })
        ).text();
        assert.equal(
          updatedPublicHtml.includes(
            "Rumah tinggal dua lantai siap huni dan terawat",
          ),
          true,
        );
      }

      if (!keepLocalFixture) {
        const unpublished = await checkerAgent
          .post(`/api/v1/seputar-jaminan/publications/${publication.id}/unpublish`)
          .set("User-Agent", userAgent)
          .set(checkerLogin.authorization)
          .send({ expected_version: publication.lock_version, reason_code: "OWNER_REQUEST" })
          .expect(200);
        publication = unpublished.body.data;
        publication = await waitForAggregateAcknowledged(
          "sj_publications",
          publication.id,
          "Penarikan publikasi",
        );
        assert.equal(publication.state, "UNPUBLISHED");
        assert.equal(
          (
            await fetch(
              `${centralBaseUrl}/v1/public/assets/${encodeURIComponent(referenceCode)}`,
            )
          ).status,
          404,
        );

        const archived = await checkerAgent
          .post(`/api/v1/seputar-jaminan/publications/${publication.id}/archive`)
          .set("User-Agent", userAgent)
          .set(checkerLogin.authorization)
          .send({ expected_version: publication.lock_version })
          .expect(200);
        publication = archived.body.data;
        publication = await waitForAggregateAcknowledged(
          "sj_publications",
          publication.id,
          "Pengarsipan publikasi",
        );
        assert.equal(publication.state, "ARCHIVED");
        assert.equal(
          (
            await fetch(
              `${centralBaseUrl}/v1/public/assets/${encodeURIComponent(referenceCode)}`,
            )
          ).status,
          404,
        );
      }
    }

    const reconciliationResponse = await checkerAgent
      .post("/api/v1/seputar-jaminan/reconciliation")
      .set("User-Agent", userAgent)
      .set(checkerLogin.authorization)
      .expect(202);
    const reconciliation = await prisma.sj_reconciliation_runs.findUnique({
      where: { id: reconciliationResponse.body.data.id },
    });
    const aggregateTypes = reconciliation.safe_report_json.items
      .map((item) => item.aggregate_type)
      .sort();
    assert.deepEqual(aggregateTypes, ["BPRS_PROFILE", "PUBLICATION", "WHATSAPP_CONTACT"]);
  },
);
