const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildSnapshot,
  queueReviewSnapshot,
} = require("./controlReviewSnapshot.service");

const ids = Object.freeze({
  instance: "10000000-0000-4000-8000-000000000001",
  aggregate: "10000000-0000-4000-8000-000000000002",
  version: "10000000-0000-4000-8000-000000000003",
  user: "10000000-0000-4000-8000-000000000004",
  media: "10000000-0000-4000-8000-000000000005",
  centralMedia: "10000000-0000-4000-8000-000000000006",
});

const readyMedia = Object.freeze({
  id: ids.media,
  central_media_id: ids.centralMedia,
  state: "READY",
  detected_mime: "image/webp",
  width: 1200,
  height: 800,
});

const settings = Object.freeze({
  institution_id: "10000000-0000-4000-8000-000000000007",
  installation_id: ids.instance,
  review_authority: "central",
});

test("snapshot profil hanya memuat data publik dan media siap", async () => {
  const client = {
    sj_public_profiles: {
      findUnique: async () => ({
        id: ids.aggregate,
        lock_version: 2,
        display_name: "BPRS Uji",
        public_slug: "bprs-uji",
        short_description: "Profil publik.",
        city_regency: "Bogor",
        province: "Jawa Barat",
        website_url: null,
        logo_media: readyMedia,
        versions: [{
          id: ids.version,
          state: "IN_REVIEW",
          submitted_at: new Date("2026-09-10T01:00:00.000Z"),
          payload_checksum: "a".repeat(64),
          created_by: ids.user,
        }],
      }),
    },
  };
  const snapshot = await buildSnapshot(client, settings, "profile", ids.aggregate);
  assert.equal(snapshot.detail.kind, "profile");
  assert.equal(snapshot.detail.logo.central_media_id, ids.centralMedia);
  assert.deepEqual(snapshot.contributor_subjects, [`ruwang-bank:${ids.user}`]);
  assert.equal(JSON.stringify(snapshot).includes("password"), false);
});

test("snapshot kontak memakai versi immutable yang sedang diperiksa", async () => {
  const client = {
    sj_whatsapp_contacts: {
      findUnique: async () => ({
        id: ids.aggregate,
        lock_version: 4,
        versions: [{
          id: ids.version,
          state: "IN_REVIEW",
          submitted_at: new Date("2026-09-10T01:00:00.000Z"),
          checksum: "b".repeat(64),
          created_by: ids.user,
          label: "Marketing",
          phone_e164: "+628123456789",
          message_template_version: 1,
        }],
      }),
    },
  };
  const snapshot = await buildSnapshot(client, settings, "contact", ids.aggregate);
  assert.equal(snapshot.detail.phone_e164, "+628123456789");
  assert.equal(snapshot.source_version, 4);
});

