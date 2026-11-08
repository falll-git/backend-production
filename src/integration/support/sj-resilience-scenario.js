const assert=require('node:assert/strict');const path=require('node:path');const {fork}=require('node:child_process');const crypto=require('node:crypto');
exports.run=async({proof,token,actors,prisma,checks,created,call,publication,double,activeWorkers})=>{
  await require('./sj-disposable-guard').assertLive(proof,process.env,token);
  const children=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const launch=async(holdResponse=false,fastDb=false,fastHttp=false)=>{
    const env={...process.env,RUNTIME_ROLE:'seputar-jaminan-worker',SJ_OUTBOX_LEASE_MS:'1000'};delete env.SJ_REVIEW_DATABASE_URL;
    if(fastDb)Object.assign(env,{DB_QUERY_TIMEOUT_MS:'1000',DB_CONNECTION_TIMEOUT_MS:'500',DB_TRANSACTION_TIMEOUT_MS:'1500'});
    if(fastHttp)env.SJ_CENTRAL_REQUEST_TIMEOUT_MS='250';
    const child=fork(path.join(__dirname,'sj-resilience-worker.js'),[],{cwd:proof.root,env,stdio:['ignore','ignore','ignore','ipc']});
    children.push(child);activeWorkers.add(child);child.once('exit',()=>activeWorkers.delete(child));
    const pending=new Map();const events=[];child.on('message',m=>{events.push(m);if(m.requestId&&pending.has(m.requestId)){const p=pending.get(m.requestId);pending.delete(m.requestId);m.error?p.reject(Error(m.error)):p.resolve(m.result);}});
    child.on('exit',()=>{for(const p of pending.values())p.reject(Error('ISOLATED_CHILD_EXIT'));pending.clear();});
    const event=async type=>{for(let i=0;i<400;i++){const index=events.findIndex(e=>e.type===type);if(index>=0)return events.splice(index,1)[0];await sleep(25);}throw Error('TEST_CHILD_EVENT_TIMEOUT_'+type);};
    const command=(type,extra={})=>new Promise((resolve,reject)=>{const id=crypto.randomUUID();pending.set(id,{resolve,reject});child.send({type,requestId:id,...extra});});
    child.send({type:'init',proof,token,holdResponse});await event('ready');
    return {child,command,event,kill:()=>new Promise(r=>{child.once('exit',r);child.kill();})};
  };
  const read=id=>call(actors.maker,()=>prisma.sj_sync_outbox.findUnique({where:{id}}));
  let serial=0;
  const queue=async(id=created[0])=>{
    let asset=await call(actors.maker,()=>publication.getPublication(id));
    const profile=await call(actors.maker,()=>prisma.sj_public_profiles.findFirst());
    // A later test can approve a new profile version. New submissions must
    // reference that approved version through the normal draft service.
    asset=await call(actors.maker,()=>publication.updatePublicationDraft(id,{expected_version:asset.lock_version,title:'Uji ketahanan '+(++serial),profile_version_id:profile.current_version_id},actors.maker));
    asset=await call(actors.maker,()=>publication.submitPublication(id,{expected_version:asset.lock_version},actors.maker));
    await call(actors.checker,()=>publication.approveAndPublish(id,{expected_version:asset.lock_version},actors.checker));
    return call(actors.maker,()=>prisma.sj_sync_outbox.findFirst({where:{aggregate_id:id,event_type:'UPSERT_PUBLICATION_SNAPSHOT'},orderBy:{aggregate_version:'desc'}}));
  };
  const add=check=>{checks.push({check,pass:true,url:double.origin});process.send({type:'progress',checks});};
  try{
    const a=await launch(),b=await launch();
    let row=await queue();
    const claims=await Promise.all([a.command('claim'),b.command('claim')]);assert.equal(claims.flat().length,1);
    const winner=claims[0].length?a:b;
    const old=claims.flat()[0];assert.equal(old.id,row.id);
    await winner.kill();
    const c=await launch();await c.command('clock-fault',{id:row.id,field:'locked_at'});
    const [reclaimed]=await c.command('claim');assert.equal(reclaimed.id,row.id);assert.notEqual(reclaimed.locked_by,old.locked_by);
    await c.command('deliver',{row:reclaimed});assert.equal((await read(row.id)).state,'ACKNOWLEDGED');
    add('two worker processes claim one owner; crash after claim recovers with new token and one ACK');

    row=await queue();const held=await launch(true);const [pending]=await held.command('claim');
    const waitDelivery=held.command('deliver',{row:pending}).catch(()=>{});void waitDelivery;await held.event('remote-response');
    assert.ok(double.events.has(row.event_id));await held.kill();
    await c.command('clock-fault',{id:row.id,field:'locked_at'});const [again]=await c.command('claim');
    await c.command('deliver',{row:again});assert.equal((await read(row.id)).state,'ACKNOWLEDGED');
    assert.equal(double.appliedCounts.get(row.event_id),1);
    add('crash after remote apply before local commit retries identical envelope; duplicate ACK, one remote effect');

    row=await queue();const stale=await launch(true);const [staleClaim]=await stale.command('claim');
    const late=stale.command('deliver',{row:staleClaim});await stale.event('remote-response');
    await c.command('clock-fault',{id:row.id,field:'locked_at'});const [newClaim]=await c.command('claim');
    await c.command('deliver',{row:newClaim});stale.child.send({type:'release'});await late;
    await stale.command('fail',{row:staleClaim});const settled=await read(row.id);
    assert.equal(settled.state,'ACKNOWLEDGED');assert.equal(settled.attempt_count,newClaim.attempt_count);
    add('late completion/failure from expired owner cannot overwrite reclaimed successful attempt');

    row=await queue();const slow=await launch(true);const batch=slow.command('batch');await slow.event('remote-response');
    await sleep(1600);assert.equal((await c.command('claim')).length,0);
    slow.child.send({type:'release'});await batch;assert.equal((await read(row.id)).state,'ACKNOWLEDGED');
    add('lease renewal retains ownership while request is slow beyond initial lease');

    row=await queue();const committed=await launch();const [commitClaim]=await committed.command('claim');
    void committed.command('deliver',{row:commitClaim,holdAfterCommit:true}).catch(()=>{});await committed.event('local-commit');await committed.kill();
    assert.equal((await read(row.id)).state,'ACKNOWLEDGED');assert.equal((await c.command('claim')).length,0);
    add('crash after local commit does not re-enqueue acknowledged event');

    row=await queue();let draft=await call(actors.maker,()=>publication.getPublication(row.aggregate_id));
    draft=await call(actors.maker,()=>publication.updatePublicationDraft(draft.id,{expected_version:draft.lock_version,title:'Draf baru saat ACK versi lama datang'},actors.maker));
    const draftId=draft.current_version.id;await c.command('batch');draft=await call(actors.maker,()=>publication.getPublication(draft.id));
    assert.equal(draft.state,'DRAFT');assert.equal(draft.current_version.id,draftId);assert.notEqual(draft.published_version.id,draftId);
    add('ACK for approved version does not turn a newer pending draft into PUBLISHED');

    for(const mode of ['empty','wrong-event','wrong-version','unknown-status','invalid-json','permanent']){
      row=await queue();double.setIngestFault(mode);await c.command('batch');
      assert.equal((await read(row.id)).state,'QUARANTINED',mode);
      await call(actors.checker,()=>publication.retrySyncEvent(row.id));double.setIngestFault(null);await c.command('batch');
      assert.equal((await read(row.id)).state,'ACKNOWLEDGED');
    }
    add('empty/malformed/wrong identity-version-status responses cannot become success; authorized service retry preserves event');

    const network=await launch(false,false,true);
    for(const mode of ['disconnect','timeout']){
      row=await queue();double.setIngestFault(mode);await network.command('batch');assert.equal((await read(row.id)).state,'RETRYING');
      double.setIngestFault(null);await c.command('clock-fault',{id:row.id,field:'available_at'});await c.command('batch');assert.equal((await read(row.id)).state,'ACKNOWLEDGED');
    }
    add('actual socket disconnect and HTTP timeout retry without false ACK');

    row=await queue();double.setIngestFault('retryable');
    for(let n=1;n<=8;n++){await c.command('batch');const failed=await read(row.id);assert.equal(failed.attempt_count,n);assert.equal(failed.state,n===8?'FAILED':'RETRYING');if(n<8){assert.ok(new Date(failed.available_at)>new Date());await c.command('clock-fault',{id:row.id,field:'available_at'});}}
    double.setIngestFault(null);await call(actors.checker,()=>publication.retrySyncEvent(row.id));await c.command('batch');assert.equal((await read(row.id)).state,'ACKNOWLEDGED');
    add('transient errors back off, stop at eight attempts, explicit retry keeps monotonic audit attempt numbers');

    row=await queue();
    for(let n=1;n<=8;n++){
      const [abandoned]=await c.command('claim');assert.equal(abandoned.id,row.id);assert.equal(abandoned.attempt_count,n);
      await c.command('clock-fault',{id:row.id,field:'locked_at'});await c.command('recover');
    }
    assert.equal((await read(row.id)).state,'FAILED');assert.equal((await c.command('claim')).length,0);
    await call(actors.checker,()=>publication.retrySyncEvent(row.id));await c.command('batch');
    assert.equal((await read(row.id)).state,'ACKNOWLEDGED');
    add('repeated abandoned leases stop at eight attempts; only explicit retry resumes delivery');

    const media=require('../../modules/seputar-jaminan/media.service');
    const image=await require('sharp')({create:{width:40,height:40,channels:3,background:'#485978'}}).png().toBuffer();
    const logo=await call(actors.maker,()=>media.upload({file:{buffer:image,originalname:'resilience-only.png'},purpose:'BPRS_PUBLIC_MARK',user:actors.maker}));
    const mediaWorker=await launch('media');const mediaRun=mediaWorker.command('media-batch');await mediaWorker.event('remote-response');
    const uploadsBefore=double.counters.uploads;
    await c.command('media-batch');
    const reserved=await call(actors.maker,()=>prisma.sj_media_assets.findUnique({where:{id:logo.id}}));
    assert.equal(reserved.state,'UPLOAD_PENDING');assert.equal(double.counters.uploads,uploadsBefore);
    await call(actors.checker,()=>media.revoke(logo.id,{reason_code:'OWNER_REQUEST'}));
    mediaWorker.child.send({type:'release'});await mediaRun;
    const revoked=await call(actors.maker,()=>prisma.sj_media_assets.findUnique({where:{id:logo.id}}));
    assert.equal(revoked.state,'REVOKED');assert.ok(revoked.revoked_at);
    await c.command('batch');
    add('parallel media workers preserve upload reservation; late upload completion cannot revive officially revoked media');

    const other=await launch();
    row=await queue();const next=await queue();const [first]=await c.command('claim');assert.equal(first.id,row.id);assert.equal((await other.command('claim')).length,0);
    // Newer approved state cannot be marked failed by the older event.
    await c.command('fail',{row:first});assert.equal((await call(actors.maker,()=>publication.getPublication(row.aggregate_id))).sync_state,'QUEUED');
    await call(actors.checker,()=>publication.retrySyncEvent(row.id));await c.command('batch');await c.command('batch');assert.equal((await read(next.id)).state,'ACKNOWLEDGED');
    add('aggregate event order blocks later version; older failure cannot overwrite newer aggregate status');

    // Test-only infrastructure faults delegated to the parent which retains
    // exact container ownership proof. No credentials sent to this child.
    const infrastructure=(kind,action)=>new Promise((resolve,reject)=>{
      const id=crypto.randomUUID();const handler=m=>{if(m.type==='fault-done'&&m.id===id){process.off('message',handler);m.pass?resolve():reject(Error('OWNED_INFRA_FAULT_FAILED'));}};
      process.on('message',handler);process.send({type:'infrastructure-fault',id,kind,action});
    });
    row=await queue();const disconnected=await launch(true,true);const [disconnectClaim]=await disconnected.command('claim');
    const errorResult=disconnected.command('deliver',{row:disconnectClaim}).then(()=>false,()=>true);await disconnected.event('remote-response');
    await infrastructure('pg','pause');
    try{disconnected.child.send({type:'release'});await sleep(4000);}
    finally{await infrastructure('pg','unpause');}
    assert.equal(await errorResult,true,'DB outage cannot be reported as a committed ACK');
    await c.command('clock-fault',{id:row.id,field:'locked_at'});await c.command('batch');
    assert.equal((await read(row.id)).state,'ACKNOWLEDGED');assert.equal(double.appliedCounts.get(row.event_id),1);
    add('real isolated PostgreSQL outage after remote apply leaves recoverable claim; restart/retry has one remote effect');

    row=await queue();await infrastructure('redis','pause');
    try{await c.command('batch');assert.equal((await read(row.id)).state,'ACKNOWLEDGED');}
    finally{await infrastructure('redis','unpause');}
    add('Redis interruption does not corrupt database-backed outbox; this is not a Redis-queue worker');

    const profile=require('../../modules/seputar-jaminan/profileContact.service');
    let contact=await call(actors.maker,()=>profile.createContact({label:'Kontak ketahanan',phone_e164:'+6289876543210'},actors.maker));
    contact=await call(actors.maker,()=>profile.submitContact(contact.id,{expected_version:contact.lock_version},actors.maker));
    await call(actors.checker,()=>profile.verifyContact(contact.id,{expected_version:contact.lock_version},actors.checker));
    double.setIngestFault('empty');await c.command('batch');
    assert.equal((await call(actors.maker,()=>prisma.sj_whatsapp_contacts.findUnique({where:{id:contact.id}}))).sync_state,'QUARANTINED');
    let failedEvent=await call(actors.maker,()=>prisma.sj_sync_outbox.findFirst({where:{aggregate_id:contact.id,state:'QUARANTINED'}}));
    await call(actors.checker,()=>publication.retrySyncEvent(failedEvent.id));double.setIngestFault(null);await c.command('batch');
    assert.equal((await call(actors.maker,()=>prisma.sj_whatsapp_contacts.findUnique({where:{id:contact.id}}))).sync_state,'ACKNOWLEDGED');
    let p=await call(actors.maker,()=>profile.getProfile());
    p=await call(actors.maker,()=>profile.saveProfileDraft({expected_version:p.lock_version,display_name:'Profil ketahanan',public_slug:p.public_slug,city_regency:p.city_regency,province:p.province,short_description:p.short_description,logo_media_id:p.logo_media_id,website_url:p.website_url},actors.maker));
    p=await call(actors.maker,()=>profile.submitProfile({expected_version:p.lock_version},actors.maker));
    await call(actors.checker,()=>profile.verifyProfile({expected_version:p.lock_version},actors.checker));
    double.setIngestFault('empty');await c.command('batch');
    assert.equal((await call(actors.maker,()=>profile.getProfile())).sync_state,'QUARANTINED');
    failedEvent=await call(actors.maker,()=>prisma.sj_sync_outbox.findFirst({where:{aggregate_type:'BPRS_PROFILE',state:'QUARANTINED'}}));
    await call(actors.checker,()=>publication.retrySyncEvent(failedEvent.id));double.setIngestFault(null);await c.command('batch');
    assert.equal((await call(actors.maker,()=>profile.getProfile())).sync_state,'ACKNOWLEDGED');
    add('profile and contact delivery failure/authorized retry reflect actual outbox outcome for the matching version');

    row=await queue();double.setIngestFault('empty');await c.command('batch');double.setIngestFault(null);
    process.env.JWT_SECRET=crypto.randomBytes(48).toString('hex');process.env.JWT_EXPIRES_IN='30m';
    const app=require('express')();app.use(require('express').json());app.use('/sj',require('../../modules/seputar-jaminan/seputarJaminan.route'));
    const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
    try{
      const request=require('supertest'),jwt=require('../../utils/jwt');
      const retry=actor=>request(server).post('/sj/sync-events/'+row.id+'/retry').set('Authorization','Bearer '+jwt.generateAccessToken({id:actor.id,session_id:actor.session_id}));
      assert.equal((await retry(actors.denied)).status,403);assert.equal((await retry(actors.maker)).status,403);
      const concurrent=await Promise.all([retry(actors.checker),retry(actors.checker)]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
      await c.command('batch');assert.equal((await read(row.id)).state,'ACKNOWLEDGED');
      checks.push({check:'real authenticated retry API enforces feature permission and concurrent compare-and-swap',pass:true,url:'http://127.0.0.1:'+server.address().port});
    }finally{await new Promise(r=>server.close(r));}
  }finally{
    for(const child of children)if(child.exitCode===null&&child.signalCode===null){await new Promise(r=>{child.once('exit',r);child.kill();});}
  }
};
