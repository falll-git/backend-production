const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {fork}=require('node:child_process');
const {assertLive,digest}=require('./sj-disposable-guard');
const {startDouble}=require('./sj-contract-double');
const activeWorkers=new Set();
let finished=false;
process.once('disconnect',()=>{if(!finished){for(const worker of activeWorkers)worker.kill();process.exit(1);}});
process.once('message',async({proof,token,actors,workflow,authPassword})=>{
  process.on('message',message=>{if(message.type==='abort-owned-scenario'&&message.runId===proof.runId&&message.tokenHash===proof.tokenHash&&process.connected)process.disconnect();});
  let double,prisma,redis,peer;const checks=[];let phase='isolation';
  // Retain safe progress even when a stalled call prevents the final IPC receipt.
  const progressTimer=setInterval(()=>{
    if(process.connected)process.send({type:'progress',checks:[...checks,{check:'active phase: '+phase,pass:false}]});
  },5000);
  progressTimer.unref();
  try {
    const contracts=await import(require('node:url').pathToFileURL(path.join(__dirname,'../../../vendor/seputar-jaminan-contracts-v1/src/index.mjs')).href);
    const keys=crypto.generateKeyPairSync('ed25519'),controlKeys=crypto.generateKeyPairSync('ed25519');
    const institutionId=crypto.randomUUID(),instanceId=crypto.randomUUID(),keyId=crypto.randomUUID();
    double=await startDouble({contracts,bankPublicKey:keys.publicKey,controlPrivateKey:controlKeys.privateKey,institutionId,keyId,instanceId,bankAckKeyId:'test-bank',controlKeyId:'test-control',capability:token,publicSlug:'test-'+proof.runId});
    proof.integrationOrigin=double.origin;
    Object.assign(process.env,{SJ_CONTROL_BASE_URL:double.origin,SJ_TEST_CENTRAL_BASE_URL:double.origin,SJ_INTEGRATION_PRIVATE_KEY:keys.privateKey.export({type:'pkcs8',format:'pem'}),SJ_CONTROL_ACK_PRIVATE_KEY:keys.privateKey.export({type:'pkcs8',format:'pem'}),SJ_CONTROL_PUBLIC_KEY:controlKeys.publicKey.export({type:'spki',format:'pem'}),SJ_CONTROL_ACK_KEY_ID:'test-bank',SJ_CONTROL_KEY_ID:'test-control',SJ_CONTROL_INSTANCE_ID:instanceId});
    const roles=await assertLive(proof,process.env,token);
    checks.push({check:'runtime app/worker roles no superuser/BYPASSRLS',pass:true,roles});
    const Redis=require('ioredis');redis=new Redis(process.env.REDIS_URL,{lazyConnect:true,maxRetriesPerRequest:0});await redis.connect();
    const rk=process.env.SJ_TEST_REDIS_PREFIX+'owner';assert.equal(await redis.set(rk,digest(token),'NX'),'OK');assert.equal(await redis.get(rk),digest(token));
    checks.push({check:'isolated Redis namespace write/read',pass:true});
    const originalFetch=global.fetch;
    global.fetch=(input,options)=>{const u=new URL(typeof input==='string'?input:input.url);if(u.origin!==proof.integrationOrigin)throw Error('TEST_EGRESS_REJECTED');return originalFetch(input,{...options,redirect:'error'});};
    const ownership=await fetch(double.origin+'/__test/ownership',{headers:{'x-test-capability':token}});assert.equal(ownership.status,200);
    prisma=require('../../config/prisma');
    if(workflow==='auth'){
      phase='bank-auth-rls';
      Object.assign(process.env,{JWT_SECRET:crypto.randomBytes(48).toString('hex'),JWT_EXPIRES_IN:'15m',JWT_REFRESH_SECRET:crypto.randomBytes(48).toString('hex'),JWT_REFRESH_EXPIRES_IN:'1d',AUTH_REFRESH_COOKIE_NAME:'sj_owned_refresh',RATE_LIMIT_STORE:'memory'});
      checks.push(await require('./sj-auth-rls-proof').run({app:require('../../app'),proof,actors,password:authPassword}));
      await redis.del(rk);await prisma.$disconnect();await redis.quit();await double.close();
      finished=true;process.send({type:'result',pass:true,checks,integrationOrigin:double.origin,fixtureSetup:'auth prerequisites only; no SJ business mutation',apiWorkflow:'auth'},()=>process.disconnect());
      return;
    }
    const {runWithDatabaseUserContext:asUser}=require('../../config/database-context');
    const publication=require('../../modules/seputar-jaminan/seputarJaminan.service');
    const profile=require('../../modules/seputar-jaminan/profileContact.service');
    const media=require('../../modules/seputar-jaminan/media.service');
    const validation=require('../../modules/seputar-jaminan/seputarJaminan.validation');
    // Prisma promises execute lazily: await inside ALS, not after leaving it.
    const call=(actor,fn)=>asUser(actor.id,async()=>await fn());
    const maker=actors.maker,checker=actors.checker;
    if(workflow==='central')peer=await require('./sj-review-api-peer').start({instanceId,controlKeys,bankKeys:keys});
    const decide=async(kind,id,decision='approve')=>{
      const snapshot=await call(maker,()=>require('../../modules/seputar-jaminan/controlReviewSnapshot.service').buildSnapshot(prisma,{installation_id:instanceId},kind,id));
      const {ack}=await peer.send(peer.command(snapshot,decision));
      if(ack.status!=='APPLIED')throw Error(`CENTRAL_${kind}_${decision}_${ack.result_code}`);
      return call(maker,()=>kind==='profile'?profile.getProfile():kind==='contact'?profile.listContacts().then(rows=>rows.find(r=>r.id===id)):publication.getPublication(id));
    };
    const validate=(schema,data)=>{const r=schema.validate(data);if(r.error)throw Error('FIXTURE_VALIDATION:'+r.error.details[0].path.join('.'));return r.value;};
    const cycle=()=>new Promise((resolve,reject)=>{
      const env={...process.env,RUNTIME_ROLE:'seputar-jaminan-worker'};
      delete env.SJ_REVIEW_DATABASE_URL;
      const child=fork(path.join(__dirname,'sj-isolated-worker.js'),[],{cwd:proof.root,env,stdio:['ignore','pipe','pipe','ipc']});let result,diagnostic='',timedOut=false;
      activeWorkers.add(child);
      const timer=setTimeout(()=>{timedOut=true;child.kill();},45000);
      child.stdout.on('data',()=>{});child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk.toString()).slice(-4000);});
      child.on('message',m=>result=m);child.on('error',()=>{clearTimeout(timer);reject(Error('WORKER_START'));});
      child.on('exit',(code,signal)=>{activeWorkers.delete(child);clearTimeout(timer);if(code===0&&result?.pass&&!timedOut)return resolve(result.result);
        let safe=diagnostic.replace(/postgres(?:ql)?:\/\/\S+/g,'[database]').replace(/-----BEGIN[\s\S]*?-----END[^\n]+/g,'[key]');
        for(const [k,v] of Object.entries(env))if(/SECRET|PASSWORD|PRIVATE_KEY/.test(k)&&v)safe=safe.replaceAll(v,'[redacted]');
        fs.writeFileSync(path.join(proof.root,'worker-error.log'),safe);
        reject(Error(timedOut?'WORKER_TIMEOUT':'WORKER_'+(result?.code||'FAILED')+'_EXIT_'+code+'_'+(signal||'')));});
      child.send({proof,token});
    });
    phase='settings';
    await call(maker,()=>publication.updateSettings(validate(validation.integrationSettingsSchema,{institution_id:institutionId,installation_id:instanceId,key_id:keyId,central_base_url:double.origin,module_visible:true,draft_enabled:true,review_enabled:true,sync_enabled:true,publish_enabled:true,filesystem_upload_enabled:true,s3_upload_enabled:false})));
    if(workflow==='upgrade'){
      phase='populated-baseline-upgrade';
      // Keep baseline numbers outside the API deep-pagination fixture range.
      for(const [label,phone_e164] of [['Baseline contact one','+6287555500001'],['Baseline contact two','+6287555500002']]){
        const draft=await call(maker,()=>profile.createContact(validate(validation.contactDraftSchema,{label,phone_e164}),maker));
        assert.equal(draft.state,'DRAFT');
      }
      assert.equal(activeWorkers.size,0);
      await new Promise((resolve,reject)=>{
        process.once('message',m=>m.type==='upgrade-done'&&m.pass?resolve():reject(Error('ADDITIVE_UPGRADE_FAILED')));
        process.send({type:'upgrade-ready'});
      });
      checks.push({check:'chronological baseline contact drafts created through official service; upgrade before current delivery uses new columns',pass:true});
    }
    phase='contact';
    let contact=await call(maker,()=>profile.createContact(validate(validation.contactDraftSchema,{label:'Kontak tes '+proof.runId.slice(0,6),phone_e164:'+6281234567890'}),maker));
    contact=await call(maker,()=>profile.submitContact(contact.id,{expected_version:contact.lock_version},maker));
    await assert.rejects(call(maker,()=>profile.verifyContact(contact.id,{expected_version:contact.lock_version},maker)));
    contact=peer?await decide('contact',contact.id):await call(checker,()=>profile.verifyContact(contact.id,{expected_version:contact.lock_version},checker));
    await cycle();
    const sharp=require('sharp');
    const image=await sharp({create:{width:480,height:320,channels:3,background:'#CBD6BF'}}).png().toBuffer();
    const upload=purpose=>call(maker,()=>media.upload({file:{buffer:image,originalname:'isolated.png'},purpose,user:maker}));
    phase='logo';const logo=await upload('BPRS_PUBLIC_MARK');await cycle();
    assert.equal((await call(maker,()=>media.getStatus(logo.id))).state,'READY');
    phase='profile';
    const combinedCreation = workflow === true || workflow === 'central';
    const profileDraft = validate(validation.profileDraftSchema,{display_name:'BPRS Tes Terisolasi',public_slug:'test-'+proof.runId,city_regency:'Bandung',province:'Jawa Barat',short_description:'Profil ini hanya digunakan dalam lingkungan tes terisolasi.',logo_media_id:logo.id,website_url:null});
    let p;
    if (combinedCreation) {
      await require('./sj-save-operation-scenario').bootstrapSave('profile',profileDraft,maker);
      p=await call(maker,()=>profile.getProfile());
    } else {
      p=await call(maker,()=>profile.saveProfileDraft(profileDraft,maker));
      p=await call(maker,()=>profile.submitProfile({expected_version:p.lock_version},maker));
    }
    p=peer?await decide('profile',p.id):await call(checker,()=>profile.verifyProfile({expected_version:p.lock_version},checker));await cycle();
    checks.push({check:'contact/profile official service submit+checker+real worker to contract double',pass:true});
    phase='taxonomy';const taxonomy=await call(maker,()=>publication.listTaxonomy());assert.equal(taxonomy.categories.length,4);
    const attributes={LAND:{land_area_m2:120},BUILDING:{land_area_m2:120,building_area_m2:80},MACHINE_EQUIPMENT:{model_or_type:'Mesin tes',public_condition:'BAIK'},VEHICLE:{brand:'Merek tes',model_or_type:'Mobil tes',public_condition:'BAIK',mileage_km:0}};
    const created=[], drafts=[];
    for(const category of taxonomy.categories) {
      phase='publication-'+category.code;
      const photo=await upload('PUBLICATION_IMAGE');
      const draft=validate(validation.createPublicationSchema,{source_type:'COLLATERAL',source_collateral_id:actors.collateralIds[category.code],asset_category:category.code,taxonomy_item_id:category.items[0].id,title:'Aset tes '+category.code,description:'Aset ini khusus untuk menguji alur resmi pada database terisolasi.',city_regency:'Bandung',province:'Jawa Barat',whatsapp_contact_version_id:contact.current_version_id,profile_version_id:p.current_version_id,attributes:attributes[category.code],media:[{media_asset_id:photo.id,sort_order:0,is_cover:true,alt_text:'Foto aset tes'}]});
      drafts.push(draft);
      let asset;
      if (combinedCreation) {
        await cycle();
        const saved=await require('./sj-save-operation-scenario').bootstrapSave('publications',draft,maker);
        assert.equal(saved.state,'DRAFT');
        await cycle();
        await require('./sj-save-operation-scenario').bootstrapSave('publications',{expected_version:saved.lock_version,title:draft.title},maker,saved.resource_id);
        asset=await call(maker,()=>publication.getPublication(saved.resource_id));
      } else {
        asset=await call(maker,()=>publication.createPublication(draft,maker));await cycle();
        asset=await call(maker,()=>publication.submitPublication(asset.id,{expected_version:asset.lock_version},maker));
      }
      assert.equal(asset.state,'IN_REVIEW');created.push(asset.id);
    }
    checks.push({check:'four categories official draft/upload/submit without SQL status changes',pass:true,count:created.length});
    if(combinedCreation)checks.push({check:'UX08 new profile atomic; four new publication categories save honest DRAFT until media ready, then same-ID submit; identical retry returns same receipt',pass:true});
    phase='negative-rls';
    assert.equal((await call(actors.denied,()=>publication.listPublications({page:1,limit:20}))).items.length,0);
    assert.equal(await prisma.sj_publications.count(),0); // No user context.
    checks.push({check:'denied user and absent tenant/user context see no publications',pass:true});
    phase='control-double';
    const {buildSnapshot}=require('../../modules/seputar-jaminan/controlReviewSnapshot.service');
    const snapshot=await call(maker,()=>buildSnapshot(prisma,{installation_id:instanceId},'publication',created[0]));
    const {deliverControlSnapshot}=require('../../modules/seputar-jaminan/syncWorker.service');
    const contract=require('../../modules/seputar-jaminan/controlReview.contract');
    await deliverControlSnapshot({aggregate_id:snapshot.snapshot_id,payload_json:snapshot,payload_checksum:contract.payloadDigest(snapshot)},{installation_id:instanceId});
    assert.ok(double.counters.snapshots>=1);checks.push({check:'real snapshot builder + signed Control ACK contract double',pass:true});
    phase='review-fixtures';
    let approved=await call(checker,()=>publication.getPublication(created[0]));
    approved=peer?await decide('publication',approved.id):await call(checker,()=>publication.approveAndPublish(approved.id,{expected_version:approved.lock_version},checker));
    assert.equal(approved.state,'APPROVED');assert.equal(approved.sync_state,'QUEUED');await cycle();
    approved=await call(maker,()=>publication.getPublication(approved.id));assert.equal(approved.sync_state,'ACKNOWLEDGED');
    assert.ok([...double.events.values()].some(e=>e.event_type==='UPSERT_PUBLICATION_SNAPSHOT'&&e.aggregate_id===approved.id));
    let revision=await call(checker,()=>publication.getPublication(created[1]));
    revision=peer?await decide('publication',revision.id,'request_revision'):await call(checker,()=>publication.requestRevision(revision.id,validate(validation.reasonCommandSchema,{expected_version:revision.lock_version,reason:'Lengkapi keterangan aset untuk pengujian revisi.'}),checker));
    assert.equal(revision.state,'REVISION_REQUIRED');
    checks.push({check:'official approval/ACK and revision fixtures; ACK is not public observation',pass:true});
    phase='fault-injection';double.failNextRequest();
    const {signedRequest}=require('../../modules/seputar-jaminan/syncWorker.service');
    await assert.rejects(signedRequest({institution_id:institutionId,key_id:keyId,central_base_url:double.origin},'GET','/v1/media/'+crypto.randomUUID()+'/status'),e=>e.retryable===true&&e.status===503);
    checks.push({check:'explicit test-only 503 fault injection',pass:true});
    if(workflow===true||workflow==='central'){
      phase='read-api-contract';
      await require('./sj-read-api-scenario').run({proof,token,actors,checks});
      phase='public-observation-boundary';
      await require('./sj-observation-boundary-scenario').run({actors,prisma,checks,call,publication,double,cycle,created});
      phase='public-observation-evidence';
      await require('./sj-public-observation-scenario').run({actors,prisma,checks,call,double,created});
    }
    if(workflow==='worker'){
      phase='worker-resilience';
      await require('./sj-resilience-scenario').run({proof,token,actors,prisma,checks,created,call,publication,double,activeWorkers});
    }
    if(workflow==='central'){
      phase='central-api-workflow';
      await require('./sj-review-api-scenario').run({proof,token,actors,prisma,checks,created,peer,instanceId,call,publication,cycle,double});
    }else if(workflow&&workflow!=='worker'){
      phase='bank-api-workflow';
      await require('./sj-workflow-api-scenario').run({proof,token,actors,prisma,checks,created,drafts,contact,p,logo,cycle});
      phase='operator-api';
      await require('./sj-operator-api-scenario').run({proof,token,actors,checks,double,cycle});
    }
    await redis.del(rk);assert.equal(await redis.exists(rk),0);
    if(peer)await peer.close();await prisma.$disconnect();await redis.quit();await double.close();
    finished=true;process.send({type:'result',pass:true,checks,double:double.counters,integrationOrigin:double.origin,fixtureSetup:'official services',apiWorkflow:workflow||false},()=>process.disconnect());
  }catch(e){
    // Do not echo SQL, passwords, signature, or private fixture payloads.
    if(peer)await peer.close().catch(()=>{});if(prisma)await prisma.$disconnect().catch(()=>{});if(redis)redis.disconnect();if(double)await double.close().catch(()=>{});
    finished=true;process.exitCode=1;if(process.connected)process.send({type:'result',pass:false,phase,code:e.code||e.name,reason:String(e.message).split('\n').filter(Boolean)[0]?.slice(0,240),testLocation:String(e.stack).split('\n').filter(line=>/sj-(workflow-api|review-api|resilience|media-reference)-scenario\.js/.test(line)).map(line=>line.trim()).join('; '),checks},()=>process.disconnect());
  }finally{clearInterval(progressTimer);}
});