test("snapshot publikasi menjaga checksum, contributor, urutan media dan syarat siap", async (t) => {
  const crypto = require('node:crypto');
  const keyPair = crypto.generateKeyPairSync('ed25519');
  const transport = {
    SJ_CONTROL_BASE_URL: 'http://127.0.0.1:1', SJ_CONTROL_ACK_KEY_ID: 'test-bank', SJ_CONTROL_KEY_ID: 'test-control',
    SJ_CONTROL_ACK_PRIVATE_KEY: keyPair.privateKey.export({type:'pkcs8',format:'pem'}),
    SJ_CONTROL_PUBLIC_KEY: keyPair.publicKey.export({type:'spki',format:'pem'}),
  };
  const saved = Object.fromEntries(Object.keys(transport).map(k=>[k,process.env[k]]));
  Object.assign(process.env,transport);
  t.after(()=>{for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
  const oldEnabled = process.env.SJ_CONTROL_SNAPSHOT_ENABLED;
  const oldInstance = process.env.SJ_CONTROL_INSTANCE_ID;
  process.env.SJ_CONTROL_SNAPSHOT_ENABLED = "true";
  process.env.SJ_CONTROL_INSTANCE_ID = ids.instance;
  t.after(() => {
    if (oldEnabled === undefined) delete process.env.SJ_CONTROL_SNAPSHOT_ENABLED;
    else process.env.SJ_CONTROL_SNAPSHOT_ENABLED = oldEnabled;
    if (oldInstance === undefined) delete process.env.SJ_CONTROL_INSTANCE_ID;
    else process.env.SJ_CONTROL_INSTANCE_ID = oldInstance;
  });
  let inserted;
  const client = {
    sj_publications: {
      findUnique: async () => ({
        id: ids.aggregate,
        public_reference_code: "SJ-UJI12345",
        asset_category: "LAND",
        lock_version: 7,
        current_version: {
          id: ids.version,
          state: "IN_REVIEW",
          submitted_at: new Date("2026-09-10T01:00:00.000Z"),
          payload_checksum: "c".repeat(64),
          last_edited_by: ids.user,
          submitted_by: ids.user,
          title: "Tanah uji",
          description: "Deskripsi publik.",
          city_regency: "Bogor",
          province: "Jawa Barat",
          availability: "AVAILABLE",
          taxonomy_item: { code: "LAND_PLOT" },
          land_detail: { land_area_m2: "100", contour: null, road_access: "Aspal" },
          building_detail: null,
          machine_detail: null,
          vehicle_detail: null,
          media: [{ media_asset: readyMedia, sort_order: 0, is_cover: true, alt_text: "Tampak depan" }],
          whatsapp_contact_version: { label: "Marketing", phone_e164: "+628123456789", contact: {} },
          profile_version: { profile: { display_name: "BPRS Uji", public_slug: "bprs-uji" } },
        },
      }),
    },
    sj_sync_outbox: {
      create: async ({ data }) => { inserted = data; return data; },
    },
  };
  await queueReviewSnapshot(client, settings, "publication", ids.aggregate);
  assert.equal(inserted.event_type, "CONTROL_REVIEW_SNAPSHOT");
  assert.equal(inserted.aggregate_type, "CONTROL_REVIEW");
  assert.equal(inserted.payload_json.detail.media[0].position, 1);
  assert.equal(inserted.payload_json.payload_checksum, "c".repeat(64));
  assert.equal(inserted.payload_checksum.length, 64);
  assert.equal(inserted.target_binding_json.installation_id, ids.instance);
  assert.equal(inserted.target_binding_json.destination, 'CONTROL_REVIEW');
  assert.equal(JSON.stringify(inserted).includes('PRIVATE KEY'), false);
});

test("authority lokal tidak membuat outbox Control", async () => {
  const result = await queueReviewSnapshot({}, { review_authority: "local" }, "profile", ids.aggregate);
  assert.equal(result, null);
});

test("snapshot permintaan perubahan memisahkan tindakan, dampak dan waktu pengajuan ulang", async () => {
  const submittedAt = new Date("2026-09-11T03:15:00.000Z");
  const client = {
    sj_control_change_requests: {
      findUnique: async () => ({
        id: ids.aggregate,
        action: "UNPUBLISH_PUBLICATION",
        resource_kind: "PUBLICATION",
        resource_id: ids.version,
        reason: "Aset tidak lagi ditawarkan kepada publik.",
        state: "IN_REVIEW",
        request_version: 2,
        impact_checksum: "d".repeat(64),
        submitted_by: ids.user,
        submitted_at: submittedAt,
        impact_json: {
          target_label: "Tanah uji",
          current_state: "PUBLISHED",
          expected_public_visibility: "not_visible",
          blockers: [],
          affected_publications: 1,
          affected_media: 1,
          central_synced: true,
          reference_code: "SJ-UJI12345",
          public_slug: null,
          media: [readyMedia],
        },
      }),
    },
  };
  const snapshot = await buildSnapshot(client, settings, "change_request", ids.aggregate);
  assert.equal(snapshot.source_version, 2);
  assert.notEqual(snapshot.snapshot_id, ids.aggregate);
  assert.match(snapshot.snapshot_id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(snapshot.submitted_at, submittedAt.toISOString());
  assert.equal(snapshot.detail.action, "UNPUBLISH_PUBLICATION");
  assert.equal(snapshot.detail.expected_public_visibility, "not_visible");
});
