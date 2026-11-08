const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEvidence,readEvidenceBody } = require('./deliveryEvidence');

const now = Date.parse('2026-09-30T12:00:00Z');
const event = {event_id:'32166756-c2bd-4aa2-967d-99b5f646433a',aggregate_id:'80b35407-baa0-4d92-88f9-3fdd265346e2',aggregate_version:2,payload_checksum:'a'.repeat(64)};
const settings = {institution_id:'993174dc-1e22-4e79-a41d-0b4b963cf063',installation_id:'85098cbe-cdfd-4904-b411-66032930dd75'};
const sample = () => ({contract_version:1,request_nonce:'request-nonce',checked_at:new Date(now).toISOString(),...settings,...event,
  projection:{event_id:event.event_id,version:2,payload_checksum:event.payload_checksum,visible:true,scope:'PUBLIC_READ_PREDICATE',reference_code:'SJ-1234ABCD'},reason:null});
const valid = value => validateEvidence(value,event,settings,'request-nonce',now);

test('accepts bound projection evidence without asserting public HTTP success',()=>assert.equal(valid(sample()),true));
test('rejects wrong identities, version, checksum, nonce, timestamp and extra fields',()=>{
  for(const [field,value] of Object.entries({institution_id:'other',installation_id:'other',event_id:settings.institution_id,aggregate_id:settings.installation_id,aggregate_version:3,payload_checksum:'b'.repeat(64),request_nonce:'old',checked_at:new Date(now-300001).toISOString(),unexpected:true})){
    assert.equal(valid({...sample(),[field]:value}),false,field);
  }
});
test('rejects inconsistent event lineage and malformed projections',()=>{
  for(const patch of [{version:3},{payload_checksum:'b'.repeat(64)},{visible:'true'},{scope:'PUBLIC_HTTP_SUCCESS'},{reference_code:'https://invalid.example'},{extra:true}]){
    assert.equal(valid({...sample(),projection:{...sample().projection,...patch}}),false);
  }
});
test('accepts an explicitly different projected event, never equating it to the requested version',()=>{
  assert.equal(valid({...sample(),projection:{...sample().projection,event_id:settings.institution_id,version:1,payload_checksum:'c'.repeat(64)}}),true);
});
test('unknown or non-public projection requires an explicit allowlisted reason',()=>{
  for(const reason of ['NOT_A_PUBLIC_PAGE','PROJECTION_NOT_FOUND','PROJECTION_LINEAGE_NOT_PROVEN'])assert.equal(valid({...sample(),projection:null,reason}),true);
  for(const reason of [null,'SUCCESS','VISIBLE'])assert.equal(valid({...sample(),projection:null,reason}),false);
});
test('private evidence response is bounded, JSON-only and rejects invalid UTF-8',async()=>{
  assert.deepEqual(await readEvidenceBody(Response.json({ok:true})),{ok:true});
  await assert.rejects(readEvidenceBody(Response.json({large:'x'.repeat(65536)})),/TOO_LARGE/);
  await assert.rejects(readEvidenceBody(new Response('{}')),/CONTENT_TYPE/);
  await assert.rejects(readEvidenceBody(new Response(new Uint8Array([0xff]),{headers:{'content-type':'application/json'}})));
});
