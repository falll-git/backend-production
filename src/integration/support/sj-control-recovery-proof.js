// Run only inside the already-proved owned cross-app harness. Positive delivery
// transitions use the real worker and signed route, never status-changing SQL.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),request=require('supertest');
module.exports=async function recoveryProof({server,worker,reviewer,central,keys,aggregateId}) {
  const c=require('../../modules/seputar-jaminan/controlReview.contract');
  const {PATH}=require('../../modules/seputar-jaminan/controlRecovery.contract');
  const operatorId=crypto.randomUUID();
  const common={contract_version:1,instance_id:central.instanceId,audience:'ruwang-bank:isolated',operator_id:operatorId};
  const call=async(body,expected=200,signingKey=keys.controlPrivateKey)=>{
    const timestamp=new Date().toISOString(),nonce=crypto.randomUUID(),digest=c.payloadDigest(body);
    const headers={ [c.headerNames.instanceId]:body.instance_id,[c.headerNames.keyId]:'test-control',
      [c.headerNames.timestamp]:timestamp,[c.headerNames.nonce]:nonce,[c.headerNames.contentSha256]:digest,
      [c.headerNames.signature]:c.signTransport(c.signingMessage({method:'POST',path:PATH,timestamp,nonce,contentSha256:digest}),signingKey)};
    const response=await request(server).post(PATH).set(headers).send(body);
    assert.equal(response.status,expected,JSON.stringify({status:response.status,message:response.body.message}));
    if(expected!==200)return null;
    assert.equal(response.body.request_nonce,nonce);assert.equal(response.body.request_digest,digest);
    assert.equal(response.body.instance_id,central.instanceId);assert.equal(response.body.operator_id,body.operator_id);
    const h=response.headers;
    assert.equal(c.verifyTransport(c.signingMessage({method:'POST',path:PATH,
      timestamp:h['x-rc-ack-timestamp'],nonce:h['x-rc-ack-nonce'],contentSha256:c.payloadDigest(response.body)}),
      h['x-rc-ack-signature'],keys.bankPublicKey),true);
    return response.body.value;
  };
  const wrong=crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'});
  // Fault is at worker configuration boundary; immutable target rejects delivery.
  await worker({SJ_INTEGRATION_PRIVATE_KEY:wrong});
  const event=await reviewer.sj_sync_outbox.findFirst({where:{aggregate_id:aggregateId,event_type:'UPSERT_WHATSAPP_CONTACT'}});
  assert.equal(event.state,'QUARANTINED');assert.equal(event.attempt_count,1);
  const beforeEnv=process.env.SJ_CONTROL_RECOVERY_ENABLED;
  try {
    delete process.env.SJ_CONTROL_RECOVERY_ENABLED;
    const detail={...common,operation:'detail',job_id:event.id};
    await call(detail,503);process.env.SJ_CONTROL_RECOVERY_ENABLED='true';
    assert.equal((await request(server).post(PATH).send(detail)).status,401);
    await call(detail,401,wrong);await call({...detail,instance_id:crypto.randomUUID()},401);
    await call({...detail,admin:true},422);await call({...detail,job_id:crypto.randomUUID()},404);
    const loaded=await call(detail);assert.equal(loaded.item.retry.allowed,true);
    const list=await call({...common,operation:'list',cursor:null,state:'QUARANTINED'});
    assert.equal(list.total,null);assert.equal(list.scope,'BOUND_INSTALLATION');assert.ok(list.items.some(x=>x.id===event.id));
    assert.equal(JSON.stringify(list).includes('payload_json'),false);
    const retry={...common,operation:'retry',job_id:event.id,request_id:crypto.randomUUID(),
      expected_revision:loaded.item.revision,reason:'Kunci tujuan sudah dipulihkan pada tes terisolasi'};
    await call({...retry,expected_revision:'0'.repeat(64)},409);
    const keyBefore=process.env.SJ_INTEGRATION_PRIVATE_KEY;
    try {process.env.SJ_INTEGRATION_PRIVATE_KEY=wrong;await call(retry,409);}finally{process.env.SJ_INTEGRATION_PRIVATE_KEY=keyBefore;}
    const lookup={...common,operation:'receipt',request_id:retry.request_id,request_digest:c.payloadDigest(retry)};
    assert.equal((await call(lookup)).state,'NOT_RECORDED');
    const results=await Promise.all([call(retry),call(retry)]);
    assert.deepEqual(results[0],results[1]);assert.equal(results[0].result.state,'SCHEDULED');
    assert.deepEqual(await call(lookup),results[0]);
    await call({...retry,reason:'Alasan berbeda untuk ID yang sama'},409);
    await call({...retry,request_id:crypto.randomUUID()},409);
    await call({...lookup,request_digest:'0'.repeat(64)},409);
    assert.equal((await call({...lookup,operator_id:crypto.randomUUID()})).state,'NOT_RECORDED');
    assert.equal((await reviewer.$queryRaw`SELECT count(*)::integer n FROM sj_control_recovery_receipts WHERE request_id=${retry.request_id}::uuid`)[0].n,1);
    const queued=await reviewer.sj_sync_outbox.findUnique({where:{id:event.id}});
    assert.equal(queued.state,'QUEUED');assert.equal(queued.attempt_count,1);
    assert.deepEqual(queued.payload_json,event.payload_json);assert.equal(queued.payload_checksum,event.payload_checksum);
    await worker();
    const delivered=await reviewer.sj_sync_outbox.findUnique({where:{id:event.id}});
    assert.equal(delivered.state,'ACKNOWLEDGED');assert.equal(delivered.attempt_count,2);
    // A historical receipt is not a fresh retry and cannot requeue a completed job.
    assert.deepEqual(await call(retry),results[0]);
    assert.equal((await reviewer.sj_sync_outbox.findUnique({where:{id:event.id}})).state,'ACKNOWLEDGED');
    const [permissions]=await reviewer.$queryRaw`SELECT
      has_column_privilege('sj_sync_outbox','payload_json','UPDATE') can_edit_payload,
      has_column_privilege('sj_sync_outbox','acknowledged_at','UPDATE') can_fake_ack,
      has_table_privilege('sj_control_recovery_receipts','UPDATE') can_edit_receipt,
      has_table_privilege('sj_control_recovery_receipts','DELETE') can_delete_receipt`;
    assert.deepEqual(permissions,{can_edit_payload:false,can_fake_ack:false,can_edit_receipt:false,can_delete_receipt:false});
    return {check:'bank delivery recovery: signed scoped API; real worker target fault/retry; concurrent receipts and lost response; stale/config/actor negatives; no payload or ACK grant',pass:true};
  } finally {if(beforeEnv===undefined)delete process.env.SJ_CONTROL_RECOVERY_ENABLED;else process.env.SJ_CONTROL_RECOVERY_ENABLED=beforeEnv;}
};
