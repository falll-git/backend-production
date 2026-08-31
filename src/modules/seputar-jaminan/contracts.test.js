const assert = require("node:assert/strict");
const test = require("node:test");

const { getContracts, verifyVendoredContract } = require("./contracts");
const { PUBLIC_STATE_BY_EVENT } = require("./seputarJaminan.service");
const {
  contactDraftSchema,
  createPublicationSchema,
} = require("./seputarJaminan.validation");

test("snapshot kontrak V1 terverifikasi dan dapat memvalidasi event", async () => {
  const manifest = verifyVendoredContract();
  assert.equal(manifest.package, "@seputarjaminan/contracts");
  assert.equal(manifest.version, "1.0.0");

  const contracts = await getContracts();
  assert.equal(contracts.CONTRACT_VERSION, 1);
  assert.equal(contracts.EVENT_TYPES.length, 7);
  assert.equal(typeof contracts.validateIntegrationEvent, "function");
});

test("rekonsiliasi memetakan tepat tujuh event ke state publik pusat", () => {
  assert.deepEqual(PUBLIC_STATE_BY_EVENT, {
    UPSERT_BPRS_PROFILE: "ACTIVE",
    UPSERT_WHATSAPP_CONTACT: "VERIFIED",
    REVOKE_WHATSAPP_CONTACT: "REVOKED",
    UPSERT_PUBLICATION_SNAPSHOT: "PUBLISHED",
    UNPUBLISH_PUBLICATION: "UNPUBLISHED",
    ARCHIVE_PUBLICATION: "ARCHIVED",
    REVOKE_MEDIA: "REVOKED",
  });
});

test("kontak baru tidak dapat ditandai utama sebelum verifikasi", () => {
  const result = contactDraftSchema.validate({
    label: "Marketing aset",
    phone_e164: "+6281234567890",
    is_default: true,
  });
  assert.match(
    result.error?.message || "",
    /diverifikasi sebelum dapat dijadikan kontak utama/i,
  );
});

test("API Ruwang menolak vocabulary atribut di luar kontrak Opsi A", async () => {
  const contracts = await getContracts();
  assert.deepEqual(contracts.PUBLIC_ATTRIBUTE_VOCABULARIES.public_condition, [
    "SANGAT_BAIK",
    "BAIK",
    "CUKUP",
    "PERLU_PERBAIKAN",
  ]);

  const result = createPublicationSchema.validate({
    source_type: "MANUAL",
    manual_reason: "Alasan manual yang aman untuk pengujian.",
    manual_evidence_document_id: "11111111-1111-4111-8111-111111111111",
    asset_category: "VEHICLE",
    taxonomy_item_id: "22222222-2222-4222-8222-222222222222",
    title: "Kendaraan untuk pengujian",
    description: "Deskripsi sintetis yang tidak memuat informasi internal.",
    city_regency: "Bandung",
    province: "Jawa Barat",
    whatsapp_contact_version_id: "33333333-3333-4333-8333-333333333333",
    profile_version_id: "44444444-4444-4444-8444-444444444444",
    attributes: {
      brand: "Merek sintetis",
      model_or_type: "Model sintetis",
      public_condition: "LAINNYA",
    },
    media: [{
      media_asset_id: "55555555-5555-4555-8555-555555555555",
      sort_order: 0,
      is_cover: true,
      alt_text: "Foto kendaraan sintetis",
    }],
  });
  assert.ok(result.error);
});
