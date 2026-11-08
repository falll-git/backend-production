const test = require('node:test');
const assert = require('node:assert/strict');
const { payloadDigest } = require('./controlReview.contract');
const { snapshotContainsMedia } = require('./controlReviewMedia');
const instance='11111111-1111-4111-8111-111111111111', snapshotId='22222222-2222-4222-8222-222222222222', mediaId='33333333-3333-4333-8333-333333333333';
function row(kind='profile') {
  const payload_json={snapshot_id:snapshotId,instance_id:instance,source_version:2,
    detail:{kind,...(kind==='profile'?{logo:{source_media_id:mediaId}}:{media:[{source_media_id:mediaId}]})}};
  return {event_type:'CONTROL_REVIEW_SNAPSHOT',aggregate_type:'CONTROL_REVIEW',aggregate_id:snapshotId,
    aggregate_version:2,payload_json,payload_checksum:payloadDigest(payload_json)};
}
test('immutable profile/publication/lifecycle media membership does not depend on later approval or draft',()=>{
  for(const kind of ['profile','publication','change_request']) assert.equal(snapshotContainsMedia(row(kind),instance,snapshotId,mediaId),true);
});
test('wrong instance, snapshot, media, version and event are denied',()=>{
  const original=row();
  for(const args of [[original,'foreign',snapshotId,mediaId],[original,instance,'foreign',mediaId],[original,instance,snapshotId,'foreign'],
    [{...original,aggregate_version:3},instance,snapshotId,mediaId],[{...original,event_type:'UPSERT_BPRS_PROFILE'},instance,snapshotId,mediaId],
    [{...original,aggregate_type:'PROFILE'},instance,snapshotId,mediaId],[{...original,aggregate_id:'foreign'},instance,snapshotId,mediaId]])
    assert.equal(snapshotContainsMedia(...args),false);
});
test('tampered immutable payload, absent snapshot and contact pseudo media are denied',()=>{
  const tampered=row();tampered.payload_json.detail.logo.source_media_id='other';
  assert.equal(snapshotContainsMedia(tampered,instance,snapshotId,'other'),false);
  assert.equal(snapshotContainsMedia(null,instance,snapshotId,mediaId),false);
  assert.equal(snapshotContainsMedia(row('contact'),instance,snapshotId,mediaId),false);
});
