const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const express=require('express');
const request=require('supertest');
exports.run=async({proof,token,actors,prisma,checks,created,peer,instanceId,call,publication,cycle,double})=>{
  await require('./sj-disposable-guard').assertLive(proof,process.env,token);
  const {buildSnapshot}=require('../../modules/seputar-jaminan/controlReviewSnapshot.service');
  const snapshot=id=>call(actors.maker,()=>buildSnapshot(prisma,{installation_id:instanceId},'publication',id));
  const add=check=>checks.push({check,pass:true,url:peer.origin});
  const pending=await snapshot(created[2]);
  const invalid=peer.command(pending);
  await peer.send(invalid,{headers:{},expected:401});
  await peer.send({...invalid,expires_at:'2000-01-01T00:00:00.000Z'},{expected:401});
  const wrongChecksum=await peer.send({...invalid,command_id:crypto.randomUUID(),expected_checksum:'0'.repeat(64)});
  assert.equal(wrongChecksum.ack.result_code,'CHECKSUM_CONFLICT');
  const wrongContributors=await peer.send({...invalid,command_id:crypto.randomUUID(),contributor_subjects:['ruwang-bank:'+crypto.randomUUID()]});
  assert.equal(wrongContributors.ack.result_code,'CONTRIBUTOR_MISMATCH');
  const wrongVersion=await peer.send({...invalid,command_id:crypto.randomUUID(),expected_version:pending.source_version-1});
  assert.equal(wrongVersion.ack.result_code,'VERSION_CONFLICT');
  add('signed receiver rejects missing signature, expired command, checksum/contributor/stale version');

  const command=peer.command(pending);
  const pair=await Promise.all([peer.send(command),peer.send(command)]);
  assert.equal(pair[0].ack.status,'APPLIED');assert.deepEqual(pair[0].ack,pair[1].ack);
  await peer.send(command,{headers:pair[0].headers,expected:409});
  await peer.send({...command,expected_checksum:'f'.repeat(64)},{expected:409});
  const persisted=await call(actors.maker,()=>publication.getPublication(created[2]));
  if(persisted.aggregate_version!==1)throw Error(`CENTRAL_AGGREGATE_VERSION_${persisted.aggregate_version}`);
  const events=await call(actors.maker,()=>prisma.sj_sync_outbox.count({where:{event_type:'UPSERT_PUBLICATION_SNAPSHOT',aggregate_id:created[2]}}));
  assert.equal(events,1,'concurrent retry creates exactly one publication event');
  add('same signed command concurrent retry returns same ACK; nonce replay/conflicting envelope denied; exactly one outbox');

  const pending2=await snapshot(created[3]);
  const votes=await Promise.all([peer.send(peer.command(pending2)),peer.send(peer.command(pending2,'request_revision'))]);
  assert.deepEqual(votes.map(v=>v.ack.status).sort(),['APPLIED','REJECTED']);
  assert.equal(votes.find(v=>v.ack.status==='REJECTED').ack.result_code,'VERSION_CONFLICT');
  add('different central decisions on same version have one winner');

  const revision=await call(actors.maker,()=>publication.getPublication(created[1]));
  const firstSnapshot=await call(actors.maker,()=>prisma.sj_sync_outbox.findFirst({where:{event_type:'CONTROL_REVIEW_SNAPSHOT',aggregate_id:revision.current_version.id}}));
  const old=peer.command(firstSnapshot.payload_json);
  let next=await call(actors.maker,()=>publication.updatePublicationDraft(revision.id,{expected_version:revision.lock_version,title:'Revisi untuk pemeriksaan pusat'},actors.maker));
  next=await call(actors.maker,()=>publication.submitPublication(next.id,{expected_version:next.lock_version},actors.maker));
  const stale=await peer.send(old);assert.equal(stale.ack.result_code,'VERSION_CONFLICT');
  const actual=await snapshot(next.id);const result=await peer.send(peer.command(actual));assert.equal(result.ack.status,'APPLIED');
  add('revised submission replaces old version; signed old decision cannot overwrite it');

  process.env.JWT_SECRET=crypto.randomBytes(48).toString('hex');process.env.JWT_EXPIRES_IN='30m';
  const jwt=require('../../utils/jwt');
  const app=express();app.use(express.json());app.use('/sj',require('../../modules/seputar-jaminan/seputarJaminan.route'));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try{
    const auth=a=>'Bearer '+jwt.generateAccessToken({id:a.id,session_id:a.session_id});
    const saveId=crypto.randomUUID();
    const saveBody={intent:'SAVE_AND_SUBMIT',draft:{label:'Kontak gabungan pusat',phone_e164:'+6281234567892'}};
    const saves=await Promise.all([0,1].map(()=>request(server).post('/sj/contacts/save-operations/'+saveId).set('Authorization',auth(actors.maker)).send(saveBody)));
    assert.deepEqual(saves.map(r=>r.status),[200,200]);
    assert.deepEqual(saves[0].body.data,saves[1].body.data);
    assert.equal(saves[0].body.data.state,'IN_REVIEW');
    const savedContact=await request(server).get('/sj/contacts/'+saves[0].body.data.resource_id).set('Authorization',auth(actors.maker));
    assert.equal(savedContact.status,200);
    assert.equal((await request(server).post('/sj/contacts/'+savedContact.body.data.id+'/verify').set('Authorization',auth(actors.checker)).send({expected_version:savedContact.body.data.lock_version})).status,409);
    assert.equal(await call(actors.maker,()=>prisma.sj_sync_outbox.count({where:{event_type:'CONTROL_REVIEW_SNAPSHOT',aggregate_id:savedContact.body.data.pending_version.id}})),1);
    add('UX08 central atomic save+submit duplicate creates one review snapshot; local approval remains blocked');
    for(const endpoint of [`/publications/${created[0]}/approve-and-publish`,'/profile/verify']){
      const res=await request(server).post('/sj'+endpoint).set('Authorization',auth(actors.checker)).send({expected_version:0});
      assert.equal(res.status,409);assert.match(res.body.message,/Control/);
    }
    const list=await request(server).get('/sj/submissions?limit=100').set('Authorization',auth(actors.maker));
    assert.equal(list.status,200,'submission list must not read private ledger directly');
    assert.ok(list.body.data.items.some(i=>i.resource_id===next.id&&i.bank_application_state==='APPLIED_BY_BANK'));
    assert.ok(list.body.data.items.every(i=>i.public_state!=='PUBLIC_CONFIRMED'));
    assert.ok(list.body.data.items.every(i=>i.request_kind==='CREATE'),'initial approvals and their revisions retain CREATE history');
    assert.ok(!JSON.stringify(list.body).includes('request_payload'));
    const outcome=(actor,checksum)=>call(actor,()=>prisma.$queryRaw`SELECT status FROM public.ruwang_arsip_sj_review_outcome('publication'::text,${actual.resource.id}::text,${actual.source_version}::integer,${checksum}::text)`);
    assert.equal((await outcome(actors.maker,actual.payload_checksum))[0].status,'APPLIED');
    assert.equal((await outcome(actors.maker,'f'.repeat(64))).length,0);
    assert.equal((await outcome(actors.outsider,actual.payload_checksum)).length,0);
    assert.equal((await outcome(actors.denied,actual.payload_checksum)).length,0);
    await assert.rejects(call(actors.maker,()=>prisma.sj_control_review_commands.count()));
    await assert.rejects(call(actors.denied,()=>prisma.sj_control_review_commands.count()));
    assert.equal((await request(server).get('/sj/submissions').set('Authorization',auth(actors.denied))).status,403);
    add('central authority blocks local decisions; submission projection readable without exposing ledger or false public ACK');

    let target=await call(actors.maker,()=>publication.getPublication(created[0]));
    const bankApproved=structuredClone(target.published_version);
    const draftResponse=await request(server).patch('/sj/publications/'+target.id+'/draft').set('Authorization',auth(actors.maker)).send({expected_version:target.lock_version,title:'Draf tersimpan selama penarikan pusat'});
    assert.equal(draftResponse.status,200);
    target=draftResponse.body.data;
    const pendingDraft=structuredClone(target.current_version);
    assert.notEqual(pendingDraft.id,bankApproved.id);
    assert.equal(target.workflow_eligibility.withdrawal.eligible,true);
    const body={action:'UNPUBLISH_PUBLICATION',expected_version:target.lock_version,reason:'Pengujian permintaan perubahan melalui API resmi.'};
    const endpoint='/sj/publications/'+target.id+'/change-requests';
    assert.equal((await request(server).post(endpoint).set('Authorization',auth(actors.denied)).send(body)).status,403);
    const attempts=await Promise.all([0,1].map(()=>request(server).post(endpoint).set('Authorization',auth(actors.maker)).send(body)));
    assert.deepEqual(attempts.map(r=>r.status).sort(),[201,409]);
    const change=attempts.find(r=>r.status===201).body.data;
    const changeSnapshot=()=>call(actors.maker,()=>buildSnapshot(prisma,{installation_id:instanceId},'change_request',change.id));
    const first=await changeSnapshot();
    assert.equal((await peer.send(peer.command(first,'request_revision'))).ack.status,'APPLIED');
    const readChange=async actor=>{
      const result=await request(server).get('/sj/change-requests?paged=true&limit=100').set('Authorization',auth(actor));
      assert.equal(result.status,200);
      const row=result.body.data.items.find(item=>item.id===change.id);assert.ok(row);return row;
    };
    const makerRead=await readChange(actors.maker);
    assert.equal(makerRead.action_availability.expected_version,change.request_version);
    assert.equal(makerRead.action_availability.actions.resubmit.available,true);
    const checkerRead=await readChange(actors.checker);
    assert.equal(checkerRead.action_availability.actions.resubmit.available,false);
    assert.equal(checkerRead.action_availability.actions.resubmit.reason_code,'SUBMITTER_REQUIRED');
    const resubmit='/sj/change-requests/'+change.id+'/resubmit';
    const revisionBody={expected_version:change.request_version,reason:'Alasan perubahan sudah diperbaiki oleh pengaju.'};
    assert.equal((await request(server).post(resubmit).set('Authorization',auth(actors.checker)).send(revisionBody)).status,403);
    const retries=await Promise.all([0,1].map(()=>request(server).post(resubmit).set('Authorization',auth(actors.maker)).send(revisionBody)));
    assert.deepEqual(retries.map(r=>r.status).sort(),[200,409]);
    assert.equal((await readChange(actors.maker)).action_availability.actions.resubmit.available,false);
    const oldDecision={...peer.command(first),reason:'Keputusan untuk versi lama tidak boleh diterapkan.'};
    assert.equal((await peer.send(oldDecision)).ack.result_code,'VERSION_CONFLICT');
    const current=await changeSnapshot();
    const applied=await peer.send({...peer.command(current),reason:'Permintaan penarikan sudah diperiksa.'});
    assert.equal(applied.ack.status,'APPLIED');
    const withdrawn=await call(actors.maker,()=>publication.getPublication(target.id));
    assert.equal(withdrawn.state,'UNPUBLISHED');
    assert.deepEqual(JSON.parse(JSON.stringify(withdrawn.current_version)),pendingDraft);
    assert.deepEqual(withdrawn.published_version,bankApproved);
    assert.equal(await call(actors.maker,()=>prisma.sj_sync_outbox.count({where:{event_type:'UNPUBLISH_PUBLICATION',aggregate_id:target.id}})),1);
    add('change request API duplicate/resubmit race, submitter authority, stale central decision and single withdrawal effect preserving pending/approved content');

    await cycle();
    const contacts=require('../../modules/seputar-jaminan/profileContact.service');
    let pendingContact=await call(actors.maker,()=>contacts.createContact({label:'Isolated identity recovery',phone_e164:'+6281234567891'},actors.maker));
    pendingContact=await call(actors.maker,()=>contacts.submitContact(pendingContact.id,{expected_version:pendingContact.lock_version},actors.maker));
    const event=await call(actors.maker,()=>prisma.sj_sync_outbox.findFirst({where:{event_type:'CONTROL_REVIEW_SNAPSHOT',aggregate_id:pendingContact.pending_version.id}}));
    assert.ok(event);
    const settings=await call(actors.maker,()=>prisma.sj_integration_settings.findFirst());
    const wrongInstance=crypto.randomUUID();
    // Explicit infrastructure-identity fault in the proven disposable DB only.
    // No business/outbox status is written; real worker records the rejection.
    await require('./sj-disposable-guard').assertLive(proof,process.env,token);
    try {
      await call(actors.maker,()=>prisma.sj_integration_settings.update({where:{id:settings.id},data:{installation_id:wrongInstance}}));
      const beforeRequests=double.counters.snapshots;
      await cycle();
      assert.equal(double.counters.snapshots,beforeRequests,'foreign snapshot must not reach transport');
      const failed=await call(actors.maker,()=>prisma.sj_sync_outbox.findUnique({where:{id:event.id}}));
      // Existing failOutbox contract: permanent errors are quarantined on the
      // first attempt; FAILED is reserved for exhausted attempts. Neither ACKs.
      assert.equal(failed.state,'QUARANTINED');
      assert.equal(failed.last_error_code,'CONTROL_SNAPSHOT_INSTANCE_MISMATCH');
      assert.deepEqual(failed.payload_json,event.payload_json);
      const detail=await request(server).get('/sj/sync-events/'+event.id).set('Authorization',auth(actors.checker));
      assert.equal(detail.status,200);
      assert.equal(detail.body.data.action_availability.actions.retry.available,false);
      assert.equal(detail.body.data.action_availability.actions.retry.reason_code,'CONTROL_SNAPSHOT_INSTANCE_MISMATCH');
      assert.ok(!JSON.stringify(detail.body).includes(wrongInstance));
      const retry=()=>request(server).post('/sj/sync-events/'+event.id+'/retry').set('Authorization',auth(actors.checker));
      assert.equal((await retry()).status,409);
      assert.deepEqual(await call(actors.maker,()=>prisma.sj_sync_outbox.findUnique({where:{id:event.id}})),failed,'rejected retry must preserve failure and attempt history');
      assert.equal((await request(server).post('/sj/sync-events/'+event.id+'/retry').set('Authorization',auth(actors.denied))).status,403);
    } finally {
      await call(actors.maker,()=>prisma.sj_integration_settings.update({where:{id:settings.id},data:{installation_id:settings.installation_id}}));
    }
    const recovery=await request(server).post('/sj/sync-events/'+event.id+'/retry').set('Authorization',auth(actors.checker));
    assert.equal(recovery.status,200);
    await cycle();
    const recovered=await call(actors.maker,()=>prisma.sj_sync_outbox.findUnique({where:{id:event.id},include:{attempts:true}}));
    assert.equal(recovered.state,'ACKNOWLEDGED');
    assert.equal(recovered.event_id,event.event_id);
    assert.equal(recovered.payload_checksum,event.payload_checksum);
    assert.deepEqual(recovered.payload_json,event.payload_json);
    assert.ok(recovered.attempts.some(a=>a.error_code==='CONTROL_SNAPSHOT_INSTANCE_MISMATCH'));
    assert.ok(recovered.attempts.some(a=>a.result==='ACKNOWLEDGED'));
    add('foreign installation fails before network; real role retry API denies without mutation; correct identity recovery preserves event and failure history');
  }finally{await new Promise(r=>server.close(r));}
};
