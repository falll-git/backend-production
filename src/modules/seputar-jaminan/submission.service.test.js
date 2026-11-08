const assert = require("node:assert/strict");
const test = require("node:test");

const service = require("./submission.service");

test("keputusan Control hanya dikaitkan dengan versi dan checksum snapshot yang sama", () => {
  const commands = [
    {
      resource_id: "publication-1",
      expected_version: 1,
      expected_checksum: "checksum-lama",
      status: "APPLIED",
    },
    {
      resource_id: "publication-1",
      expected_version: 2,
      expected_checksum: "checksum-baru",
      status: "PROCESSING",
    },
  ];

  assert.equal(
    service._private.bankApplicationState(commands[1], "IN_REVIEW"),
    "WAITING_FOR_DECISION",
  );
  assert.equal(
    service._private.bankApplicationState({ status: "REJECTED" }, "IN_REVIEW"),
    "DECISION_REJECTED_BY_BANK",
  );
});

test("jenis pengajuan tidak berubah setelah keputusan; revisi awal tetap pengajuan baru", () => {
  const kind=service._private.requestKind;
  assert.equal(kind({version_number:1},{versions:[]}),"CREATE");
  assert.equal(kind({version_number:1},{versions:[{version_number:1}]}),"CREATE");
  assert.equal(kind({version_number:2},{versions:[{version_number:2}]}),"CREATE");
  assert.equal(kind({version_number:1},{versions:[{version_number:2}]}),"CREATE");
  assert.equal(kind({version_number:3},{versions:[{version_number:2}]}),"CHANGE");
});

test("status pengiriman dan publik tidak menyamakan disetujui dengan tayang", () => {
  assert.equal(service._private.deliveryState({ state: "ACKNOWLEDGED" }), "RECEIVED_BY_CONTROL");
  assert.equal(
    service._private.publicState({ publishedVersionId: "version-1", syncState: "QUEUED" }),
    "PUBLIC_UNKNOWN",
  );
  assert.equal(
    service._private.publicState({ publishedVersionId: "version-1", syncState: "ACKNOWLEDGED" }),
    "PUBLIC_UNKNOWN",
  );
  assert.equal(
    service._private.publicState({ publishedVersionId: null, syncState: "ACKNOWLEDGED" }),
    "PUBLIC_UNKNOWN",
  );
});

test('local lifecycle and delivery failures never establish public absence or visibility',()=>{
  for(const state of ['DRAFT','IN_REVIEW','PUBLISHED','UNPUBLISHED','ARCHIVED','HIDDEN','REVOKED']){
    for(const syncState of ['NOT_QUEUED','QUEUED','SENDING','ACKNOWLEDGED','FAILED','QUARANTINED']){
      assert.equal(service._private.publicState({state,syncState,publishedVersionId:'older-approved',currentVersionId:'new-draft'}),'PUBLIC_UNKNOWN');
    }
  }
});

test('contact submission exposes not-applicable rather than a fabricated public page state',()=>{
  const dto=service._private.serializeContact({contact:{id:'contact',sync_state:'ACKNOWLEDGED',current_version_id:'approved'},phone_e164:'+6281234567890',state:'VERIFIED'},null,null);
  assert.equal(dto.public_state,'NOT_APPLICABLE');assert.equal(dto.bank_application_state,'APPLIED_BY_BANK');
});
