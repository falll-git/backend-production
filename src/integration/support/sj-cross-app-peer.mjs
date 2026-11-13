// Real Control and SJ services with separate runtime roles/databases. IPC is
// harness orchestration only; no test-only route is exposed by either API.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import assert from 'node:assert/strict';import {createRequire,registerHooks} from 'node:module';import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';import net from 'node:net';
const {bankPath,controlPath,centralPath}=createRequire(import.meta.url)('./sj-peer-paths.js');
const bankRequire=createRequire(bankPath('package.json')),sjRequire=createRequire(centralPath('package.json'));
const {safeHarnessError}=bankRequire('./src/integration/support/sj-harness-error');
const {observeOwnedUiChild}=bankRequire('./src/integration/support/sj-owned-ui-child');
const {createOwnedUiLogs}=bankRequire('./src/integration/support/sj-owned-ui-logs');
const {probeOwnedUiHealth}=bankRequire('./src/integration/support/sj-owned-ui-health');
registerHooks({resolve(specifier,context,next){if(specifier==='next/server'||specifier==='next/headers')return next(specifier+'.js',context);if(specifier.startsWith('@/')){const base=path.join(controlPath(),specifier.slice(2));return {shortCircuit:true,url:pathToFileURL(fs.existsSync(base)?base:base+'.ts').href};}return next(specifier,context);}});
const load=p=>import(pathToFileURL(p).href);
let server,db,workerDb,limiter,worker,settings,actor,actorToken,browserServer,browserOwned,recoveryRuntime,closePromise;
process.on('disconnect',()=>{close().then(()=>process.exit(1),()=>process.exit(1));});
const reply=(id,value)=>process.send({id,pass:true,value});
const close=()=>closePromise??=(async()=>{
  if(browserOwned){
    let receipt,failure;
    try{receipt=await browserOwned.observer.stop();}catch(error){failure=error;receipt=error.receipt;}
    if(browserOwned.observer.closed){const logs=browserOwned.logs.close();
      fs.writeFileSync(path.join(browserOwned.out,'control-ui-cleanup.json'),JSON.stringify({runId:settings.proof.runId,
        pass:!failure,process:receipt??browserOwned.observer.receipt,logs},null,2),{flag:'wx'});
    }
    // Do not disconnect DBs or acknowledge peer cleanup under a live browser.
    if(failure)throw failure;
  }
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  if(db)await db.disconnect();if(workerDb)await workerDb.$disconnect();
  if(limiter)await limiter.disconnect();if(recoveryRuntime)await recoveryRuntime.disconnect();
  await globalThis.__ruwangControlPool?.end();
})();
process.on('message',async message=>{
  try{
    if(message.method==='start'){
      const {proof,cross,keys,scanner}=message.data;settings={proof,cross,keys};
      bankRequire('./src/integration/support/sj-disposable-guard').assertContainer(proof,proof.pg);
      const {Client}=bankRequire('pg');
      for(const [scope,url] of Object.entries({...cross.urls,control:cross.controlUrl})){
        const u=new URL(url);assert.equal(u.hostname,'127.0.0.1');assert.equal(Number(u.port),proof.pg.port);assert.equal(u.pathname,'/'+(scope==='control'?cross.controlDb:cross.centralDb));
        const c=new Client({connectionString:url});await c.connect();try{
          const r=(await c.query("SELECT current_database() db,current_user role,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,shobj_description(d.oid,'pg_database') marker FROM pg_roles r CROSS JOIN pg_database d WHERE r.rolname=current_user AND d.datname=current_database()")).rows[0];
          assert.equal(r.marker,'RA-SJ:'+proof.tokenHash);assert.equal(r.rolsuper,false);assert.equal(r.rolbypassrls,false);assert.equal(r.rolcreatedb,false);assert.equal(r.rolcreaterole,false);
          assert.equal((await c.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','control') AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)")).rows[0].n,0);
        }finally{await c.end();}
      }
      const {createDatabaseClients}=await load(centralPath("apps/api/src/database.ts"));
      db=createDatabaseClients({registryDatabaseUrl:cross.urls.registry,ingestDatabaseUrl:cross.urls.ingest,publicDatabaseUrl:cross.urls.public,opsDatabaseUrl:cross.urls.ops});
      workerDb=(await load(centralPath("apps/worker/src/database.ts"))).createWorkerDatabase(cross.urls.worker);
      const storage=new (await load(centralPath("packages/storage/src/filesystem.mjs"))).FilesystemStorageAdapter({root:path.join(proof.root,'storage','central')});
      const malware=(await load(centralPath("apps/worker/src/malware-scanner.ts"))).createMalwareScanner({mode:'CLAMAV',command:'clamdscan',dockerContainer:scanner});
      await malware.verifyReady();
      const eicar=Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}$','EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''));
      await assert.rejects(malware.scan(eicar),e=>e.code==='MALWARE_DETECTED');
      const logger=sjRequire('pino')({level:'silent'});
      worker=new (await load(centralPath("apps/worker/src/worker.ts"))).CentralWorker(workerDb,storage,malware,logger,10485760);
      limiter=new (await load(centralPath("apps/api/src/rate-limit.ts"))).RedisFixedWindowRateLimiter('redis://127.0.0.1:'+proof.redis.port+'/1');
      const express=bankRequire('express'),outer=express();
      server=await new Promise((resolve,reject)=>{const s=outer.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject);});
      const origin='http://127.0.0.1:'+server.address().port;
      settings.origin=origin;
      process.env.CONTROL_ENABLE_SJ_RECOVERY='true';
      const privateFile=path.join(proof.root,'tmp','control-key.pem');fs.writeFileSync(privateFile,keys.controlPrivateKey);
      Object.assign(process.env,{CONTROL_APP_ENV:'test',CONTROL_RELEASE:'test',CONTROL_DATABASE_URL:cross.controlUrl,CONTROL_DATABASE_NAME:cross.controlDb,CONTROL_DATABASE_RUNTIME_ROLE:cross.controlRole,CONTROL_PUBLIC_ORIGIN:origin,CONTROL_AUTH_ENCRYPTION_KEY:cross.controlEncryptionKey,CONTROL_ENABLE_BANK_INTEGRATION:'true',CONTROL_BANK_SIGNING_KEY_ID:'test-control',CONTROL_BANK_SIGNING_PRIVATE_KEY_FILE:privateFile});
      const {NextRequest}=await load(controlPath("node_modules/next/server.js"));
      const {acceptReviewSnapshot}=await load(controlPath("src/server/review-snapshot-ingress.ts"));
      outer.post('/api/internal/sj-review/snapshots',express.text({type:'*/*',limit:'64kb'}),async(req,res)=>{
        try{const r=await acceptReviewSnapshot(new NextRequest(origin+req.originalUrl,{method:'POST',headers:req.headers,body:req.body}));res.status(202).set(r.headers).send(r.body);}
        catch(e){res.status(e.status||500).json({error:{code:e.code||'SNAPSHOT_FAILED'}});}
      });
      const config={nodeEnv:'test',publicApiBaseUrl:origin,publicMediaBaseUrl:origin+'/v1/public/media',uploadSessionTtlSeconds:300,storage:{provider:'FILESYSTEM'},security:{eventBodyMaxBytes:262144,signatureToleranceSeconds:300,nonceTtlSeconds:600,mediaFileMaxBytes:10485760,mediaTotalMaxBytes:52428800,opsEncryptionKeyBase64:crypto.randomBytes(32).toString('base64'),opsSessionSecret:crypto.randomBytes(32).toString('hex')},rateLimit:{ingestPerMinute:600,publicPerMinute:600,opsAuthPerMinute:10},flags:{ingest:true,mediaUpload:true,publicSite:true}};
      // URL contract only: reserved test origin, never visited or presented as a live site.
      config.publicWebsiteOrigin='https://catalog.example.invalid';
      config.flags.controlRecovery=true;
      config.controlRecovery={bindings:[],audience:'sj-cross-recovery',responseKeyId:'test-sj-jobs',responsePrivateKey:keys.bankPrivateKey};
      recoveryRuntime=new (await load(centralPath('apps/api/src/monitoring-runtime.ts'))).RedisMonitoringRuntime('redis://127.0.0.1:'+proof.redis.port+'/1');
      // Owned test transport fault AFTER the real SJ handler commits. There is
      // no production fault endpoint; IPC can only affect this run's ingest.
      outer.use('/v1/ingest/events',(req,res,next)=>{
        const mode=settings.ingestTransportFault;
        if(!mode){next();return;}
        const end=res.end;
        res.end=function(...args){
          if(res.statusCode>=400)return end.apply(this,args);
          if(mode==='disconnect'){this.destroy();return this;}
          if(mode==='timeout'){setTimeout(()=>{if(!this.destroyed)end.apply(this,args);},750).unref();return this;}
          this.removeHeader('content-length');
          return end.call(this,'{}');
        };
        next();
      });
      outer.use((await load(centralPath("apps/api/src/app.ts"))).createApp({config,databases:db,storage,ingestLimiter:limiter,publicLimiter:limiter,logger,monitoringRuntime:recoveryRuntime}));
      const ops=new (await load(centralPath("apps/api/src/ops-service.ts"))).OpsService(db);
      const principal={id:cross.opsPrincipal,email:proof.runId+'@example.invalid',displayName:'Owned test principal',sessionId:crypto.randomUUID()};
      const keyId=crypto.randomUUID(),slug='cross-'+proof.runId;
      const onboarded=await ops.onboard({legal_name_internal:'Isolated bank '+proof.runId,public_slug:slug,installation_name:'Owned test',public_key:keys.bankPublicKey,key_id:keyId},principal,crypto.randomUUID());
      Object.assign(settings,{ops,opsPrincipal:principal,institutionId:onboarded.subject_id,quarantines:new Set()});
      const key=await db.ops.institutionKey.findUniqueOrThrow({where:{keyId}});
      settings.instanceId=key.installationId;
      config.controlRecovery.bindings.push({instanceId:key.installationId,institutionId:onboarded.subject_id,installationId:key.installationId,keyId:'test-control',publicKey:crypto.createPublicKey(keys.controlPrivateKey).export({type:'spki',format:'pem'}).toString()});
      Object.assign(settings,{storage,malware,logger,recoveryConfig:config.controlRecovery});
      const recoveryBinding={url:origin,audience:'sj-cross-recovery',institutionId:onboarded.subject_id,installationId:key.installationId,keyId:'test-sj-jobs',publicKey:keys.bankPublicKey};
      reply(message.id,{origin,institutionId:onboarded.subject_id,instanceId:key.installationId,keyId,slug,recoveryBinding,scanner:'CLAMAV clean+EICAR verified',runtimeRoles:6});
    }else if(message.method==='transport-fault'){
      assert.ok([null,'disconnect','timeout','corrupt'].includes(message.data.mode));
      settings.ingestTransportFault=message.data.mode;reply(message.id,true);
    }else if(message.method==='event-proof'){
      reply(message.id,await (await import('./sj-real-central-proof.mjs')).eventProof({load,centralPath,db,settings,...message.data}));
    }else if(message.method==='decision-proof'){
      reply(message.id,await (await import('./sj-control-decision-proof.mjs')).decisionProof({load,controlPath,settings,actor,...message.data}));
    }else if(message.method==='dispatcher-crash-proof'){
      reply(message.id,await (await import('./sj-real-control-dispatcher-proof.mjs')).dispatcherCrashProof({load,controlPath,bankPath,settings,actor,...message.data}));
    }else if(message.method==='central-proof'){
      reply(message.id,await (await import('./sj-real-central-proof.mjs')).centralProof({load,centralPath,db,workerDb,worker,settings,...message.data}));
    }else if(message.method==='central-worker-proof'){
      reply(message.id,await (await import('./sj-real-central-worker-proof.mjs')).centralWorkerProof({load,centralPath,db,workerDb,worker,settings,...message.data}));
    }else if(message.method==='lifecycle-proof'){
      reply(message.id,await (await import('./sj-real-lifecycle-proof.mjs')).lifecycleProof({load,centralPath,controlPath,db,settings,actor,...message.data}));
    }else if(message.method==='job-provenance'){
      const {withInstitution}=await load(centralPath('apps/api/src/database.ts'));
      const result=await withInstitution(db.ingest,settings.institutionId,async tx=>{
        const jobs=await tx.centralJob.findMany({where:{institutionId:settings.institutionId}});
        const media=await tx.mediaObject.findMany({where:{institutionId:settings.institutionId}});
        assert.ok(jobs.length>0&&media.length>0);
        for(const item of [...jobs,...media])assert.equal(item.originInstallationId,settings.instanceId);
        const projections=jobs.filter(j=>j.jobType==='REBUILD_PUBLICATION_PROJECTION');assert.ok(projections.length>=4);
        for(const job of projections){
          const event=await tx.ingestEvent.findUniqueOrThrow({where:{eventId:job.payload.event_id}});
          assert.equal(event.installationId,job.originInstallationId);assert.equal(event.aggregateVersion,job.payload.aggregate_version);
          assert.equal(event.payloadChecksum,job.payload.payload_checksum);assert.equal(event.state,'APPLIED');
        }
        return {jobs:jobs.length,media:media.length,projectionJobs:projections.length};
      });
      reply(message.id,result);
    }else if(message.method==='drain'){
      for(let i=0;i<50;i++)if(!await worker.runOnce()){reply(message.id,true);return;}throw Error('CENTRAL_QUEUE_NOT_DRAINED');
    }else if(message.method==='renew-performance-session'){
      assert.equal(settings.cross.performance,true);assert.ok(actor&&actorToken);
      bankRequire('./src/integration/support/sj-disposable-guard').assertContainer(settings.proof,settings.proof.pg);
      bankRequire('./src/integration/support/sj-disposable-guard').assertContainer(settings.proof,settings.proof.redis);
      const auth=await load(controlPath('src/server/auth/service.ts'));
      const config=(await load(controlPath('src/lib/env.ts'))).getRuntimeConfig();
      assert.equal(config.CONTROL_DATABASE_NAME,settings.cross.controlDb);
      assert.equal(config.CONTROL_DATABASE_RUNTIME_ROLE,settings.cross.controlRole);
      const renewed=await bankRequire('./src/integration/support/sj-fixture-control-session').renewFixtureControlSession({
        auth,config,actor,token:actorToken,reason:message.data.reason,
        credentials:{username:'reviewer-'+settings.proof.runId,password:settings.cross.browserPassword},
        context:()=>({requestId:crypto.randomUUID(),ipHash:null,userAgentHash:null})});
      actor=renewed.actor;actorToken=renewed.token;reply(message.id,renewed.receipt);
    }else if(message.method==='decide'||message.method==='prepare-review'){
      if(!actor){
        const auth=await load(controlPath('src/server/auth/service.ts'));
        const config=(await load(controlPath('src/lib/env.ts'))).getRuntimeConfig();
        const context=()=>({requestId:crypto.randomUUID(),ipHash:null,userAgentHash:null});
        const bootstrap=await auth.loginOperator({username:'bootstrap-'+settings.proof.runId,password:settings.cross.bootstrapPassword},context(),config);
        await auth.createOperator({actor:bootstrap.session,username:'reviewer-'+settings.proof.runId,displayName:'Reviewer isolated',password:settings.cross.browserPassword,requestId:crypto.randomUUID()});
        const login=await auth.loginOperator({username:'reviewer-'+settings.proof.runId,password:settings.cross.browserPassword},context(),config);
        actor=login.session;actorToken=login.token;
        assert.deepEqual(actor.principal.grants.map(g=>g.role),['internal_operator']);
      }
      const {kind,sourceId,decision='approve',reason}=message.data;
      const {query}=await load(controlPath("src/server/database.ts"));
      const rows=await query('SELECT id::text FROM control.review_snapshots WHERE instance_id=$1 AND resource_kind=$2 AND source_id=$3 ORDER BY source_version DESC,submitted_at DESC LIMIT 1',[settings.instanceId,kind,sourceId]);assert.equal(rows.length,1,'real Control snapshot must arrive');
      const reviews=await load(controlPath("src/server/reviews.ts")),review=await reviews.getReviewDetail(actor.principal,rows[0].id);
      const media=kind==='profile'?[review.detail.logo]:Array.isArray(review.detail.media)?review.detail.media:[];
      for(const item of media.filter(Boolean).slice(0,1)){
        const content=await reviews.getReviewMedia(actor.principal,settings.instanceId,review.id,item.source_media_id);
        assert.match(content.mime,/^image\//);assert.ok(content.body.length>10);
        settings.privateMediaVerified=true;
      }
      if(message.method==='prepare-review'){reply(message.id,{reviewId:review.id,instanceId:review.instanceId,sourceVersion:review.sourceVersion});return;}
      const adapter=await load(controlPath("src/server/review-adapter.ts"));
      const commandId=crypto.randomUUID();await adapter.enqueueReviewDecision({commandId,instanceId:settings.instanceId,reviewId:review.id,decision,reason:reason||'',expectedVersion:review.sourceVersion,expectedChecksum:review.checksum,requestId:crypto.randomUUID(),actor});
      assert.equal((await adapter.getReviewCommand(settings.instanceId,commandId)).state,'PENDING');
      if(message.data.unsignedAck){
        // Negative transport fault only. The real bank applies the command;
        // removing its response signature must not create success in Control.
        const originalFetch=globalThis.fetch;
        const {transportHeaderNames}=await load(controlPath("src/domain/control-review-contract.ts"));
        globalThis.fetch=async(...args)=>{
          const response=await originalFetch(...args);
          const headers=new Headers(response.headers);headers.delete(transportHeaderNames.acknowledgmentSignature);
          return new Response(await response.arrayBuffer(),{status:response.status,headers});
        };
        try{await assert.rejects(adapter.dispatchReviewCommand(commandId),e=>e.code==='BANK_ACK_SIGNATURE_INVALID');}
        finally{globalThis.fetch=originalFetch;}
        assert.equal((await adapter.getReviewCommand(settings.instanceId,commandId)).state,'UNKNOWN');
        assert.equal((await query('SELECT state FROM control.review_snapshots WHERE id=$1',[review.id]))[0].state,'IN_REVIEW');
        const attempts=await query('SELECT id::text FROM control.review_dispatch_attempts WHERE command_id=$1',[commandId]);
        assert.equal(attempts.length,1);
        // The current contract forbids retrying UNKNOWN without bank-ledger evidence.
        // Prove repeated dispatch does not even issue a network request.
        let calls=0;globalThis.fetch=async()=>{calls++;throw Error('UNCERTAIN_COMMAND_MUST_NOT_RESEND');};
        try{for(const r of await Promise.all([adapter.dispatchReviewCommand(commandId),adapter.dispatchReviewCommand(commandId)]))assert.equal(r.state,'UNKNOWN');}
        finally{globalThis.fetch=originalFetch;}
        assert.equal(calls,0);
        assert.deepEqual(await query('SELECT id::text FROM control.review_dispatch_attempts WHERE command_id=$1',[commandId]),attempts);
        settings.unsignedAckVerified=true;
        reply(message.id,{commandId,state:'UNKNOWN',reviewId:review.id});return;
      }
      const applied=await adapter.dispatchReviewCommand(commandId);assert.equal(applied.state,'APPLIED',applied.result_code);
      const attempts=await query('SELECT id::text FROM control.review_dispatch_attempts WHERE command_id=$1',[commandId]);
      assert.equal((await adapter.dispatchReviewCommand(commandId)).state,'APPLIED');
      assert.deepEqual(await query('SELECT id::text FROM control.review_dispatch_attempts WHERE command_id=$1',[commandId]),attempts);
      assert.equal((await query('SELECT state FROM control.review_snapshots WHERE id=$1',[review.id]))[0].state,decision==='approve'?'APPROVED':decision==='reject'?'REJECTED':'REVISION_REQUIRED');
      settings.repeatDispatchVerified=true;
      reply(message.id,{commandId,state:applied.state,reviewId:review.id});
    }else if(message.method==='reconcile'){
      const adapter=await load(controlPath('src/server/review-adapter.ts'));
      const {query}=await load(controlPath('src/server/database.ts'));
      const input={commandId:message.data.commandId,instanceId:settings.instanceId,actor,requestId:crypto.randomUUID()};
      const before=await query('SELECT id::text FROM control.review_dispatch_attempts WHERE command_id=$1',[input.commandId]);
      const originalFetch=globalThis.fetch;
      const {transportHeaderNames}=await load(controlPath('src/domain/control-review-contract.ts'));
      let calls=0;
      globalThis.fetch=async(...args)=>{calls++;const r=await originalFetch(...args);const headers=new Headers(r.headers);headers.delete(transportHeaderNames.acknowledgmentSignature);return new Response(await r.arrayBuffer(),{status:r.status,headers});};
      try{await assert.rejects(adapter.reconcileReviewCommand(input),e=>e.code==='BANK_RESULT_INVALID');}finally{globalThis.fetch=originalFetch;}
      assert.equal(calls,1);assert.equal((await adapter.getReviewCommand(settings.instanceId,input.commandId)).state,'UNKNOWN');
      await assert.rejects(adapter.reconcileReviewCommand({...input,instanceId:crypto.randomUUID()}));
      const results=await Promise.all([adapter.reconcileReviewCommand(input),adapter.reconcileReviewCommand({...input,requestId:crypto.randomUUID()})]);
      for(const r of results)assert.equal(r.state,'APPLIED');
      assert.deepEqual(await query('SELECT id::text FROM control.review_dispatch_attempts WHERE command_id=$1',[input.commandId]),before);
      // The failed transport attempt remains part of the audit, not rewritten as delivered.
      assert.equal((await query('SELECT state FROM control.review_dispatch_attempts WHERE command_id=$1',[input.commandId]))[0].state,'UNKNOWN');
      reply(message.id,{state:(await adapter.getReviewCommand(settings.instanceId,input.commandId)).state});
    }else if(message.method==='recovery-proof'){
      reply(message.id,await (await import('./sj-control-recovery-peer.mjs')).controlRecoveryProof({load,controlPath,settings,actor,jobId:message.data.jobId}));
    }else if(message.method==='processing-recovery-proof'){
      reply(message.id,await (await import('./sj-processing-recovery-proof.mjs')).processingRecoveryProof({load,centralPath,controlPath,db,workerDb,worker,settings,actor,sourceMediaId:message.data.sourceMediaId}));
    }else if(message.method==='adapter-proof'){
      assert.equal(settings.privateMediaVerified,true);assert.equal(settings.unsignedAckVerified,true);assert.equal(settings.repeatDispatchVerified,true);
      reply(message.id,true);
    }else if(message.method==='review'){
      const r=await (await load(controlPath("src/server/reviews.ts"))).getReviewDetail(actor.principal,message.data.reviewId);
      // Control no longer owns public checking; verify absence, not a synthetic result.
      for(const field of ['publicObservation','publicVisibility','publicEvidence'])assert.ok(!(field in r));
      reply(message.id,{commandState:r.commandState,sourceVersion:r.sourceVersion,state:r.state,kind:r.kind});
    }else if(message.method==='media-proof'){
      const reviews=await load(controlPath('src/server/reviews.ts'));
      const {query}=await load(controlPath('src/server/database.ts'));
      const reviewId=message.data.reviewId || (await query('SELECT id::text FROM control.review_snapshots WHERE instance_id=$1 AND resource_kind=$2 AND source_id=$3 ORDER BY source_version DESC LIMIT 1',[settings.instanceId,message.data.kind,message.data.sourceId]))[0].id;
      const mediaId=message.data.mediaId;
      if(message.data.revoked){
        await assert.rejects(reviews.getReviewMedia(actor.principal,settings.instanceId,reviewId,mediaId),e=>e.code==='BANK_MEDIA_HTTP_404');
        reply(message.id,{revokedDenied:true});return;
      }
      const bytes=await reviews.getReviewMedia(actor.principal,settings.instanceId,reviewId,mediaId);
      assert.ok(bytes.body.length>10);assert.match(bytes.mime,/^image\//);
      const c=await load(controlPath('src/domain/control-review-contract.ts'));
      const instance=(await query('SELECT adapter_base_url FROM control.instances WHERE id=$1',[settings.instanceId]))[0];
      const get=async(path,actualPath=path)=>{
        const timestamp=new Date().toISOString(),nonce=crypto.randomUUID(),digest=c.sha256Hex('');
        return fetch(new URL(actualPath,instance.adapter_base_url),{headers:{
          [c.transportHeaderNames.instanceId]:settings.instanceId,[c.transportHeaderNames.keyId]:'test-control',
          [c.transportHeaderNames.timestamp]:timestamp,[c.transportHeaderNames.nonce]:nonce,
          [c.transportHeaderNames.contentSha256]:digest,[c.transportHeaderNames.signature]:c.signTransport(c.createTransportSigningMessage({method:'GET',path,timestamp,nonce,contentSha256:digest}),settings.keys.controlPrivateKey)}});
      };
      const valid=`/api/v1/internal/ruwang-control/sj-review/snapshots/${reviewId}/media/${mediaId}`;
      const foreign=valid.replace(reviewId,crypto.randomUUID());
      for(const path of [foreign,valid.replace(mediaId,crypto.randomUUID())]){const r=await get(path);assert.equal(r.status,404);await r.arrayBuffer();}
      const tampered=await get(valid,foreign);assert.equal(tampered.status,401);await tampered.arrayBuffer();
      reply(message.id,{historicalMedia:true,unknownSnapshotDenied:true,unrelatedMediaDenied:true,signedPathBound:true});
    }else if(message.method==='eligibility'){
      // IPC-only orchestration after owned DB/role verification. Positive state
      // transitions call the real ops service; no application test endpoint.
      const {action,referenceCode,subjectType,quarantineId}=message.data;
      const reason={reason_code:'OWNED_LIFECYCLE_TEST',safe_detail:'Disposable integration scenario'};
      if(['suspend','reactivate'].includes(action)){
        reply(message.id,await settings.ops.setInstitutionState(settings.institutionId,action==='suspend'?'SUSPENDED':'ACTIVE',reason,settings.opsPrincipal,crypto.randomUUID()));
      }else if(action==='resolve'){
        assert.ok(settings.quarantines.has(quarantineId),'quarantine must belong to this test');
        const result=await settings.ops.resolveQuarantine(quarantineId,settings.opsPrincipal,crypto.randomUUID());settings.quarantines.delete(quarantineId);reply(message.id,result);
      }else{
        assert.ok(['quarantine','expire-confirmation'].includes(action));
        const publication=await db.ops.publication.findFirstOrThrow({where:{institutionId:settings.institutionId,publicReferenceCode:referenceCode}});
        if(action==='expire-confirmation'){
          // Explicit negative time fault, not a positive business transition.
          // No state/checksum/version is changed and no SQL restore is used.
          assert.equal(publication.state,'PUBLISHED');
          await db.ops.publication.update({where:{id:publication.id},data:{lastConfirmedAt:new Date(Date.now()-172800000),nextReconfirmationAt:new Date(Date.now()-86400000)}});
          reply(message.id,{fault:'confirmation-deadline-in-past',stateUnchanged:true});
        }else{
          assert.ok(['PROFILE','PUBLICATION','MEDIA'].includes(subjectType));
          // Ops intentionally has no publication_media grant. Resolve the
          // eligible cover through the existing public-read role, then verify
          // its ownership with ops before using the real quarantine service.
          let mediaObjectId;
          if(subjectType==='MEDIA'){
            const cover=await db.publicRead.publicationMedia.findFirstOrThrow({where:{publicationId:publication.id,isCover:true}});
            mediaObjectId=cover.mediaObjectId;
            await db.ops.mediaObject.findFirstOrThrow({where:{id:mediaObjectId,institutionId:settings.institutionId}});
          }
          const subjectId=subjectType==='PROFILE'?publication.profileId:subjectType==='PUBLICATION'?publication.id:mediaObjectId;
          assert.ok(subjectId,'owned quarantine target required');
          const result=await settings.ops.quarantine({institution_id:settings.institutionId,subject_type:subjectType,subject_id:subjectId,...reason},settings.opsPrincipal,crypto.randomUUID());
          settings.quarantines.add(result.subject_id);reply(message.id,result);
        }
      }
    }else if(message.method==='browser'){
      assert.ok(settings.cross.browserRoot);assert.ok(!browserServer);
      const port=4320;
      await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
      const origin='http://127.0.0.1:'+port;
      const out=path.join('C:/Users/falll/Documents/Codex/2026-09-13/https-seputarjaminan-ruwangarsip-com-https-seputarjaminan','output/playwright/cross-app-'+settings.proof.runId);
      fs.mkdirSync(out,{recursive:true});
      const secrets=[settings.cross.bootstrapPassword,settings.cross.browserPassword,settings.cross.browserBankPassword,
        settings.cross.controlEncryptionKey,...Object.values(settings.cross.urls),...Object.values(settings.keys),
        ...Object.entries(process.env).filter(([key])=>/PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL|REDIS_URL/.test(key)).map(([,value])=>value)];
      const logs=createOwnedUiLogs({directory:out,label:'control-ui',secrets});
      try{browserServer=spawn(process.execPath,[controlPath("node_modules/next/dist/bin/next"),'start','--hostname','127.0.0.1','--port',String(port)],{cwd:path.join(settings.cross.browserRoot,'app'),env:{...process.env,NODE_ENV:'production',CONTROL_PUBLIC_ORIGIN:origin},windowsHide:true,stdio:['ignore','pipe','pipe']});}
      catch(error){logs.close();throw error;}
      browserOwned={observer:observeOwnedUiChild(browserServer,{onStdout:logs.stdout,onStderr:logs.stderr}),logs,out};
      for(let i=0;i<100;i++){assert.equal(browserServer.exitCode,null,'Control browser runtime exited');try{const status=await probeOwnedUiHealth(port);if(status>=200&&status<300){reply(message.id,{origin});return;}}catch{}await new Promise(r=>setTimeout(r,200));}throw Error('CONTROL_BROWSER_NOT_READY');
    }else if(message.method==='stop'){await close();reply(message.id,true);process.disconnect();process.exit(0);}
    else throw Error('UNKNOWN_IPC_ACTION');
  }catch(e){const failure=safeHarnessError(e);process.send({id:message.id,pass:false,code:failure.code||failure.name,reason:'Peer operation failed; safe diagnostic retained',failure});}
});
