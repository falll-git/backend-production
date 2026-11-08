const test=require('node:test'),assert=require('node:assert/strict'),read=require('./actionRead');
const row=(state='DRAFT')=>({id:'p',lock_version:2,state,published_version_id:'approved',current_version:{state,media:[{media_asset:{state:'READY',central_media_id:'m'}}],whatsapp_contact_version:{contact:{sync_state:'ACKNOWLEDGED'}},profile_version:{profile:{sync_state:'ACKNOWLEDGED'}},submitted_by:'maker',last_edited_by:'maker'}});
const ctx=(extra={})=>({userId:'checker',settings:{review_authority:'local',draft_enabled:true,review_enabled:true,publish_enabled:true,sync_enabled:true,connection_state:'ACTIVE'},centralReady:true,scopes:new Map([['p',true]]),refs:new Map([['p',false]]),can:()=>true,...extra});
function withBoundDelivery(control,run){
  const crypto=require('node:crypto'),{captureTarget}=require('./outboxTarget'),keys=crypto.generateKeyPairSync('ed25519');
  const env={SJ_INTEGRATION_PRIVATE_KEY:keys.privateKey.export({type:'pkcs8',format:'pem'}),SJ_CONTROL_ACK_PRIVATE_KEY:keys.privateKey.export({type:'pkcs8',format:'pem'}),SJ_CONTROL_PUBLIC_KEY:keys.publicKey.export({type:'spki',format:'pem'}),SJ_CONTROL_ACK_KEY_ID:'test-bank',SJ_CONTROL_KEY_ID:'test-control',SJ_CONTROL_BASE_URL:'https://control.example.test'};
  const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
  try{const settings={...ctx().settings,institution_id:crypto.randomUUID(),installation_id:crypto.randomUUID(),central_base_url:'https://sj.example.test',key_id:'test-sj'};
    const event={id:'p',state:'FAILED',event_type:control?'CONTROL_REVIEW_SNAPSHOT':'UPSERT_BPRS_PROFILE',payload_json:control?{instance_id:settings.installation_id}:{institution_id:settings.institution_id}};
    event.target_binding_json=captureTarget(event.event_type,settings,env);return run(event,ctx({settings}));
  }finally{for(const[k,v]of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;}
}

test('entry controls use actual route capabilities, RLS scope and flags without inventing a row version',()=>{
  const c=ctx({canCreate:()=>true}),scope={global_create:true,global_update:true,division_create:true};
  const good=read.entryActions(c,scope);
  assert.equal(good.expected_version,null);assert.ok(Object.values(good.actions).every(a=>a.available));
  assert.equal(read.entryActions({...c,canCreate:()=>false},scope).actions.create_contact.reason_code,'PERMISSION_DENIED');
  assert.equal(read.entryActions({...c,can:()=>false},scope).actions.create_profile.available,false);
  assert.equal(read.entryActions(c,{...scope,division_create:false}).actions.upload_media.available,false);
  assert.equal(read.entryActions(c,{...scope,global_create:false}).actions.reconcile.available,false);
  assert.equal(read.entryActions({...c,settings:{...c.settings,draft_enabled:false}},scope).actions.create_publication.reason_code,'FEATURE_DISABLED');
  assert.equal(read.entryActions({...c,settings:{...c.settings,sync_enabled:false}},scope).actions.reconcile.reason_code,'FEATURE_DISABLED');
  assert.equal(read.entryActions({...c,settings:null},scope).actions.create_contact.reason_code,'SETUP_REQUIRED');
  assert.ok(Object.values(read.entryActions({...c,userId:null},scope).actions).every(a=>!a.available));
});
test('actions never replace permission, row scope, or maker-checker with a state guess',()=>{
  for(const context of [ctx({can:()=>false}),ctx({scopes:new Map()}),ctx({userId:null})]){
    assert.ok(Object.values(read.publication(row(),context).actions).every(a=>!a.available&&a.reason_code==='PERMISSION_DENIED'));
  }
  assert.equal(read.publication(row('IN_REVIEW'),ctx({userId:'maker'})).actions.approve.reason_code,'MAKER_CHECKER');
  assert.equal(read.publication(row('IN_REVIEW'),ctx()).actions.approve.available,true);
});
test('withdrawal from pending draft, archive after withdrawal and reconfirm have distinct rules',()=>{
  assert.equal(read.publication(row('DRAFT'),ctx()).actions.unpublish.available,true);
  assert.equal(read.publication(row('UNPUBLISHED'),ctx()).actions.archive.available,true);
  assert.equal(read.publication(row('UNPUBLISHED'),ctx()).actions.reconfirm.available,false);
  assert.equal(read.publication(row('PUBLISHED'),ctx()).actions.archive.available,false);
  assert.equal(read.publication(row('REVISION_REQUIRED'),ctx()).actions.submit.available,false);
  assert.equal(read.publication(row('APPROVED'),ctx()).actions.edit_draft.available,true);
});
test('central authority is a request path, not local approval or an invented feature flag',()=>{
  const c=ctx();c.settings.review_authority='central';
  const result=read.publication(row('PUBLISHED'),c);
  assert.equal(result.actions.archive.mode,'REQUEST_CONTROL');assert.equal(result.actions.archive.available,true);
  assert.equal(result.actions.approve.reason_code,'AUTHORITY_MISMATCH');
  c.centralReady=false;assert.equal(read.publication(row('DRAFT'),c).actions.submit.reason_code,'CENTRAL_NOT_READY');
  assert.ok(Object.values(read.publication(row(),ctx({settings:null})).actions).filter(a=>a!==undefined).some(a=>a.reason_code==='SETUP_REQUIRED'));
});
test('contact revoke fails closed on reference uncertainty without revealing other divisions',()=>{
  const c={id:'p',lock_version:0,state:'VERIFIED',revoked_at:null,versions:[{state:'VERIFIED'}]};
  assert.equal(read.contact(c,ctx()).actions.revoke.available,true);
  assert.equal(read.contact(c,ctx({refs:new Map()})).actions.revoke.reason_code,'CONTACT_USAGE_UNKNOWN');
  assert.equal(read.contact(c,ctx({refs:new Map([['p',true]])})).actions.revoke.reason_code,'CONTACT_IN_USE');
  assert.equal(read.contact({...c,revoked_at:new Date()},ctx()).actions.edit_draft.reason_code,'REVOKED');
});
test('profile requires real ready logo for submit and forbids maker approval',()=>{
  const p={id:'p',lock_version:0,state:'DRAFT',versions:[{state:'DRAFT',created_by:'maker'}]};
  assert.equal(read.profile(p,ctx()).actions.submit.reason_code,'LOGO_NOT_READY');
  p.logo_media={state:'READY',central_media_id:'logo'};assert.equal(read.profile(p,ctx()).actions.submit.available,true);
  p.versions[0].state='IN_REVIEW';assert.equal(read.profile(p,ctx({userId:'maker'})).actions.verify.reason_code,'MAKER_CHECKER');
});
test('resubmission is assessed against the request version, submitter, permission and central readiness',()=>{
  const request={id:'p',request_version:4,state:'REVISION_REQUIRED',submitted_by:'maker'};
  const c=ctx({userId:'maker'});c.settings.review_authority='central';
  assert.equal(read.changeRequest(request,c).expected_version,4);
  assert.equal(read.changeRequest(request,c).actions.resubmit.available,true);
  assert.equal(read.changeRequest(request,{...c,userId:'other'}).actions.resubmit.reason_code,'SUBMITTER_REQUIRED');
  assert.equal(read.changeRequest(request,{...c,can:()=>false}).actions.resubmit.reason_code,'PERMISSION_DENIED');
  assert.equal(read.changeRequest(request,{...c,centralReady:false}).actions.resubmit.reason_code,'CENTRAL_NOT_READY');
  assert.equal(read.changeRequest({...request,state:'COMPLETED'},c).actions.resubmit.reason_code,'REVISION_REQUIRED');
});

test('media removal is only a central request and retry follows actual delivery state/permission',()=>{
  const m={id:'p',state:'READY',revoked_at:null},c=ctx();
  assert.equal(read.media(m,c).actions.request_revoke.reason_code,'AUTHORITY_MISMATCH');
  c.settings.review_authority='central';
  assert.equal(read.media(m,c).actions.request_revoke.mode,'REQUEST_CONTROL');
  assert.equal(read.media(m,c).actions.request_revoke.available,true);
  assert.equal(read.media({...m,state:'REVOKED'},c).actions.request_revoke.reason_code,'REVOKED');
  assert.equal(read.media(m,{...c,scopes:new Map()}).actions.request_revoke.available,false);
  assert.equal(read.syncEvent({id:'p',state:'ACKNOWLEDGED'},c).actions.retry.available,false);
  assert.equal(read.syncEvent({id:'p',state:'FAILED'},c).actions.retry.reason_code,'OUTBOX_TARGET_UNBOUND');
  withBoundDelivery(false,(event,context)=>assert.equal(read.syncEvent(event,context).actions.retry.available,true));
  assert.equal(read.syncEvent({id:'p',state:'QUARANTINED'},{...c,can:()=>false}).actions.retry.reason_code,'PERMISSION_DENIED');
});

test('retry exposes a safe explanation for an old installation without revealing its identity',()=>{
  const event={id:'p',state:'FAILED',event_type:'CONTROL_REVIEW_SNAPSHOT',payload_json:{instance_id:'old-private-id'}};
  const context=ctx({settings:{installation_id:'active-private-id'}});
  const action=read.syncEvent(event,context).actions.retry;
  assert.equal(action.available,false);
  assert.equal(action.reason_code,'CONTROL_SNAPSHOT_INSTANCE_MISMATCH');
  assert.ok(!JSON.stringify(action).includes('private-id'));
  assert.equal(read.syncEvent(event,{...context,can:()=>false}).actions.retry.reason_code,'PERMISSION_DENIED');
  assert.equal(read.syncEvent({...event,payload_json:{instance_id:'active-private-id'}},context).actions.retry.reason_code,'OUTBOX_TARGET_UNBOUND');
  withBoundDelivery(true,(bound,matching)=>assert.equal(read.syncEvent(bound,matching).actions.retry.available,true));
});
