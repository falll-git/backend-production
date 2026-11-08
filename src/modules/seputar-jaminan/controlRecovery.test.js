const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const contract=require('./controlRecovery.contract'),{captureTarget}=require('./outboxTarget');
const review=require('./controlReview.contract');
const id=()=>crypto.randomUUID();
const base=()=>({contract_version:1,instance_id:id(),operator_id:id(),audience:'test-bank'});
function fixture() {
  const pair=crypto.generateKeyPairSync('ed25519');
  const env={SJ_INTEGRATION_PRIVATE_KEY:pair.privateKey.export({type:'pkcs8',format:'pem'})};
  const settings={institution_id:id(),installation_id:id(),central_base_url:'https://sj.example.test',key_id:id(),sync_enabled:true};
  const row={id:id(),event_id:id(),aggregate_type:'BPRS_PROFILE',aggregate_id:settings.institution_id,aggregate_version:1,
    event_type:'UPSERT_BPRS_PROFILE',payload_json:{institution_id:settings.institution_id},state:'FAILED',attempt_count:3,
    available_at:new Date(),created_at:new Date(),locked_at:null,locked_by:null,last_error_code:'TEST_FAILURE',acknowledged_at:null};
  row.target_binding_json=captureTarget(row.event_type,settings,env);
  return {row,settings,env};
}
test('strict operation schemas reject extra fields, coercion and false action capability',()=>{
  const requests=[{...base(),operation:'list',cursor:null,state:null},{...base(),operation:'detail',job_id:id()},
    {...base(),operation:'receipt',request_id:id(),request_digest:'a'.repeat(64)},
    {...base(),operation:'retry',job_id:id(),request_id:id(),expected_revision:'a'.repeat(64),reason:'Periksa koneksi ulang'}];
  for(const request of requests){
    assert.equal(contract.validateRequest(request),true);
    for(const invalid of [{...request,admin:true},{...request,instance_id:[request.instance_id]},
      {...request,operator_id:null},{...request,operation:'approve'}])assert.equal(contract.validateRequest(invalid),false);
  }
  assert.equal(contract.validateRequest({...requests[0],cursor:'broken'}),false);
  assert.equal(contract.validateRequest({...requests[3],reason:' '}),false);
});
test('retry metadata preserves zero and is a strict allowlist without payload, key or error text',()=>{
  const {row,settings,env}=fixture();row.attempt_count=0;
  const data=contract.metadata(row,settings,env);
  assert.equal(data.attempt_count,0);assert.equal(data.retry.allowed,true);
  for(const key of ['payload_json','target_binding_json','last_error_code','locked_by'])assert.equal(Object.hasOwn(data,key),false);
  assert.equal(JSON.stringify(data).includes('PRIVATE KEY'),false);
});
test('retry rejects changed destination, legacy ownership, disabled delivery and active lease',()=>{
  const {row,settings,env}=fixture();
  assert.equal(contract.retryBlock(row,settings,env),null);
  assert.equal(contract.retryBlock({...row,target_binding_json:null},settings,env),'OUTBOX_TARGET_UNBOUND');
  assert.equal(contract.retryBlock(row,{...settings,installation_id:id()},env),'OUTBOX_TARGET_CHANGED');
  assert.equal(contract.retryBlock(row,{...settings,sync_enabled:false},env),'DELIVERY_DISABLED');
  assert.equal(contract.retryBlock({...row,locked_by:'worker'},settings,env),'JOB_OWNED');
  for(const state of ['QUEUED','SENDING','ACKNOWLEDGED'])assert.equal(contract.retryBlock({...row,state},settings,env),'JOB_NOT_RETRYABLE');
});
test('revision changes for state, attempt, lease, schedule, acknowledgment and destination',()=>{
  const {row}=fixture(),current=contract.revision(row);
  for(const patch of [{state:'QUEUED'},{attempt_count:4},{locked_at:new Date()},{locked_by:'w'},
    {available_at:new Date(row.available_at.getTime()+1)},{acknowledged_at:new Date()},
    {target_binding_json:{...row.target_binding_json,installation_id:id()}}])assert.notEqual(contract.revision({...row,...patch}),current);
});
test('recovery signed body is bound to operation, actor, job and path',()=>{
  const keys=crypto.generateKeyPairSync('ed25519'),request={...base(),operation:'retry',job_id:id(),request_id:id(),expected_revision:'b'.repeat(64),reason:'Koneksi sudah diperiksa'};
  const message=body=>review.signingMessage({method:'POST',path:contract.PATH,timestamp:new Date(0).toISOString(),nonce:'test-nonce',contentSha256:review.payloadDigest(body)});
  const signature=review.signTransport(message(request),keys.privateKey);
  assert.equal(review.verifyTransport(message(request),signature,keys.publicKey),true);
  for(const patch of [{operator_id:id()},{job_id:id()},{request_id:id()},{operation:'detail'}])assert.equal(review.verifyTransport(message({...request,...patch}),signature,keys.publicKey),false);
});
