const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CI_SJ,
  assertSafeCiStorage,
  makeCiImage,
  seedCiSeputarJaminan,
} = require("./seed-ci-seputar-jaminan");

const safeEnv = {
  CI: "true",
  DATABASE_URL:
    "postgresql://postgres:postgres@127.0.0.1:5432/ruwang_arsip_ci?schema=public",
  SEED_ADMIN_USERNAME: "CI-Admin",
  UPLOAD_DIR: "/tmp/ruwang-ci-storage/uploads",
};

test("fixture SJ CI menolak storage bucket dan path produksi", () => {
  assert.throws(
    () => assertSafeCiStorage({ ...safeEnv, SJ_MEDIA_STORAGE_PROVIDER: "S3_COMPATIBLE" }),
    /hanya boleh memakai storage FILESYSTEM/,
  );
  assert.throws(
    () => assertSafeCiStorage({ ...safeEnv, UPLOAD_DIR: "/srv/ruwang/uploads" }),
    /path CI\/test\/local/,
  );
});

test("gambar fixture SJ dihasilkan deterministik sebagai WebP", async () => {
  const first = await makeCiImage({ width: 320, height: 180, background: "#0f5f8f" });
  const second = await makeCiImage({ width: 320, height: 180, background: "#0f5f8f" });
  assert.equal(first.width, 320);
  assert.equal(first.height, 180);
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(first.buffer, second.buffer);
  assert.equal(first.buffer.subarray(0, 4).toString("ascii"), "RIFF");
});

test("fixture SJ CI dapat dijalankan ulang tanpa menggandakan snapshot", async () => {
  const created = {
    profileVersion: 0,
    contactVersion: 0,
    publicationVersion: 0,
    buildingDetail: 0,
    publicationMedia: 0,
  };
  const present = {
    profileVersion: false,
    contactVersion: false,
    publicationVersion: false,
  };
  const upsertCounts = new Map();
  let buildingPublicUsage = null;
  const upsert = (name, result) => async () => {
    upsertCounts.set(name, (upsertCounts.get(name) || 0) + 1);
    return result;
  };
  const tx = {
    users: {
      upsert: upsert("reviewer", { id: "reviewer-ci" }),
    },
    sj_integration_settings: { upsert: upsert("settings", {}) },
    sj_media_assets: { upsert: upsert("media", {}) },
    sj_public_profiles: {
      upsert: upsert("profile", { id: CI_SJ.profileId }),
      update: async () => ({}),
    },
    sj_public_profile_versions: {
      findUnique: async () =>
        present.profileVersion ? { id: CI_SJ.profileVersionId } : null,
      create: async () => {
        created.profileVersion += 1;
        present.profileVersion = true;
        return { id: CI_SJ.profileVersionId };
      },
      update: async () => ({}),
    },
    sj_whatsapp_contacts: {
      upsert: upsert("contact", { id: CI_SJ.contactId }),
      update: async () => ({}),
    },
    sj_whatsapp_contact_versions: {
      findUnique: async () =>
        present.contactVersion ? { id: CI_SJ.contactVersionId } : null,
      create: async () => {
        created.contactVersion += 1;
        present.contactVersion = true;
        return { id: CI_SJ.contactVersionId };
      },
      update: async () => ({}),
    },
    sj_publications: {
      upsert: upsert("publication", { id: CI_SJ.publicationId }),
      update: async () => ({}),
    },
    sj_publication_versions: {
      findUnique: async () =>
        present.publicationVersion ? { id: CI_SJ.publicationVersionId } : null,
      create: async () => {
        created.publicationVersion += 1;
        present.publicationVersion = true;
        return { id: CI_SJ.publicationVersionId };
      },
      update: async () => ({}),
    },
    sj_building_details: {
      create: async ({ data }) => {
        created.buildingDetail += 1;
        buildingPublicUsage = data.public_usage;
      },
    },
    sj_publication_version_media: {
      create: async () => {
        created.publicationMedia += 1;
      },
    },
    sj_publication_reviews: { upsert: upsert("review", {}) },
  };
  const client = {
    users: {
      findUnique: async ({ where }) => {
        assert.equal(where.username, "ci-admin");
        return {
          id: "admin-ci",
          role_id: "role-ci",
          division_id: "division-ci",
          password: "ephemeral-password-hash",
        };
      },
    },
    $transaction: async (callback) => callback(tx),
  };
  let mediaWrites = 0;
  const dependencies = {
    writeMedia: async (_env, items) => {
      mediaWrites += 1;
      assert.equal(items.length, 2);
    },
  };

  await seedCiSeputarJaminan(safeEnv, client, dependencies);
  await seedCiSeputarJaminan(safeEnv, client, dependencies);

  assert.deepEqual(created, {
    profileVersion: 1,
    contactVersion: 1,
    publicationVersion: 1,
    buildingDetail: 1,
    publicationMedia: 1,
  });
  assert.equal(upsertCounts.get("settings"), 2);
  assert.equal(upsertCounts.get("media"), 4);
  assert.equal(upsertCounts.get("review"), 4);
  assert.equal(mediaWrites, 2);
  assert.equal(buildingPublicUsage, "HUNIAN");
});
