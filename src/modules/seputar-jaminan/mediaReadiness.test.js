const test=require('node:test');const assert=require('node:assert/strict');
const {isMediaReady}=require('./mediaReadiness');
const {serializePublication}=require('./seputarJaminan.service');
test('upload session validates allocated identities, PUT target, expiry and capacity before using media bytes',()=>{
  const {validateUploadSession}=require('./mediaReadiness');
  const now=Date.now();
  const good={request_id:'test',media_id:'11111111-1111-4111-8111-111111111111',upload_session_id:'22222222-2222-4222-8222-222222222222',upload_url:'https://storage.invalid/object?signature=test',method:'PUT',headers:{'Content-Type':'image/png'},expires_at:new Date(now+60000).toISOString(),max_bytes:100};
  assert.equal(validateUploadSession(good,100,now),good);
  assert.equal(validateUploadSession({...good,upload_url:'http://127.0.0.1:4100/content'},100,now).method,'PUT');
  for(const change of [{media_id:'bad'},{upload_session_id:null},{request_id:''},{method:'GET'},{headers:null},{headers:{'X-Test':'bad\r\nheader'}},{upload_url:'file:///private'},{upload_url:'https://user:password@storage.invalid/upload'},{expires_at:new Date(now).toISOString()},{expires_at:'bad'},{max_bytes:99},{max_bytes:1.5},{unexpected:true}]){
    assert.throws(()=>validateUploadSession({...good,...change},100,now),e=>e.code==='CENTRAL_MEDIA_SESSION_INVALID');
  }
  assert.throws(()=>validateUploadSession({},100,now),e=>e.code==='CENTRAL_MEDIA_SESSION_INVALID');
});
test('a central ID is not readiness: processing, rejected, expired and revoked remain unavailable',()=>{
  for(const state of ['UPLOADED','UPLOAD_PENDING','PROCESSING','REJECTED','QUARANTINED','EXPIRED','REVOKED','DELETED'])assert.equal(isMediaReady({state,central_media_id:'central-id'}),false);
  assert.equal(isMediaReady(null),false);assert.equal(isMediaReady({state:'READY'}),false);
  assert.equal(isMediaReady({state:'READY',central_media_id:'central-id',revoked_at:new Date()}),false);
  assert.equal(isMediaReady({state:'READY',central_media_id:'central-id',revoked_at:null}),true);
});
test('publication DTO does not present a processing cover as ready',()=>{
  const media_asset={id:'media',state:'PROCESSING',central_media_id:'allocated-id',size_bytes:100};
  const link={is_cover:true,media_asset};const version={media:[link]};
  const dto=serializePublication({current_version:version,published_version:version});
  assert.equal(dto.cover.central_ready,false);assert.equal(dto.published_version.media[0].central_ready,false);
});

test('media status must identify the requested media and valid checked time before READY is accepted',()=>{
  const {validateMediaStatus}=require('./mediaReadiness');
  const good={request_id:'request',media_id:'media',status:'READY',rejection_code:null,checked_at:new Date().toISOString()};
  assert.equal(validateMediaStatus(good,'media'),good);
  for(const bad of [{},null,{...good,media_id:'other'},{...good,checked_at:null},{...good,checked_at:'bad'},{...good,status:'PUBLIC'},{...good,request_id:undefined}]){
    assert.throws(()=>validateMediaStatus(bad,'media'),e=>e.code==='CENTRAL_MEDIA_STATUS_INVALID');
  }
  for(const status of ['QUARANTINED','REVOKED','EXPIRED'])assert.equal(validateMediaStatus({...good,status},'media').status,status);
});
