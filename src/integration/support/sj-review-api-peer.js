// Contract test peer: actual signed bank receiver + DB role, NOT a real Control app.
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const express=require('express');
const request=require('supertest');
const contract=require('../../modules/seputar-jaminan/controlReview.contract');
exports.start=async({instanceId,controlKeys,bankKeys})=>{
  process.env.SJ_CONTROL_AUDIENCE='ruwang-bank:isolated';
  const route='/api/v1/internal/ruwang-control/sj-review';
  const app=express();app.use(express.json());app.use(route,require('../../modules/seputar-jaminan/controlReview.route'));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const send=async(command,{headers: supplied,expected=200}={})=>{
    const timestamp=new Date().toISOString(),nonce=crypto.randomUUID(),digest=contract.payloadDigest(command);
    const headers=supplied||{
      [contract.headerNames.instanceId]:instanceId,[contract.headerNames.keyId]:'test-control',
      [contract.headerNames.timestamp]:timestamp,[contract.headerNames.nonce]:nonce,
      [contract.headerNames.contentSha256]:digest,
      [contract.headerNames.signature]:contract.signTransport(contract.signingMessage({method:'POST',path:route+'/commands',timestamp,nonce,contentSha256:digest}),controlKeys.privateKey),
    };
    const res=await request(server).post(route+'/commands').set(headers).send(command);
    assert.equal(res.status,expected,`signed receiver returned ${res.status} expected ${expected}`);
    if(expected===200){
      assert.ok(contract.validateAcknowledgment(res.body));
      assert.equal(res.body.command_id,command.command_id);
      assert.equal(res.body.command_digest,digest);
      assert.equal(res.headers[contract.headerNames.acknowledgmentContentSha256],contract.payloadDigest(res.body));
      assert.ok(contract.verifyTransport(contract.signingMessage({method:'POST',path:route+'/commands',
        timestamp:res.headers[contract.headerNames.acknowledgmentTimestamp],nonce:res.headers[contract.headerNames.acknowledgmentNonce],
        contentSha256:contract.payloadDigest(res.body)}),res.headers[contract.headerNames.acknowledgmentSignature],bankKeys.publicKey));
    }
    return {ack:res.body,headers};
  };
  const command=(snapshot,decision='approve')=>{
    const now=new Date();return {contract_version:1,command_id:crypto.randomUUID(),instance_id:instanceId,
      actor_subject:'ruwang-control:'+crypto.randomUUID(),audience:process.env.SJ_CONTROL_AUDIENCE,
      resource:snapshot.resource,decision,contributor_subjects:snapshot.contributor_subjects,
      ...(decision==='request_revision'?{reason:'Perbaiki keterangan sesuai hasil pemeriksaan.'}:{}),
      expected_version:snapshot.source_version,expected_checksum:snapshot.payload_checksum,
      issued_at:now.toISOString(),expires_at:new Date(now.getTime()+60000).toISOString()};
  };
  return {send,command,origin:`http://127.0.0.1:${server.address().port}`,
    close:async()=>{await new Promise(r=>server.close(r));await require('../../modules/seputar-jaminan/reviewDatabase').disconnect();}};
};
