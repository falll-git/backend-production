// Genuine bank routes/services, real Control ingress/dispatcher, real SJ API,
// worker/scanner. All mutations target run-owned databases proved before import.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const assert=require('node:assert/strict'),{fork}=require('node:child_process');
const {assertLive}=require('./sj-disposable-guard');
const {centralPath}=require('./sj-peer-paths');
const {safeHarnessError}=require('./sj-harness-error');
let peer,server,prisma,finished=false;const children=new Set();
process.on('disconnect',()=>{if(!finished){for(const c of children)c.kill();process.exit(1);}});
process.once('message',async({proof,token,actors,cross,scanner})=>{
  process.on('message',message=>{if(message.type==='abort-owned-scenario'&&message.runId===proof.runId&&message.tokenHash===proof.tokenHash&&process.connected)process.disconnect();});
  const checks=[];let phase='start';
  const progressTimer=setInterval(()=>{if(process.connected)process.send({type:'progress',checks:[...checks,{check:'active real-service phase: '+phase,pass:null}]});},5000);
  progressTimer.unref();
  try{
    const bankKeys=crypto.generateKeyPairSync('ed25519'),controlKeys=crypto.generateKeyPairSync('ed25519');
    const keys={bankPublicKey:bankKeys.publicKey.export({type:'spki',format:'pem'}).toString(),bankPrivateKey:bankKeys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),controlPrivateKey:controlKeys.privateKey.export({type:'pkcs8',format:'pem'}).toString()};
    peer=fork(path.join(__dirname,'sj-cross-app-peer.mjs'),[],{cwd:proof.root,env:Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','DOCKER_HOST'].includes(k))),execArgv:['--import',require('node:url').pathToFileURL(centralPath("node_modules/tsx/dist/loader.mjs")).href],stdio:['ignore','pipe','pipe','ipc']});children.add(peer);peer.stdout.on('data',()=>{});let peerErrorCode='';peer.stderr.on('data',b=>{const code=String(b).match(/ERR_[A-Z_]+/);if(code)peerErrorCode=code[0];});
    const rpc=(method,data)=>new Promise((resolve,reject)=>{const id=crypto.randomUUID();const cleanup=()=>{clearTimeout(timer);peer.off('message',listen);peer.off('exit',exited);};const exited=code=>{cleanup();reject(Error('PEER_EXIT_'+method+'_'+code+'_'+peerErrorCode));};const timer=setTimeout(()=>{cleanup();reject(Error('PEER_TIMEOUT_'+method));},150000);const listen=m=>{if(m.id!==id)return;cleanup();if(m.pass){resolve(m.value);return;}const failure=safeHarnessError(m.failure),error=Error(method+': '+(failure.code||failure.name)+' peer operation failed');error.harnessFailure=failure;reject(error);};peer.on('message',listen);peer.once('exit',exited);peer.send({id,method,data});});
    const central=await rpc('start',{proof,cross,keys,scanner});proof.integrationOrigin=central.origin;
    process.env.SJ_PUBLIC_WEBSITE_ORIGIN='https://catalog.example.invalid';
    Object.assign(process.env,{SJ_CONTROL_BASE_URL:central.origin,SJ_TEST_CENTRAL_BASE_URL:central.origin,SJ_INTEGRATION_PRIVATE_KEY:keys.bankPrivateKey,SJ_CONTROL_ACK_PRIVATE_KEY:keys.bankPrivateKey,SJ_CONTROL_PUBLIC_KEY:controlKeys.publicKey.export({type:'spki',format:'pem'}).toString(),SJ_CONTROL_ACK_KEY_ID:'test-bank',SJ_CONTROL_KEY_ID:'test-control',SJ_CONTROL_INSTANCE_ID:central.instanceId,SJ_CONTROL_AUDIENCE:'ruwang-bank:isolated',SJ_CONTROL_REVIEW_AUTHORITY:'central',SJ_CONTROL_SNAPSHOT_ENABLED:'true',JWT_SECRET:crypto.randomBytes(48).toString('hex'),JWT_EXPIRES_IN:'30m'});
    const roles=await assertLive(proof,process.env,token);checks.push({check:'three owned databases; bank app/worker/reviewer and six peer runtime roles without owner/superuser/BYPASSRLS; real ClamAV clean/EICAR',pass:true,roles,scanner:central.scanner});
    const reviewer=await require('../../modules/seputar-jaminan/reviewDatabase').getReviewDatabase();
    const [archiveScope]=await reviewer.$queryRaw`SELECT has_column_privilege('public.sj_publications','archived_at','UPDATE') can_archive_timestamp,has_column_privilege('public.sj_publications','source_collateral_id','UPDATE') can_rebind_source,has_table_privilege('public.sj_publications','DELETE') can_delete`;
    assert.deepEqual(archiveScope,{can_archive_timestamp:true,can_rebind_source:false,can_delete:false});
    checks.push({check:'dedicated reviewer can record archive time but cannot rebind source or hard-delete publications',pass:true});
    const originalFetch=global.fetch;global.fetch=(input,options)=>{const u=new URL(typeof input==='string'?input:input.url);if(u.origin!==central.origin)throw Error('TEST_EGRESS_REJECTED');return originalFetch(input,{...options,redirect:'error'});};
    prisma=require('../../config/prisma');
    const express=require('express'),request=require('supertest');
    if(cross.bankUiRoot)Object.assign(process.env,{CORS_ORIGIN:'http://127.0.0.1:3111',FRONTEND_URL:'http://127.0.0.1:3111',JWT_REFRESH_SECRET:crypto.randomBytes(48).toString('hex'),JWT_REFRESH_EXPIRES_IN:'1d',AUTH_REFRESH_COOKIE_NAME:'sj_owned_refresh',FILE_ACCESS_SECRET:crypto.randomBytes(48).toString('hex'),FILE_ACCESS_TOKEN_EXPIRES_IN:'5m'});
    if(cross.bankUiRoot){
      // Test-only diagnostics after assertLive. Preserve the real service and
      // its error; never record payloads, SQL, credentials or private messages.
      const service=require('../../modules/seputar-jaminan/saveOperation.service'),original=service.execute;
      service.execute=async(...args)=>{try{return await original(...args);}catch(error){
        const driver=error.meta?.driverAdapterError?.cause;
        const diagnostic=String(driver?.originalMessage||error.meta?.message||error.meta?.cause?.originalMessage||error.message||'');
        const identifier=diagnostic.match(/permission denied for (?:table|schema|sequence) ([a-z_][a-z0-9_]*)/i)?.[1]||null;
        const safe=value=>typeof value==='string'&&/^[a-z][a-z0-9_]*$/i.test(value)?value:null;
        const sqlState=value=>typeof value==='string'&&/^[A-Z0-9]{5}$/.test(value)?value:null;
        const constraint=diagnostic.match(/(?:constraint|trigger) ["']([a-z_][a-z0-9_]*)["']/i)?.[1]||null;
        fs.writeFileSync(path.join(proof.root,'save-operation-error.json'),JSON.stringify({kind:args[0],name:safe(error.name),code:safe(error.code),databaseCode:sqlState(driver?.originalCode||error.meta?.code),databaseKind:safe(driver?.kind),permissionTarget:identifier,constraint},null,2));
        throw error;
      }};
    }
    const app=cross.bankUiRoot?require('../../app'):express();
    if(!cross.bankUiRoot){app.use(express.json());app.use('/api/v1/internal/ruwang-control/sj-review',require('../../modules/seputar-jaminan/controlReview.route'));app.use('/api/v1/seputar-jaminan',require('../../modules/seputar-jaminan/seputarJaminan.route'));}
    server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});const origin='http://127.0.0.1:'+server.address().port;
    await new Promise((resolve,reject)=>{const listener=m=>{if(m.type==='cross-registered'){process.off('message',listener);m.pass?resolve():reject(Error('CONTROL_REGISTRY_FAILED'));}};process.on('message',listener);process.send({type:'cross-register',registration:{instanceId:central.instanceId,bankOrigin:origin,bankPublicKey:keys.bankPublicKey,recoveryBinding:central.recoveryBinding}});});
    const tokens=Object.fromEntries(Object.entries(actors).filter(([,v])=>v.id).map(([k,a])=>[k,require('../../utils/jwt').generateAccessToken({id:a.id,session_id:a.session_id})]));
    const http=async(actor,method,url,body,expected=200)=>{
      let q=request(server)[method]('/api/v1/seputar-jaminan'+url);
      if(actor)q=q.set('Authorization','Bearer '+tokens[actor]);
      if(body)q=q.send(body);
      const r=await q;
      if(r.status!==expected){
        // Persist route families, not request bodies, IDs, cursors or private
        // application error messages. Never change authentication after failure.
        const family=url.split(/[/?]/)[1];
        const resource=['contacts','profile','publications','media','settings','taxonomy','save-operations','change-requests'].includes(family)?family:'other';
        let tokenState='anonymous';
        if(actor){try{require('../../utils/jwt').verifyAccessToken(tokens[actor]);tokenState='valid';}catch(error){tokenState=error.name==='TokenExpiredError'?'expired':'invalid';}}
        fs.writeFileSync(path.join(proof.root,'http-operation-error.json'),JSON.stringify({phase,method,resource,expected,status:r.status,tokenState,at:new Date().toISOString()},null,2));
        throw Error('REAL_BANK_HTTP_STATUS_MISMATCH');
      }
      return r.body.data;
    };
    const renewHttpActors=async(reason='before-production-performance')=>{
      // API fixture actors are distinct from browser login sessions. Explicit
      // allowlisted phase boundaries only, never a fallback to an auth error.
      const jwt=require('../../utils/jwt');
      const receipt=await require('./sj-fixture-credential-renewal').renewFixtureActorTokens({actors,tokens,
        assertOwned:()=>assertLive(proof,process.env,token),
        generateAccessToken:jwt.generateAccessToken,verifyAccessToken:jwt.verifyAccessToken,
        reason});
      const expired=jwt.generateAccessToken({id:actors.maker.id,session_id:actors.maker.session_id,iat:Math.floor(Date.now()/1000)-1801});
      const denied=await request(server).get('/api/v1/seputar-jaminan/contacts?paged=true&limit=10').set('Authorization','Bearer '+expired);
      assert.equal(denied.status,401,'actual authentication must reject an expired fixture token');
      await http('maker','get','/contacts?paged=true&limit=10');
      const result={...receipt,reason,expiredTokenHttpStatus:denied.status,freshTokenHttpStatus:200};
      const filename=require('./sj-fixture-credential-renewal').fixtureRenewalReceiptName(reason);
      fs.writeFileSync(path.join(proof.root,filename),JSON.stringify(result,null,2),{flag:'wx'});
      checks.push({check:'owned API fixture renewal with unchanged issuer/session/30-minute TTL; actual expired token rejected and fresh actor accepted; not browser refresh evidence',pass:true,...result});
      return result;
    };
    const worker=(fault={})=>new Promise((resolve,reject)=>{const env={...process.env,...fault,RUNTIME_ROLE:'seputar-jaminan-worker'};delete env.SJ_REVIEW_DATABASE_URL;const child=fork(path.join(__dirname,'sj-isolated-worker.js'),[],{cwd:proof.root,env,stdio:['ignore','pipe','pipe','ipc']});children.add(child);let result;child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});const timer=setTimeout(()=>child.kill(),50000);child.on('message',m=>result=m);child.on('exit',code=>{children.delete(child);clearTimeout(timer);code===0&&result?.pass?resolve():reject(Error('BANK_WORKER_FAILED'));});child.send({proof,token});});
    const cycle=async()=>{await worker();await rpc('drain');await worker();};
    const settle=async(url,predicate)=>{for(let i=0;i<15;i++){await cycle();const r=await http('maker','get',url);if(predicate(r))return r;await new Promise(r=>setTimeout(r,200));}throw Error('SETTLE_TIMEOUT '+url);};
    const decide=async(kind,sourceId,decision='approve',reason)=>{await cycle();return rpc('decide',{kind,sourceId,decision,reason});};
    const lifecycleExpected=async(command,change,kind,sourceId,publicMediaUrl=null)=>{
      const ledger=await reviewer.sj_control_review_commands.findUniqueOrThrow({where:{command_id:command.commandId}});
      assert.equal(ledger.status,'APPLIED');assert.equal(ledger.decision,'approve');
      assert.equal(ledger.instance_id,central.instanceId);assert.equal(ledger.resource_kind,'change_request');
      assert.equal(ledger.resource_id,change.id);assert.equal(ledger.expected_version,change.request_version);
      assert.equal(ledger.expected_checksum,change.impact_checksum);
      assert.equal(ledger.actor_subject,ledger.request_payload.actor_subject);
      assert.equal(ledger.command_digest,require('../../modules/seputar-jaminan/controlReview.contract').payloadDigest(ledger.request_payload));
      const eventType=kind==='contact'?'REVOKE_WHATSAPP_CONTACT':'REVOKE_MEDIA';
      const events=await reviewer.sj_sync_outbox.findMany({where:{source_command_id:command.commandId,event_type:eventType}});
      assert.equal(events.length,1);const event=events[0];assert.equal(event.state,'ACKNOWLEDGED');
      assert.equal(event.source_command_id,command.commandId);
      assert.equal(event.payload_json.institution_id,central.institutionId);
      const settings=await reviewer.sj_integration_settings.findFirstOrThrow({select:{key_id:true}});
      return {kind,sourceId,changeRequestId:change.id,commandId:command.commandId,
        commandDigest:ledger.command_digest,commandPayload:ledger.request_payload,
        eventId:event.event_id,eventType:event.event_type,aggregateType:event.aggregate_type,
        aggregateId:event.aggregate_id,aggregateVersion:event.aggregate_version,schemaVersion:event.schema_version,
        payloadChecksum:event.payload_checksum,payload:event.payload_json,keyId:settings.key_id,publicMediaUrl};
    };
    phase='settings';await http('maker','patch','/settings',{institution_id:central.institutionId,installation_id:central.instanceId,key_id:central.keyId,central_base_url:central.origin,module_visible:true,draft_enabled:true,review_enabled:true,sync_enabled:true,publish_enabled:true,filesystem_upload_enabled:true,s3_upload_enabled:false});
    await http(null,'get','/publications',null,401);await http('denied','get','/publications',null,403);
    phase='contact';let contact=await http('maker','post','/contacts',{label:'Cross-app marketing',phone_e164:'+6281234567890'},201);contact=await http('maker','post',`/contacts/${contact.id}/submit`,{expected_version:contact.lock_version});
    await decide('contact',contact.id);
    checks.push(await require('./sj-control-recovery-proof')({server,worker,reviewer,central,keys,aggregateId:contact.id}));
    const contactId=contact.id;contact=(await settle('/contacts?paged=true&limit=20',r=>r.items.some(c=>c.id===contactId&&c.sync_state==='ACKNOWLEDGED'))).items.find(c=>c.id===contactId);
    phase='bank-installation-isolation';
    checks.push(await require('./sj-bank-isolation-proof')({proof,token,http,server,tokens,
      reviewer,prisma,actors,children,contactId}));
    // Opt-in high-entropy, camera-sized synthetic media; never real/private photos.
    const bytes=cross.performance?await require('sharp')(crypto.randomBytes(1920*1080*3),{raw:{width:1920,height:1080,channels:3}}).jpeg({quality:90}).toBuffer():await require('sharp')({create:{width:640,height:480,channels:3,background:'#CBD6BF'}}).png().toBuffer();
    const upload=async purpose=>{const r=await request(server).post('/api/v1/seputar-jaminan/media').set('Authorization','Bearer '+tokens.maker).field('purpose',purpose).attach('image',bytes,'owned-test.png');assert.equal(r.status,201);return r.body.data;};
    phase='profile';let logo,profile,profileCommand,controlBrowser;
    if(cross.uiStep6){
      // A fresh singleton is created through the real UI, not pre-created by
      // API and later mislabelled as UI creation. Reuse one Control runtime.
      controlBrowser=await rpc('browser');
      const initial=await require('./sj-three-ui-browser').run({proof,cross:{...cross,uiInitialProfileMode:true},bankOrigin:origin,controlOrigin:controlBrowser.origin,publicApiOrigin:central.origin,slug:central.slug,cycle,rpc,httpApi:http,renewHttpActors});
      ({profile,logo,profileCommand}=initial);checks.push(initial);
    }else{
      logo=await upload('BPRS_PUBLIC_MARK');await settle('/media/'+logo.id+'/status',r=>r.state==='READY');
      profile=await http('maker','patch','/profile/draft',{display_name:'BPRS Cross App',public_slug:central.slug,city_regency:'Bandung',province:'Jawa Barat',short_description:'Data pengujian terisolasi, bukan publikasi operasional.',logo_media_id:logo.id,website_url:null});profile=await http('maker','post','/profile/submit',{expected_version:profile.lock_version});
      await http('checker','post','/profile/verify',{expected_version:profile.lock_version},409);profileCommand=await decide('profile',profile.id);profile=await settle('/profile',r=>r.sync_state==='ACKNOWLEDGED');
    }
    const observation=await http('maker','post','/profile/public-observation');assert.equal(observation.last_success.state,'AVAILABLE');
    const controlProfile=await rpc('review',profileCommand);assert.equal(controlProfile.commandState,'APPLIED');assert.equal(controlProfile.state,'APPROVED');
    assert.equal(observation.version_evidence,'SOURCE_PROFILE_EVENT');
    assert.equal(observation.last_success.observed_version,profile.aggregate_version);
    assert.equal(observation.last_success.profile_snapshot.public_page_url,'https://catalog.example.invalid/bprs/'+central.slug);
    assert.equal(observation.last_success.profile_snapshot.public_name,'BPRS Cross App');
    // Positive lifecycle exclusively through bank API and real Control/SJ, no status SQL.
    profile=await http('maker','patch','/profile/draft',{expected_version:profile.lock_version,display_name:'BPRS Cross App Revisi',public_slug:central.slug,city_regency:'Bandung',province:'Jawa Barat',short_description:'Deskripsi versi kedua yang belum dikirim.',logo_media_id:logo.id,website_url:null});
    const oldPublic=await http('maker','post','/profile/public-observation');
    assert.equal((await rpc('media-proof',{...profileCommand,mediaId:logo.id})).historicalMedia,true);
    assert.equal(oldPublic.last_success.observed_version,observation.last_success.observed_version);
    assert.equal(oldPublic.last_success.profile_snapshot.public_name,'BPRS Cross App');
    profile=await http('maker','post','/profile/submit',{expected_version:profile.lock_version});
    await cycle();
    const waitingProfile=await rpc('prepare-review',{kind:'profile',sourceId:profile.id});
    assert.equal((await rpc('review',waitingProfile)).state,'IN_REVIEW');
    const profileWhilePending=await http('maker','post','/profile/public-observation');
    assert.equal(profileWhilePending.last_success.observed_version,oldPublic.last_success.observed_version);
    assert.deepEqual(profileWhilePending.last_success.profile_snapshot,oldPublic.last_success.profile_snapshot);
    await decide('profile',profile.id);profile=await settle('/profile',r=>r.sync_state==='ACKNOWLEDGED');
    const newPublic=await http('maker','post','/profile/public-observation');
    assert.equal((await rpc('review',profileCommand)).sourceVersion,controlProfile.sourceVersion,'historical Control snapshot must not turn into current public version');
    assert.ok(newPublic.last_success.observed_version>oldPublic.last_success.observed_version);
    assert.equal(newPublic.last_success.profile_snapshot.public_name,'BPRS Cross App Revisi');
    process.env.SJ_PUBLIC_WEBSITE_ORIGIN='https://wrong-environment.example.invalid';
    const wrongEnvironment=await http('maker','post','/profile/public-observation');
    assert.equal(wrongEnvironment.latest_attempt.state,'FAILED');
    assert.equal(wrongEnvironment.last_success.id,newPublic.last_success.id);
    assert.equal(wrongEnvironment.last_success.profile_snapshot.public_page_url,null);
    process.env.SJ_PUBLIC_WEBSITE_ORIGIN='https://catalog.example.invalid';
    assert.equal((await http('maker','get','/profile/public-observation')).last_success.profile_snapshot.public_page_url,newPublic.last_success.profile_snapshot.public_page_url);
    checks.push({check:'real public profile source version/snapshot/link, bank draft leaves previous public version intact, new approved event replaces snapshot, wrong website environment fails without losing last success',pass:true});
    checks.push({check:'real upload/scanner, profile/contact signed snapshots, Control decisions, signed bank ACK, SJ ingest and identity-bound public observation',pass:true,url:origin,peer:central.origin});
    // A separate real submission tests an uncertain result without poisoning
    // the positive profile/contact/publication journey or forcing a retry.
    let uncertain=await http('maker','post','/contacts',{label:'Unsigned ACK negative case',phone_e164:'+6281234567891'},201);
    uncertain=await http('maker','post',`/contacts/${uncertain.id}/submit`,{expected_version:uncertain.lock_version});await cycle();
    const uncertainCommand=await rpc('decide',{kind:'contact',sourceId:uncertain.id,unsignedAck:true});assert.equal(uncertainCommand.state,'UNKNOWN');
    const bankOutcome=await reviewer.sj_control_review_commands.findUniqueOrThrow({where:{command_id:uncertainCommand.commandId},select:{status:true,result_code:true}});
    assert.equal(bankOutcome.status,'APPLIED');assert.equal(bankOutcome.result_code,'DECISION_APPLIED');
    await rpc('adapter-proof');
    checks.push({check:'Control adapter: authenticated reviewer, private media, signed ACK, unsigned ACK stays UNKNOWN without resend or duplicate dispatch',pass:true});
    assert.equal((await rpc('reconcile',uncertainCommand)).state,'APPLIED');
    assert.equal((await reviewer.sj_control_review_commands.count({where:{command_id:uncertainCommand.commandId}})),1);
    checks.push({check:'signed bank ledger resolves lost ACK without resend; forged result and wrong instance rejected; concurrent checks preserve original UNKNOWN attempt',pass:true});
    phase='control-delivery-recovery';
    await worker({SJ_INTEGRATION_PRIVATE_KEY:crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'})});
    const recoverable=await reviewer.sj_sync_outbox.findFirst({where:{aggregate_id:uncertain.id,event_type:'UPSERT_WHATSAPP_CONTACT'}});
    assert.equal(recoverable.state,'QUARANTINED');
    process.env.SJ_CONTROL_RECOVERY_ENABLED='true';
    try {checks.push(await rpc('recovery-proof',{jobId:recoverable.id}));}finally{delete process.env.SJ_CONTROL_RECOVERY_ENABLED;}
    await worker();assert.equal((await reviewer.sj_sync_outbox.findUnique({where:{id:recoverable.id}})).state,'ACKNOWLEDGED');
    phase='real-worker-resilience';
    checks.push(...await require('./sj-real-worker-proof')({proof,token,http,worker,rpc,reviewer,children}));
    let competing=await http('maker','post','/contacts',{label:'Owned competing reviewers',phone_e164:'+6288877776666'},201);
    competing=await http('maker','post',`/contacts/${competing.id}/submit`,{expected_version:competing.lock_version});
    await worker();await rpc('prepare-review',{kind:'contact',sourceId:competing.id});
    const competition=await rpc('decision-proof',{phase:'pending',kind:'contact',sourceId:competing.id});
    assert.equal(await reviewer.sj_control_review_commands.count({where:{command_id:competition.commandId}}),1);
    checks.push(competition);
    await worker();await rpc('drain');
    phase='real-control-dispatcher-crash';
    for(const [index,mode] of ['before-send','after-response'].entries()){
      let crashContact=await http('maker','post','/contacts',{label:'Owned Control dispatcher '+mode,phone_e164:'+628887777666'+(7+index)},201);
      crashContact=await http('maker','post',`/contacts/${crashContact.id}/submit`,{expected_version:crashContact.lock_version});
      await worker();await rpc('prepare-review',{kind:'contact',sourceId:crashContact.id});
      const proofResult=await rpc('dispatcher-crash-proof',{sourceId:crashContact.id,mode});
      const expectedEffects=mode==='before-send'?0:1;
      const ledgers=await reviewer.sj_control_review_commands.findMany({where:{command_id:proofResult.commandId}});
      assert.equal(ledgers.length,expectedEffects);
      if(expectedEffects){assert.equal(ledgers[0].status,'APPLIED');assert.equal(ledgers[0].resource_id,crashContact.id);}
      const events=await reviewer.sj_sync_outbox.findMany({where:{aggregate_id:crashContact.id,event_type:'UPSERT_WHATSAPP_CONTACT'}});
      assert.equal(events.length,expectedEffects,'A real dispatcher restart must not duplicate a bank effect/outbox');
      if(expectedEffects){
        await cycle();
        assert.equal((await reviewer.sj_sync_outbox.findUniqueOrThrow({where:{id:events[0].id}})).state,'ACKNOWLEDGED');
        const sjEffect=await rpc('event-proof',{eventId:events[0].event_id});
        assert.equal(sjEffect.count,1);assert.equal(sjEffect.state,'APPLIED');
        assert.equal(sjEffect.effect,'contact-version-and-checksum');
      }
      checks.push({...proofResult,bankLedgerCount:ledgers.length,bankOutboxCount:events.length,
        sjEffectVerified:expectedEffects===1,
        boundary:'Actual Control child termination/restart with real bank HTTP/ledger/outbox and, after remote commit, real SJ ingest/cursor/contact; not browser or test-double evidence.'});
    }
    phase='publications';const taxonomy=await http('maker','get','/taxonomy'),assets=[],photos=[],publicMediaUrls=new Map();
    assert.deepEqual(taxonomy.categories.map(c=>c.code).sort(),['LAND','BUILDING','MACHINE_EQUIPMENT','VEHICLE'].sort());
    const attributes={LAND:{land_area_m2:120},BUILDING:{land_area_m2:120,building_area_m2:80},MACHINE_EQUIPMENT:{model_or_type:'Mesin tes',public_condition:'BAIK'},VEHICLE:{brand:'Merek tes',model_or_type:'Mobil tes',public_condition:'BAIK',mileage_km:0}};
    for(const category of taxonomy.categories){
      const photo=await upload('PUBLICATION_IMAGE');
      photos.push(photo);
      let asset=await http('maker','post','/publications',{source_type:'COLLATERAL',source_collateral_id:actors.collateralIds[category.code],asset_category:category.code,taxonomy_item_id:category.items[0].id,title:'Cross app '+category.code,description:'Aset khusus pengujian terisolasi lintas aplikasi, bukan penawaran nyata.',city_regency:'Bandung',province:'Jawa Barat',whatsapp_contact_version_id:contact.current_version_id,profile_version_id:profile.current_version_id,attributes:attributes[category.code],media:[{media_asset_id:photo.id,sort_order:0,is_cover:true,alt_text:'Foto tes'}]},201);
      await settle('/media/'+photo.id+'/status',r=>r.state==='READY');asset=await http('maker','post',`/publications/${asset.id}/submit`,{expected_version:asset.lock_version});
      if(assets.length===0){
        const revisionCommand=await decide('publication',asset.id,'request_revision','Perjelas judul aset sebelum publikasi.');
        asset=await http('maker','get','/publications/'+asset.id);assert.equal(asset.state,'REVISION_REQUIRED');
        asset=await http('maker','patch',`/publications/${asset.id}/draft`,{expected_version:asset.lock_version,title:'Cross app '+category.code+' revisi'});
        asset=await http('maker','post',`/publications/${asset.id}/submit`,{expected_version:asset.lock_version});
        await cycle();
        checks.push(await rpc('decision-proof',{phase:'superseded',kind:'publication',sourceId:asset.id,reviewId:revisionCommand.reviewId}));
      }
      const command=await decide('publication',asset.id);
      const appliedBeforeDelivery=await http('maker','get','/publications/'+asset.id);
      assert.equal((await rpc('review',command)).commandState,'APPLIED');
      assert.notEqual(appliedBeforeDelivery.sync_state,'ACKNOWLEDGED');
      assert.equal((await fetch(central.origin+'/v1/public/assets/'+asset.reference_code)).status,404);
      const unconfirmed=await http('maker','get',`/publications/${asset.id}/public-observation`);
      assert.equal(unconfirmed.last_success,null,'approval without delivery must not fabricate public evidence');
      asset=await settle('/publications/'+asset.id,r=>r.sync_state==='ACKNOWLEDGED');
      const o=await http('maker','post',`/publications/${asset.id}/public-observation`);assert.equal(o.last_success.state,'AVAILABLE');
      assert.equal(o.version_evidence,'SOURCE_PUBLICATION_EVENT');assert.equal(o.last_success.observed_version,asset.aggregate_version);
      assert.equal(o.last_success.publication_snapshot.title,asset.published_version.title);
      assert.equal(o.last_success.publication_snapshot.public_page_url,'https://catalog.example.invalid/aset/'+asset.reference_code);
      assert.deepEqual(Object.keys(o.last_success.publication_snapshot).sort(),['title','description','category','city_regency','province','attributes','photo_count','public_updated_at','public_page_url'].sort());
      assert.match(asset.reference_code,/^SJ-[A-Z0-9]{8}$/);const response=await fetch(central.origin+'/v1/public/assets/'+asset.reference_code);assert.equal(response.status,200);const dto=await response.json();const wa=new URL(dto.whatsapp_url);assert.equal(wa.origin,'https://wa.me');assert.equal(wa.pathname,'/6281234567890');assert.ok(wa.searchParams.get('text').includes(asset.reference_code));
      assert.equal(dto.media.length,1);const publicMediaUrl=new URL(dto.media[0].url);
      assert.equal(publicMediaUrl.origin,central.origin);
      assert.match(publicMediaUrl.pathname,/^\/v1\/public\/media\/[0-9a-f-]{36}$/i);
      assert.equal(publicMediaUrl.search,'');assert.equal(publicMediaUrl.hash,'');
      const mediaResponse=await fetch(publicMediaUrl.href,{redirect:'error',signal:AbortSignal.timeout(15000)});
      assert.equal(mediaResponse.status,200);assert.equal(mediaResponse.headers.get('content-type'),'image/webp');
      assert.ok((await mediaResponse.arrayBuffer()).byteLength>10);
      publicMediaUrls.set(photo.id,publicMediaUrl.href);
      if(category.code==='VEHICLE')assert.equal(dto.attributes.mileage_km,0);
      const controlPublication=await rpc('review',command);assert.equal(controlPublication.commandState,'APPLIED');assert.equal(controlPublication.state,'APPROVED');assets.push(asset);
    }
    checks.push({check:'four categories published through bank API and actual Control/SJ; API identity/time evidence, zero attribute and WhatsApp URL checked without sending',pass:true,count:assets.length});
    assert.equal(assets.length,4);
    checks.push({check:'all four actual approved decisions are APPLIED in bank before SJ delivery; each public asset remains 404 with no fabricated last-success evidence',pass:true});
    checks.push({check:'immutable approved command to event to real public profile/publication version; older approval distinguished; unsigned response, wrong instance and no grant rejected',pass:true});
    phase='real-bank-negatives';
    checks.push(...await require('./sj-real-bank-negative-proof')({proof,token,http,server,tokens,worker,rpc,reviewer,prisma,central,keys,actors,publicationId:assets[0].id,mediaId:photos[0].id}));
    phase='real-central-negatives';
    await assert.rejects(rpc('central-proof',{origin:'http://127.0.0.1:1'}),/central-proof: ERR_ASSERTION/);
    checks.push({check:'real SJ proof rejects an unowned loopback target before signed mutation',pass:true});
    checks.push(...(await rpc('central-proof',{})).checks);
    phase='public-version';let changed=assets[3];
    const previous=await http('maker','get',`/publications/${changed.id}/public-observation`);
    changed=await http('maker','patch',`/publications/${changed.id}/draft`,{expected_version:changed.lock_version,title:'Revisi publik yang diajukan'});
    const pending=await http('maker','post',`/publications/${changed.id}/public-observation`);
    assert.deepEqual(pending.last_success.publication_snapshot,previous.last_success.publication_snapshot);
    assert.equal(pending.last_success.observed_version,previous.last_success.observed_version);
    changed=await http('maker','post',`/publications/${changed.id}/submit`,{expected_version:changed.lock_version});
    await cycle();
    const waitingPublication=await rpc('prepare-review',{kind:'publication',sourceId:changed.id});
    assert.equal((await rpc('review',waitingPublication)).state,'IN_REVIEW');
    const publicationWhilePending=await http('maker','post',`/publications/${changed.id}/public-observation`);
    assert.equal(publicationWhilePending.last_success.observed_version,previous.last_success.observed_version);
    assert.deepEqual(publicationWhilePending.last_success.publication_snapshot,previous.last_success.publication_snapshot);
    await decide('publication',changed.id);changed=await settle('/publications/'+changed.id,r=>r.sync_state==='ACKNOWLEDGED');assets[3]=changed;
    const updated=await http('maker','post',`/publications/${changed.id}/public-observation`);
    assert.equal(updated.last_success.publication_snapshot.title,'Revisi publik yang diajukan');
    assert.equal(updated.last_success.observed_version,changed.aggregate_version);assert.ok(updated.last_success.observed_version>pending.last_success.observed_version);
    process.env.SJ_PUBLIC_WEBSITE_ORIGIN='https://wrong-environment.example.invalid';
    const invalid=await http('maker','post',`/publications/${changed.id}/public-observation`);
    assert.equal(invalid.latest_attempt.state,'FAILED');assert.equal(invalid.last_success.id,updated.last_success.id);
    assert.equal(invalid.last_success.publication_snapshot.public_page_url,null);
    process.env.SJ_PUBLIC_WEBSITE_ORIGIN='https://catalog.example.invalid';
    checks.push({check:'publication public snapshot/version stays unchanged during bank draft, changes only after real approved delivery, wrong website preserves last valid observation without an unsafe link',pass:true});
    phase='reconfirmation';let asset=await http('maker','get','/publications/'+assets[0].id);
    const makeReconfirmation=()=>http('maker','post',`/publications/${asset.id}/change-requests`,{action:'RECONFIRM_PUBLICATION',expected_version:asset.lock_version,reason:'Konfirmasi data pengujian melalui pemeriksaan pusat.'},201);
    let reconfirm=await makeReconfirmation();
    await decide('change_request',reconfirm.id,'reject','Bukti pembaruan perlu dilengkapi.');
    const readChange=async id=>(await http('maker','get','/change-requests?limit=100')).items.find(row=>row.id===id);
    assert.equal((await readChange(reconfirm.id)).state,'REJECTED');
    asset=await http('maker','get','/publications/'+asset.id);
    reconfirm=await makeReconfirmation();await decide('change_request',reconfirm.id,'approve','Pembaruan telah diperiksa.');
    await cycle();assert.equal((await readChange(reconfirm.id)).state,'COMPLETED');
    phase='withdrawal';asset=await http('maker','get','/publications/'+asset.id);const approved=asset.published_version;
    asset=await http('maker','patch',`/publications/${asset.id}/draft`,{expected_version:asset.lock_version,title:'Perubahan yang belum diajukan'});assert.deepEqual(asset.published_version,approved);
    let change=await http('maker','post',`/publications/${asset.id}/change-requests`,{action:'UNPUBLISH_PUBLICATION',expected_version:asset.lock_version,reason:'Penarikan tes saat masih ada versi draf yang belum disetujui.'},201);
    await decide('change_request',change.id,'request_revision','Lengkapi alasan penarikan sebelum diputuskan.');
    change=await readChange(change.id);assert.equal(change.state,'REVISION_REQUIRED');
    const revision=change.request_version;
    change=await http('maker','post',`/change-requests/${change.id}/resubmit`,{expected_version:revision,reason:'Penawaran dihentikan sementara; versi publik lama perlu ditarik.'});
    assert.equal(change.request_version,revision+1);
    const withdrawal=await decide('change_request',change.id,'approve','Dampak penarikan telah diperiksa untuk pengujian terisolasi.');await cycle();
    assert.equal((await fetch(central.origin+'/v1/public/assets/'+asset.reference_code)).status,404);
    assert.equal((await fetch(central.origin+'/v1/public/institutions/'+central.slug)).status,200);
    assert.equal((await rpc('review',withdrawal)).commandState,'APPLIED'); // Public absence is asserted through the bank/SJ API below.
    const absent=await http('maker','post',`/publications/${asset.id}/public-observation`);assert.equal(absent.last_success.state,'NOT_FOUND');
    checks.push({check:'pending draft cannot replace approved version; actual Control withdrawal removes asset while profile remains visible; bank public check observes asset404 while Control confirms APPLIED rather than treating profile200 as asset visibility',pass:true});
    checks.push({check:'Control lifecycle: publication revision/resubmit, rejected and approved reconfirmation, withdrawal revision/resubmit',pass:true});
    if(cross.browserRoot){phase='browser';const browser=controlBrowser??await rpc('browser');checks.push(await require('./sj-cross-app-browser').run({proof,cross,origin:browser.origin,reviews:[{kind:'profile',reviewId:profileCommand.reviewId,expected:'BPRS Cross App'},{kind:'withdrawal',reviewId:withdrawal.reviewId,expected:'Data yang diajukan'}]}));
      if(cross.bankUiRoot&&cross.publicUiRoot){phase='three-ui-browser';
        const runThreeUi=()=>require('./sj-three-ui-browser').run({proof,cross,diagnosticToken:cross.catalogCancelDiagnostic?token:undefined,bankOrigin:origin,controlOrigin:browser.origin,publicApiOrigin:central.origin,profileId:profile.id,publications:assets,slug:central.slug,cycle,rpc,httpApi:http,upload,renewHttpActors});
        // Earlier negative service gates deliberately restore this capability
        // to disabled. Re-prove ownership and enable it only for the real UI.
        checks.push(await (cross.uiStep6?require('./sj-step6-recovery-scope').withOwnedRecovery({proof,token,cross},runThreeUi):runThreeUi()));
        for(let i=0;i<assets.length;i++)assets[i]=await http('maker','get','/publications/'+assets[i].id);}
    }
    phase='eligibility';process.send({type:'progress',checks:[...checks,{check:'eligibility started',pass:null}]});const remaining=assets[1];
    const observed=async expected=>{
      const result=await http('maker','post',`/publications/${remaining.id}/public-observation`);
      assert.equal(result.last_success.state,expected);assert.equal(result.latest_attempt.state,expected);
      if(expected==='AVAILABLE'){assert.equal(result.last_success.observed_version,remaining.aggregate_version);assert.equal(result.version_evidence,'SOURCE_PUBLICATION_EVENT');}
      else{assert.equal(result.last_success.observed_version,null);assert.equal(result.last_success.publication_snapshot,null);}
      return result;
    };
    await rpc('eligibility',{action:'suspend'});await observed('NOT_FOUND');
    assert.equal((await http('maker','post','/profile/public-observation')).last_success.state,'NOT_FOUND');
    await rpc('eligibility',{action:'reactivate'});await observed('AVAILABLE');
    for(const subjectType of ['PROFILE','PUBLICATION','MEDIA']){
      const quarantine=await rpc('eligibility',{action:'quarantine',subjectType,referenceCode:remaining.reference_code});
      await observed('NOT_FOUND');
      if(subjectType==='PROFILE')assert.equal((await http('maker','post','/profile/public-observation')).last_success.state,'NOT_FOUND');
      else assert.equal((await fetch(central.origin+'/v1/public/institutions/'+central.slug)).status,200);
      await rpc('eligibility',{action:'resolve',quarantineId:quarantine.subject_id});await observed('AVAILABLE');
    }
    await rpc('eligibility',{action:'expire-confirmation',referenceCode:remaining.reference_code});await observed('NOT_FOUND');
    checks.push({check:'real SJ suspension, profile/publication/cover-media quarantine and resolution, explicit negative confirmation-time fault; bank observations preserve identity and never guess public version/cause',pass:true});
    phase='central-worker-crash';
    await rpc('drain',{});
    const crashPhoto=await upload('PUBLICATION_IMAGE');
    const crashDraft=await http('maker','get','/publications/'+remaining.id);
    await http('maker','patch',`/publications/${remaining.id}/draft`,{expected_version:crashDraft.lock_version,media:[{media_asset_id:crashPhoto.id,sort_order:0,is_cover:true,alt_text:'Foto tes restart worker'}]});
    await worker();
    assert.equal((await http('maker','get','/media/'+crashPhoto.id+'/status')).state,'PROCESSING');
    checks.push(...(await rpc('central-worker-proof',{sourceMediaId:crashPhoto.id})).checks);
    phase='processing-recovery';
    const recoveryPhoto=await upload('PUBLICATION_IMAGE');
    const recoveryDraft=await http('maker','get','/publications/'+remaining.id);
    await http('maker','patch',`/publications/${remaining.id}/draft`,{expected_version:recoveryDraft.lock_version,media:[{media_asset_id:recoveryPhoto.id,sort_order:0,is_cover:true,alt_text:'Foto pemulihan tes'}]});
    await worker();
    const recoveryStatus=await http('maker','get','/media/'+recoveryPhoto.id+'/status');
    assert.equal(recoveryStatus.state,'PROCESSING','The draft-linked upload must reach SJ before testing its worker recovery');
    checks.push(await rpc('processing-recovery-proof',{sourceMediaId:recoveryPhoto.id}));
    phase='archive-dependencies';process.send({type:'progress',checks:[...checks,{check:'archive dependencies started',pass:null}]});
    // A currently referenced contact cannot be removed, even under central authority.
    await http('maker','post',`/contacts/${contact.id}/change-requests`,{expected_version:contact.lock_version,reason:'Kontak masih digunakan publikasi tes.'},409);
    for(const old of assets){
      const current=await http('maker','get','/publications/'+old.id);
      const request=await http('maker','post',`/publications/${old.id}/change-requests`,{action:'ARCHIVE_PUBLICATION',expected_version:current.lock_version,reason:'Arsip publikasi disposable setelah pemeriksaan selesai.'},201);
      await decide('change_request',request.id,'approve','Arsip tes disetujui setelah pemeriksaan dampak.');
      const archived=await settle('/publications/'+old.id,r=>r.state==='ARCHIVED'&&r.sync_state==='ACKNOWLEDGED');
      assert.ok(archived.current_version,'archive retains content, not hard delete');
      assert.equal((await http('maker','post',`/publications/${old.id}/public-observation`)).last_success.state,'NOT_FOUND');
    }
    const contactRemoval=await http('maker','post',`/contacts/${contact.id}/change-requests`,{expected_version:contact.lock_version,reason:'Tidak ada lagi publikasi tes yang memakai kontak.'},201);
    const contactRemovalCommand=await decide('change_request',contactRemoval.id,'approve','Referensi kontak sudah selesai diarsipkan.');await cycle();
    // The documented list contains active contacts, not revoked history.
    // Verify that it disappears there; inspect persisted state using the
    // already-proved restricted reviewer role, never the migration owner.
    assert.equal((await http('maker','get','/contacts?paged=true&limit=20')).items.some(c=>c.id===contact.id),false);
    const revokedContact=await reviewer.sj_whatsapp_contacts.findUniqueOrThrow({where:{id:contact.id},select:{state:true,sync_state:true}});
    assert.equal(revokedContact.state,'REVOKED');assert.equal(revokedContact.sync_state,'ACKNOWLEDGED');
    checks.push(await rpc('lifecycle-proof',{expected:await lifecycleExpected(contactRemovalCommand,contactRemoval,'contact',contact.id)}));
    profile=await http('maker','get','/profile');
    if(cross.uiStep6){
      phase='final-profile-hide-browser';
      checks.push(await require('./sj-three-ui-browser').run({proof,cross:{...cross,uiFinalLifecycleMode:true},bankOrigin:origin,controlOrigin:'http://127.0.0.1:4320',publicApiOrigin:central.origin,slug:central.slug,cycle,rpc,httpApi:http,renewHttpActors}));
    }else{
      const hide=await http('maker','post','/profile/change-requests',{expected_version:profile.lock_version,reason:'Sembunyikan profil sesudah semua publikasi tes diarsipkan.'},201);
      await decide('change_request',hide.id,'approve','Profil disposable tidak lagi memiliki publikasi aktif.');await cycle();
    }
    assert.equal((await http('maker','get','/profile')).state,'HIDDEN');
    assert.equal((await http('maker','post','/profile/public-observation')).last_success.state,'NOT_FOUND');
    const mediaRemoval=await http('maker','post',`/media/${photos[0].id}/change-requests`,{reason:'Foto tes tidak dipakai sesudah pengarsipan diterima pusat.'},201);
    const mediaRemovalCommand=await decide('change_request',mediaRemoval.id,'approve','Pemakaian foto telah selesai.');await cycle();
    assert.equal((await http('maker','get',`/media/${photos[0].id}/status`)).state,'REVOKED');
    checks.push(await rpc('lifecycle-proof',{expected:await lifecycleExpected(mediaRemovalCommand,mediaRemoval,'media',photos[0].id,publicMediaUrls.get(photos[0].id))}));
    assert.equal((await rpc('media-proof',{kind:'publication',sourceId:assets[0].id,mediaId:photos[0].id,revoked:true})).revokedDenied,true);
    checks.push({check:'private historical snapshot media stays readable after approval/new draft; unknown snapshot/media and signed-path tampering rejected; real API revocation still denies historical access',pass:true});
    checks.push({check:'real signed Control decisions archive all categories without hard delete, reject contact revoke while referenced, then revoke contact, hide profile and revoke released photo; actual SJ ACK and public absence',pass:true});
    checks.push({check:'real upload and ingest capture immutable installation origin; projection job version/checksum links to actual applied event',pass:true,...await rpc('job-provenance')});
    phase='cleanup';await rpc('stop');children.delete(peer);server.closeAllConnections();await new Promise(r=>server.close(r));await prisma.$disconnect();await require('../../modules/seputar-jaminan/reviewDatabase').disconnect();
    clearInterval(progressTimer);
    finished=true;process.send({type:'result',pass:true,checks,integration:cross.bankUiRoot&&cross.publicUiRoot?'real signed services and scoped three-UI journey; owned databases and separate runtime roles':cross.browserRoot?'real signed services and Control browser journey; no bank/public UI journey':'real Control/SJ services, separate roles/databases; real signed HTTP; not full browser/auth flow',integrationOrigin:central.origin,bankOrigin:origin},()=>process.disconnect());
  }catch(e){clearInterval(progressTimer);for(const child of children)child.kill();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}if(prisma)await prisma.$disconnect().catch(()=>{});await require('../../modules/seputar-jaminan/reviewDatabase').disconnect().catch(()=>{});finished=true;process.exitCode=1;process.send({type:'result',pass:false,phase,code:e.code||e.name,reason:String(e.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[database]').slice(0,800),location:String(e.stack).split('\n').filter(l=>l.includes('sj-cross-app')).join(';'),failure:safeHarnessError(e),checks},()=>process.disconnect());}
});
