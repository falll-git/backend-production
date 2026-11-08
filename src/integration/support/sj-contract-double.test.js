const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {startDouble,loadControlSchema}=require('./sj-contract-double');
const control=require('../../modules/seputar-jaminan/controlReview.contract');

test('contract double rejects invalid signed requests and validates peer schema',async t=>{
  const contracts=await import(pathToFileURL(path.join(__dirname,'../../../vendor/seputar-jaminan-contracts-v1/src/index.mjs')).href);
  const bank=crypto.generateKeyPairSync('ed25519'),central=crypto.generateKeyPairSync('ed25519');
  const institutionId=crypto.randomUUID(),keyId=crypto.randomUUID(),instanceId=crypto.randomUUID();
  const double=await startDouble({contracts,bankPublicKey:bank.publicKey,controlPrivateKey:central.privateKey,institutionId,keyId,instanceId,bankAckKeyId:'bank-test',controlKeyId:'control-test',capability:'unit-test'});
  t.after(()=>double.close());
  const route='/v1/media/upload-sessions';
  const request={institution_id:institutionId,publication_id:null,source_media_id:crypto.randomUUID(),sha256:'a'.repeat(64),detected_mime:'image/webp',size_bytes:100,width:20,height:20,purpose:'BPRS_PUBLIC_MARK',requested_ttl_seconds:60};
  const sign=(data=request,timestamp=new Date().toISOString())=>{
    const body=JSON.stringify(data),nonce=crypto.randomUUID(),contentSha256=contracts.createContentSha256(body);
    const signature=contracts.signIntegrationMessage(contracts.createSigningMessage({method:'POST',path:route,timestamp,nonce,contentSha256}),bank.privateKey);
    return {method:'POST',body,headers:{'content-type':'application/json','x-sj-institution-id':institutionId,'x-sj-key-id':keyId,'x-sj-nonce':nonce,'x-sj-timestamp':timestamp,'x-sj-content-sha256':contentSha256,'x-sj-signature':signature}};
  };
  for(const [name,change] of [
    ['signature',r=>r.headers['x-sj-signature']='invalid'],
    ['checksum',r=>r.headers['x-sj-content-sha256']='b'.repeat(64)],
    ['institution',r=>r.headers['x-sj-institution-id']=crypto.randomUUID()],
    ['key',r=>r.headers['x-sj-key-id']=crypto.randomUUID()],
    ['missing nonce',r=>delete r.headers['x-sj-nonce']],
  ])await t.test(name,async()=>{const r=sign();change(r);assert.equal((await fetch(double.origin+route,r)).status,400);});
  await t.test('expired signed timestamp',async()=>assert.equal((await fetch(double.origin+route,sign(request,'2000-01-01T00:00:00.000Z'))).status,400));
  await t.test('invalid payload with valid signature',async()=>assert.equal((await fetch(double.origin+route,sign({...request,internal_secret:'forbidden'}))).status,400));
  await t.test('signed request accepted once and replay rejected',async()=>{
    const r=sign();const first=await fetch(double.origin+route,r);assert.equal(first.status,201);
    assert.equal(contracts.validateSchema('https://seputarjaminan.com/contracts/v1/media-upload-session-response.schema.json',await first.json()).valid,true);
    assert.equal((await fetch(double.origin+route,r)).status,400);
  });
  await t.test('actual Control schema rejects incomplete snapshot',async()=>{
    const {schema}=await loadControlSchema();assert.equal(schema.safeParse({contract_version:1,state:'IN_REVIEW'}).success,false);
    const body=control.canonicalJson({contract_version:1,state:'IN_REVIEW',instance_id:instanceId});
    const timestamp=new Date().toISOString(),nonce=crypto.randomUUID(),contentSha256=control.payloadDigest(JSON.parse(body));
    const route='/api/internal/sj-review/snapshots',h=control.headerNames;
    const signature=control.signTransport(control.signingMessage({method:'POST',path:route,timestamp,nonce,contentSha256}),bank.privateKey);
    assert.equal((await fetch(double.origin+route,{method:'POST',body,headers:{[h.instanceId]:instanceId,[h.acknowledgmentKeyId]:'bank-test',[h.acknowledgmentTimestamp]:timestamp,[h.acknowledgmentNonce]:nonce,[h.acknowledgmentContentSha256]:contentSha256,[h.acknowledgmentSignature]:signature}})).status,400);
    assert.equal(double.counters.snapshots,0);
  });
});
