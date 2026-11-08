const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {captureTarget,outboxTargetBlock} = require('./outboxTarget');
function fixture(control=false) {
  const keys=crypto.generateKeyPairSync('ed25519');
  const privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'});
  const settings={institution_id:crypto.randomUUID(),installation_id:crypto.randomUUID(),central_base_url:'https://sj.example.test',key_id:'sj-key'};
  const env={SJ_INTEGRATION_PRIVATE_KEY:privateKey,SJ_CONTROL_BASE_URL:'https://control.example.test',
    SJ_CONTROL_ACK_PRIVATE_KEY:privateKey,SJ_CONTROL_ACK_KEY_ID:'bank-ack',SJ_CONTROL_KEY_ID:'control-key',
    SJ_CONTROL_PUBLIC_KEY:keys.publicKey.export({type:'spki',format:'pem'})};
  const row={event_type:control?'CONTROL_REVIEW_SNAPSHOT':'UPSERT_BPRS_PROFILE',
    payload_json:control?{instance_id:settings.installation_id}:{institution_id:settings.institution_id}};
  row.target_binding_json=captureTarget(row.event_type,settings,env);
  return {settings,env,row};
}
test('new targets bind institution, installation, destination and keys without storing secrets',()=>{
  for(const control of [false,true]) {
    const {settings,env,row}=fixture(control);
    assert.equal(outboxTargetBlock(row,settings,env),null);
    assert.equal(JSON.stringify(row.target_binding_json).includes('KEY-----'),false);
    assert.equal(row.target_binding_json.signing_key_fingerprint.length,64);
    assert.equal(outboxTargetBlock(row,{...settings,central_base_url:settings.central_base_url+'/'},env),null);
  }
});
test('legacy jobs fail closed; current configuration cannot manufacture their origin',()=>{
  for(const control of [false,true]) {
    const {settings,env,row}=fixture(control);delete row.target_binding_json;
    assert.equal(outboxTargetBlock(row,settings,env).code,'OUTBOX_TARGET_UNBOUND');
  }
});
test('changed institution, installation, origin or signing key blocks retry',()=>{
  const {settings,env,row}=fixture();
  for(const patch of [{institution_id:crypto.randomUUID()},{installation_id:crypto.randomUUID()},
    {central_base_url:'https://another.example.test'},{key_id:'rotated-key'}]) {
    assert.equal(outboxTargetBlock(row,{...settings,...patch},env).code,'OUTBOX_TARGET_CHANGED');
  }
  const rotated=fixture().env;
  assert.equal(outboxTargetBlock(row,settings,rotated).code,'OUTBOX_TARGET_CHANGED');
  assert.equal(outboxTargetBlock({...row,payload_json:{institution_id:crypto.randomUUID()}},settings,env).code,'OUTBOX_INSTITUTION_MISMATCH');
});
test('Control URL and response verification key are part of the immutable binding',()=>{
  const {settings,env,row}=fixture(true);
  for(const patch of [{SJ_CONTROL_BASE_URL:'https://other.example.test'},{SJ_CONTROL_KEY_ID:'changed'},
    {SJ_CONTROL_PUBLIC_KEY:fixture(true).env.SJ_CONTROL_PUBLIC_KEY}]) {
    assert.equal(outboxTargetBlock(row,settings,{...env,...patch}).code,'OUTBOX_TARGET_CHANGED');
  }
});
test('invalid config blocks delivery and cannot leak malformed key text',()=>{
  const {settings,env,row}=fixture();
  for(const patch of [{SJ_INTEGRATION_PRIVATE_KEY:''},{SJ_INTEGRATION_PRIVATE_KEY:'not a key'}]) {
    assert.equal(outboxTargetBlock(row,settings,{...env,...patch}).code,'OUTBOX_TARGET_CONFIG_INVALID');
  }
  for(const central_base_url of ['https://user:password@sj.example.test','https://sj.example.test/?a=b','file:///tmp']) {
    assert.throws(()=>captureTarget(row.event_type,{...settings,central_base_url},env));
  }
});
