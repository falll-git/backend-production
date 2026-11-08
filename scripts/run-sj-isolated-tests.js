// Creates a NEW container pair per run. Never accepts external database credentials.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, fork } = require('node:child_process');
const { Client } = require('pg');
const { docker, digest, assertContainer, pinLocalDocker, cleanupStorage } = require('../src/integration/support/sj-disposable-guard');
const {createOwnedContainer,cleanupOwnedContainer} = require('../src/integration/support/sj-owned-container-create');
const repo = path.resolve(__dirname, '..');
const {controlPath, centralPath} = require('../src/integration/support/sj-peer-paths');
const {scannerSelection, prepareScanner, startScanner, cleanupScanner, recoverScanner} = require('../src/integration/support/sj-scanner-proof');
const {observeOwnedScenario}=require('../src/integration/support/sj-owned-scenario');
const delay = ms => new Promise(r => setTimeout(r, ms));
const secret = () => crypto.randomBytes(32).toString('hex');
const baseEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','USERPROFILE','DOCKER_HOST','DOCKER_CONTEXT'].includes(k)));
const browserRun = () => process.argv.includes('--cross-app-browser') || process.argv.includes('--cross-app-performance');
const performanceRun = () => process.argv.includes('--cross-app-performance');

function scenarioTimeout(workflow, browser = false, performance = false) {
  // Real-service fault journeys include killed worker processes, recovery,
  // competing reviewers and transaction rollback. Keep all assertions bounded.
  // Performance adds 28 distinct real uploads, bounded read workloads and
  // notification-poll observation windows and 18 finite UI probes. An actual
  // 45-minute local run completed only 12 probes before its process deadline;
  // reserve 60 minutes for the full scenario plus lawful fixture transitions.
  // Individual read/action/drain deadlines and all failures remain unchanged.
  // This opt-in runner budget does not alter application auth/session TTLs.
  // Step6 includes all four initial creations, actual UI lifecycle, negative
  // interaction states and a bounded main-agent visual handoff. This is not
  // a change to application/session TTLs or the separate performance workload.
  if (workflow === 'cross-app') return performance ? 3600000 : browser ? 3600000 : 1200000;
  // The full bank-only workflow includes 105 API submissions, eight real
  // worker cycles and deep pagination. Keep all assertions and a finite budget;
  // concurrent production builds exhausted the previous five-minute budget.
  return workflow ? 900000 : 120000;
}

// This protocol is only available on the runner's inherited IPC channel. A
// parent cannot cancel another run by naming a container/database: both proof
// identifiers must match this run. Resource removal remains in main's finally.
function attachOwnedCancellation(channel, proof, stopScenario) {
  let cancelled = false;
  const notify = type => {
    if (channel.connected && typeof channel.send === 'function') {
      channel.send({type, runId:proof.runId, tokenHash:proof.tokenHash}, () => {});
    }
  };
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    stopScenario();
    notify('owned-run-cancellation-accepted');
  };
  const message = value => {
    if (value?.type === 'cancel-owned-run' && value.runId === proof.runId && value.tokenHash === proof.tokenHash &&
        ['aborted', 'timeout'].includes(value.reason)) cancel();
  };
  const disconnected = () => cancel();
  channel.on('message', message); channel.on('disconnect', disconnected);
  return {
    get cancelled() { return cancelled; },
    check() { if (cancelled) throw new Error('OWNED_RUN_CANCELLED'); },
    beginCleanup() { notify('owned-run-cleanup-started'); },
    dispose() { channel.off('message', message); channel.off('disconnect', disconnected); },
  };
}

function sourceManifest() {
  const files=execFileSync('git',[...(process.platform==='win32'?['-c','core.longpaths=true']:[]),'ls-files','--cached','--others','--exclude-standard','-z'],{cwd:repo,encoding:'utf8',windowsHide:true}).split('\0').filter(Boolean);
  return [...new Set(files)].filter(f=>/^(src\/|scripts\/|prisma\/|vendor\/|package(?:-lock)?\.json$|prisma\.config\.ts$)/.test(f)&&!/\.env(?:\.|$)/.test(f)).sort().map(file=>({file,sha256:digest(fs.readFileSync(path.join(repo,file)))}));
}

function peerManifest(){
  const files=[];
  for(const [root,entries] of [[controlPath(),['src','app','components','contracts','migrations','scripts','package.json','package-lock.json']],[centralPath(),['apps/api/src','apps/worker/src','packages','prisma','infra/postgres','package.json','package-lock.json']]]){
    const walk=relative=>{const p=path.join(root,relative);if(fs.statSync(p).isDirectory()){for(const n of fs.readdirSync(p).sort())if(!['node_modules','dist'].includes(n))walk(relative+'/'+n);}else if(!/\.env(?:\.|$)/.test(relative))files.push({root,file:relative,sha256:digest(fs.readFileSync(p))});};
    entries.forEach(walk);
  }return files;
}

function recoverOwnedRun(proofPath) {
  const proof=JSON.parse(fs.readFileSync(proofPath,'utf8'));
  if(path.resolve(proofPath)!==path.join(path.resolve(proof.root),'proof.json'))throw Error('PROOF_PATH_MISMATCH');
  const marker=JSON.parse(fs.readFileSync(path.join(proof.root,'owner.json'),'utf8'));
  if(marker.runId!==proof.runId||marker.tokenHash!==proof.tokenHash)throw Error('OWNER_MISMATCH');
  if(typeof proof.dockerEndpoint!=='string')throw Error('RECOVERY_ENGINE_PIN_MISSING_REQUIRES_EXPLICIT_LEGACY_REVIEW');
  if(pinLocalDocker()!==proof.dockerEndpoint)throw Error('RECOVERY_ENGINE_PIN_MISMATCH');
  if(proof.parentPid){
    try { process.kill(proof.parentPid,0); throw Error('RUN_PARENT_STILL_ALIVE'); }
    catch(e){if(e.code!=='ESRCH')throw e;}
  }
  const cleanup=[];
  for(const kind of ['redis','pg'])if(proof[kind]){
    if(proof[kind].creationAttempted===true){
      const result=cleanupOwnedContainer({proof,kind,env:baseEnv(),persist:()=>fs.writeFileSync(proofPath,JSON.stringify(proof,null,2))});
      cleanup.push(result);
      if(!result.removed)throw Error('OWNED_CLEANUP_UNCERTAIN');
      continue;
    }
    const ids=docker(['ps','-a','--no-trunc','--format','{{.ID}}']).split(/\r?\n/);
    if(ids.includes(proof[kind].id)){
      assertContainer(proof,proof[kind],undefined,true);docker(['rm','-f','-v',proof[kind].id]);
    }
    cleanup.push({kind,removed:true});
  }
  if(proof.scannerOwned && proof.scanner){
    const ids=docker(['ps','-a','--no-trunc','--format','{{.ID}}']).split(/\r?\n/);
    if(proof.scanner.creationAttempted===true||ids.includes(proof.scanner.id))recoverScanner(proof.scanner,{onResolved:selection=>{proof.scanner=selection;fs.writeFileSync(proofPath,JSON.stringify(proof,null,2));}});
    cleanup.push({kind:'run-owned scanner',removed:true});
  }
  cleanup.push({kind:'run-owned storage',removed:cleanupStorage(proof)});
  fs.writeFileSync(path.join(proof.root,'recovery.json'),JSON.stringify({at:new Date().toISOString(),cleanup},null,2));
  console.log(JSON.stringify({recovered:proof.runId,cleanup}));
}

async function main(workflow = false) {
  const diagnosticSelection=process.env.SJ_TEST_CATALOG_CANCEL_DIAGNOSTIC;
  if(diagnosticSelection!==undefined&&(diagnosticSelection!=='1'||!performanceRun()))throw Error('CATALOG_DIAGNOSTIC_REQUIRES_EXPLICIT_PERFORMANCE_RUN');
  // Browser-only and performance use an explicitly pinned, already-installed
  // toolchain. Reject missing/drifted resolution before any owned mutation;
  // do not let npx download a different CLI during a measured run.
  const {browserToolchain,browserSelection}=require('../src/integration/support/sj-browser-run-config')
    .resolveBrowserRunConfig({browser:browserRun(),performance:performanceRun(),env:process.env});
  scannerSelection(); // Reject partial/external scanner configuration before even Docker reads or mkdir.
  const dockerEndpoint=pinLocalDocker(); // One literal local engine inherited by every child/CLI.
  const scannerPlan=workflow==='cross-app'?prepareScanner():null;
  const {source:controlSchema}=await require('../src/integration/support/sj-contract-double').loadControlSchema();
  const runId = crypto.randomBytes(16).toString('hex');
  const token = secret(), adminPassword = secret(), appPassword = secret(), workerPassword = secret(), reviewPassword = secret();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-sj-02-'));
  const proof = { kind:'RA-SJ-02-disposable-v1', runId, tokenHash:digest(token), root, database:'sj_run_' + runId, parentPid:process.pid, createdAt:new Date().toISOString(), dockerEndpoint };
  const report = { runId, root, status:'running', controlSchema, integration:workflow==='cross-app'?(browserRun()?'real service integration with owned databases; browser results reported by executed journey, not inferred':'real Control/SJ services with owned databases; no browser/operator authentication claim'):'local contract double, NOT real Control/SJ', checks:[], cleanup:[] };
  const save = () => { fs.writeFileSync(path.join(root,'proof.json'),JSON.stringify(proof,null,2)); fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2)); };
  fs.writeFileSync(path.join(root,'owner.json'),JSON.stringify({runId,tokenHash:proof.tokenHash}));
  for (const d of ['storage','uploads','tmp']) fs.mkdirSync(path.join(root,d));
  let admin, activeScenario, ownedUiCloseUnconfirmed=false;const paused=new Set();
  const cancellation = attachOwnedCancellation(process, proof, () => {
    // The scenario's existing disconnect handler stops its tracked peer/worker
    // children. Do not SIGTERM the runner: it must execute owned cleanup first.
    if (activeScenario?.connected) activeScenario.send({type:'abort-owned-scenario',runId:proof.runId,tokenHash:proof.tokenHash},()=>{});
  });
  save(); console.log(JSON.stringify({runId,evidence:root,status:'starting'}));
  try {
    cancellation.check();
    let scanner;
    if(scannerPlan){
      proof.scannerOwned=scannerPlan.owned;
      scanner=await startScanner(scannerPlan,{onAttempt:selection=>{proof.scanner=selection;report.scanner=selection;save();},onCreated:selection=>{proof.scanner=selection;report.scanner=selection;save();},
        wait:async ms=>{cancellation.check();await delay(ms);cancellation.check();}});
      proof.scanner=scannerPlan.selection;report.scanner={...scannerPlan.selection,ownedByThisRun:scannerPlan.owned};save();
    }
    cancellation.check();
    report.sourceManifest=sourceManifest();save();
    if(workflow==='cross-app'){report.peerManifest=peerManifest();save();}
    for (const kind of ['pg','redis']) {
      cancellation.check();
      createOwnedContainer({proof,kind,env:{...baseEnv(),POSTGRES_PASSWORD:adminPassword,POSTGRES_DB:proof.database},performance:performanceRun(),persist:save});
      assertContainer(proof,proof[kind]);
    }
    const url = (user,password) => `postgresql://${user}:${password}@127.0.0.1:${proof.pg.port}/${proof.database}`;
    for (let i=0;i<60;i++) {
      cancellation.check();
      const candidate = new Client({connectionString:url('postgres',adminPassword),connectionTimeoutMillis:1000});
      try { await candidate.connect(); admin=candidate; break; } catch { await candidate.end().catch(()=>{}); await delay(300); }
    }
    if (!admin) throw new Error('ISOLATED_POSTGRES_NOT_READY');
    cancellation.check();
    // Infrastructure provisioning only; business services never receive this credential.
    await admin.query(`CREATE ROLE ruwang_arsip_app NOLOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE ruwang_sj_worker NOLOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE sj_test_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; CREATE ROLE sj_test_worker LOGIN PASSWORD '${workerPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; GRANT ruwang_arsip_app TO sj_test_app; GRANT ruwang_sj_worker TO sj_test_worker; CREATE SCHEMA sj_test_guard; REVOKE ALL ON SCHEMA sj_test_guard FROM PUBLIC; CREATE TABLE sj_test_guard.owner(run_id text NOT NULL, token_hash text NOT NULL); GRANT USAGE ON SCHEMA sj_test_guard TO sj_test_app,sj_test_worker; GRANT SELECT ON sj_test_guard.owner TO sj_test_app,sj_test_worker;`);
    await admin.query('INSERT INTO sj_test_guard.owner VALUES ($1,$2)',[runId,proof.tokenHash]);
    const migrationEnv = {...baseEnv(),NODE_ENV:'test',MIGRATION_DATABASE_URL:url('postgres',adminPassword)};
    const migrations = fs.readdirSync(path.join(repo,'prisma/migrations')).filter(n=>fs.existsSync(path.join(repo,'prisma/migrations',n,'migration.sql'))).sort();
    report.migrationChecksums=migrations.map(name=>({name,sha256:digest(fs.readFileSync(path.join(repo,'prisma/migrations',name,'migration.sql')))}));
    const baseline=workflow==='upgrade'?require('../src/integration/support/sj-upgrade-proof').prepareBaseline(repo,root,migrations):null;
    // cwd is the run root: loadEnv cannot read the repository .env.
    for (const command of ['deploy','status']) {
      cancellation.check();
      try {
        const output=execFileSync(process.execPath,[path.join(repo,'node_modules/prisma/build/index.js'),'migrate',command,'--config',baseline?.config||path.join(repo,'prisma.config.ts')],{cwd:root,env:migrationEnv,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:180000});
        fs.writeFileSync(path.join(root,`migrate-${command}.log`),output.replaceAll(adminPassword,'[redacted]'));
      } catch(e) { fs.writeFileSync(path.join(root,`migrate-${command}.log`),String(e.stdout||'').concat(String(e.stderr||'')).replaceAll(adminPassword,'[redacted]')); throw new Error('FRESH_MIGRATION_'+command.toUpperCase()+'_FAILED'); }
    }
    const ledger=(await admin.query('SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows;
    const initialChecksums=baseline?report.migrationChecksums.filter(m=>baseline.baseline.includes(m.name)):report.migrationChecksums;
    if (ledger.length!==initialChecksums.length || initialChecksums.some(m=>!ledger.some(l=>l.migration_name===m.name&&l.checksum===m.sha256))) throw new Error('MIGRATION_CHECKSUM_MISMATCH');
    report.checks.push({check:'fresh migrations + status + checksums',pass:true,count:ledger.length}); save();
    cancellation.check();
    // SJ source=COLLATERAL reads this bank table. Existing SJ migrations grant SJ
    // tables only; provision the single SELECT dependency, retaining FORCE RLS.
    await admin.query('GRANT SELECT ON public.debtor_collaterals TO sj_test_app; GRANT SELECT (id,name) ON public.divisions TO sj_test_app');
    // Read-time action eligibility also resolves the account and its menu grants
    // in the default service-only scenario. No password hash or write privilege
    // is granted; auth/session mutations remain explicit workflow prerequisites.
    await admin.query('GRANT SELECT ON public.role_menus, public.menus TO sj_test_app; GRANT SELECT (id,name) ON public.roles TO sj_test_app; GRANT SELECT (id,name,is_active,password_set_at,role_id,division_id,can_access_restricted_documents) ON public.users TO sj_test_app');
    if(workflow) {
      // Actual auth/RBAC middleware prerequisites; session owner RLS stays FORCE.
      await admin.query('GRANT SELECT ON public.refresh_tokens TO sj_test_app; GRANT UPDATE (last_used_at) ON public.refresh_tokens TO sj_test_app');
      if(!baseline)await admin.query(`CREATE ROLE sj_test_review LOGIN PASSWORD '${reviewPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; GRANT ruwang_sj_review TO sj_test_review; GRANT USAGE ON SCHEMA sj_test_guard TO sj_test_review; GRANT SELECT ON sj_test_guard.owner TO sj_test_review`);
    }
    // Bootstrap accounts/permissions only. Fixture module cannot change SJ business states.
    const { seedActors } = require('../src/integration/support/sj-isolated-fixtures');
    const browserPassword=(browserRun()||workflow==='auth')?secret()+'Aa1!':undefined;
    if(browserPassword){
      // Authentication and UI read prerequisites only, in the proven owned DB.
      // FORCE RLS on sessions/notifications and runtime role restrictions remain.
      await admin.query('GRANT SELECT ON public.users,public.roles,public.divisions,public.notifications,public.auth_action_tokens TO sj_test_app; GRANT INSERT,UPDATE ON public.refresh_tokens TO sj_test_app; GRANT UPDATE ON public.notifications TO sj_test_app; GRANT INSERT ON public.system_activity_logs TO sj_test_app');
      // The real notification list also reads due-reminder sources. This is
      // disposable provisioning, not a production migration or RLS bypass.
      await admin.query('GRANT SELECT ON public.digital_document_access_requests, public.digital_document_loans, public.digital_documents, public.incoming_mail_dispositions, public.incoming_mails, public.memorandum_dispositions, public.memorandums TO sj_test_app');
    }
    cancellation.check();
    const actors = await seedActors(admin,runId,browserPassword,{publicationSources:performanceRun()?28:0,step6PublicationSources:browserRun()&&!performanceRun()});
    await admin.end(); admin=null;
    let cross;
    cancellation.check();
    if(workflow==='cross-app'){
      cross=await require('../src/integration/support/sj-cross-app-provision').provision({proof,ownerUrl:url('postgres',adminPassword),baseEnv:baseEnv(),browserRoot:browserRun()?process.env.SJ_TEST_CONTROL_BUILD_ROOT:undefined});
      if(browserRun()&&!cross.browserRoot)throw Error('CONTROL_BUILD_REQUIRED');
      cross.performance=performanceRun();
      cross.catalogCancelDiagnostic=diagnosticSelection==='1';
      cross.browserToolchain=browserToolchain;
      cross.browserSelection=browserSelection;
      cross.performanceCollateralIds=actors.performanceCollateralIds;
      if(cross.performance){
        if(!process.env.SJ_TEST_BANK_UI_BUILD_ROOT||!process.env.SJ_TEST_PUBLIC_UI_BUILD_ROOT)throw Error('THREE_PRODUCTION_BUILDS_REQUIRED');
        for(const database of [proof.database,cross.controlDb,cross.centralDb]){
          assertContainer(proof,proof.pg);
          docker(['exec',proof.pg.id,'psql','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-c','CREATE EXTENSION IF NOT EXISTS pg_stat_statements']);
        }
      }
      if(browserPassword){cross.browserBankPassword=browserPassword;cross.browserBankUsername='browserMaker-'+runId;cross.bankUiRoot=process.env.SJ_TEST_BANK_UI_BUILD_ROOT;cross.publicUiRoot=process.env.SJ_TEST_PUBLIC_UI_BUILD_ROOT;}
      cross.uiStep6=browserRun()&&!performanceRun();
      if(cross.uiStep6){cross.step6CollateralIds=actors.step6CollateralIds;cross.step6CollateralNumbers=actors.step6CollateralNumbers;}
      report.checks.push({check:'real Control/SJ fresh databases with isolated runtime roles and exact applied migration checksums',pass:true,centralMigrations:cross.migrationCount,controlMigrations:cross.controlMigrations});save();
    }
    cancellation.check();
    const env={...baseEnv(),NODE_ENV:'test',DATABASE_URL:url('sj_test_app',appPassword),DATABASE_SYSTEM_URL:url('sj_test_app',appPassword),SJ_WORKER_DATABASE_URL:url('sj_test_worker',workerPassword),SJ_MEDIA_STORAGE_PROVIDER:'FILESYSTEM',SJ_MEDIA_FILESYSTEM_ROOT:path.join(root,'storage'),UPLOAD_DIR:path.join(root,'uploads'),UPLOAD_TEMP_DIR:path.join(root,'tmp'),SJ_TEST_REDIS_PREFIX:`ra-sj:${runId}:`,SJ_CONTROL_REVIEW_AUTHORITY:'local',SJ_CONTROL_SNAPSHOT_ENABLED:'false',DB_POOL_MAX:'3',DB_TRANSACTION_TIMEOUT_MS:'20000',DB_TRANSACTION_MAX_WAIT_MS:'10000'};
    for(const k of ['REDIS_URL','JOB_QUEUE_REDIS_URL','APP_CACHE_REDIS_URL','RATE_LIMIT_REDIS_URL']) env[k]=`redis://127.0.0.1:${proof.redis.port}/0`;
    if(workflow&&!baseline)env.SJ_REVIEW_DATABASE_URL=url('sj_test_review',reviewPassword);
    if(['central','cross-app'].includes(workflow))Object.assign(env,{SJ_CONTROL_REVIEW_AUTHORITY:'central',SJ_CONTROL_SNAPSHOT_ENABLED:'true'});
    {
      const child=fork(path.join(repo,'src/integration/support',workflow==='cross-app'?'sj-cross-app-scenario.js':workflow==='bank-isolation-peer'?'sj-bank-isolation-peer.js':'sj-isolated-scenario.js'),[],{cwd:root,env,stdio:['ignore','pipe','pipe','ipc']});
      activeScenario=child;
      const stopPeer=message=>{if(workflow==='bank-isolation-peer'&&message?.type==='stop-bank-isolation-peer'&&message.runId===proof.runId&&message.tokenHash===proof.tokenHash&&child.connected)child.send(message);};
      process.on('message',stopPeer);
      let result;
      // Workflow now includes 105 official API submissions and all deep pages.
      // Bound the whole child; do not shorten business coverage to fit 120 s.
      // Expanded real three-UI journeys add contact revision and four categories;
      // retain a bounded budget, without dropping service/negative coverage.
      let upgraded=false;
      const completion=observeOwnedScenario(child,{timeoutMs:scenarioTimeout(workflow,browserRun(),performanceRun()),abortMessage:{type:'abort-owned-scenario',runId:proof.runId,tokenHash:proof.tokenHash},onClosed:()=>{activeScenario=null;process.off('message',stopPeer);},onMessage:async m=>{
        if(m.type==='bank-isolation-ready'){
          if(workflow!=='bank-isolation-peer'||!process.connected||m.proof.runId!==proof.runId||m.proof.tokenHash!==proof.tokenHash)throw Error('UNEXPECTED_BANK_PEER_READY');
          proof.integrationOrigin=m.bank.origin;save();
          process.send({...m,runId:proof.runId,tokenHash:proof.tokenHash});
          return;
        }
        if(m.type==='result')result=m;
        if(m.type==='progress'){report.progress=m.checks;save();}
        if(m.type==='cross-register'){
          try{
            if(workflow!=='cross-app')throw Error('UNEXPECTED_REGISTRATION');
            await require('../src/integration/support/sj-cross-app-provision').register({proof,ownerUrl:url('postgres',adminPassword),cross,registration:m.registration});
            child.send({type:'cross-registered',pass:true});
          }catch{if(child.connected)child.send({type:'cross-registered',pass:false});}
        }
        if(m.type==='infrastructure-fault'){
          try{
            if(workflow!=='worker'||!['pg','redis'].includes(m.kind)||!['pause','unpause'].includes(m.action))throw Error('UNSUPPORTED_FAULT');
            assertContainer(proof,proof[m.kind],undefined,m.action==='unpause');
            if(m.action==='pause')paused.add(m.kind);
            docker([m.action,proof[m.kind].id]);
            if(m.action==='pause')paused.add(m.kind);else paused.delete(m.kind);
            child.send({type:'fault-done',id:m.id,pass:true});
          }catch{if(child.connected)child.send({type:'fault-done',id:m.id,pass:false});}
        }
        if(m.type==='upgrade-ready'){
          try{
            if(!baseline||upgraded)throw Error('UNEXPECTED_UPGRADE_REQUEST');
            upgraded=true;
            report.checks.push(await require('../src/integration/support/sj-upgrade-proof').apply({repo,proof,env:migrationEnv,checksums:report.migrationChecksums}));
            save();child.send({type:'upgrade-done',pass:true});
          }catch{report.upgradeFailure=true;save();if(child.connected)child.send({type:'upgrade-done',pass:false});}
        }
      }});
      child.send({proof,token,actors,workflow,cross,scanner,authPassword:workflow==='auth'?browserPassword:undefined},error=>{if(error&&child.connected)child.disconnect();});
      const outcome=await completion;report.scenario=result;
      ownedUiCloseUnconfirmed=result?.code==='UI_CHILD_CLOSE_UNCONFIRMED';
      if(result?.integrationOrigin)proof.integrationOrigin=result.integrationOrigin;
      if(outcome.code!==0||outcome.signal||!result?.pass||cancellation.cancelled)throw Error(cancellation.cancelled?'OWNED_RUN_CANCELLED':result?.code||'SCENARIO_FAILED');
    }
    cancellation.check();
    if(JSON.stringify(sourceManifest())!==JSON.stringify(report.sourceManifest))throw Error('SOURCE_CHANGED_DURING_RUN');
    if(workflow==='cross-app'&&JSON.stringify(peerManifest())!==JSON.stringify(report.peerManifest))throw Error('PEER_SOURCE_CHANGED_DURING_RUN');
    report.checks.push({check:'same source manifest before/after scenario',pass:true});
    report.status='passed';
  } catch(e) { report.status='failed'; report.failure=String(e.message).replace(/postgresql:\/\/\S+/g,'[redacted-url]'); process.exitCode=1; }
  finally {
    cancellation.beginCleanup();
    if(activeScenario||ownedUiCloseUnconfirmed){
      // Never remove a DB/container under a child whose actual CLOSE was not
      // observed. Preserve owner proof for explicit, identity-checked recovery.
      report.status='failed';report.cleanup.push({kind:ownedUiCloseUnconfirmed?'unconfirmed owned UI CLOSE resource retention':'live scenario resource retention',removed:false});
      report.finishedAt=new Date().toISOString();save();process.exitCode=1;
      cancellation.dispose();if(process.connected)process.disconnect();return;
    }
    if(admin)await admin.end().catch(()=>{});
    for(const kind of paused){try{assertContainer(proof,proof[kind],undefined,true);docker(['unpause',proof[kind].id]);}catch{}}
    for(const kind of ['redis','pg']) if(proof[kind]) {
      if(proof[kind].creationAttempted===true){
        const result=cleanupOwnedContainer({proof,kind,env:baseEnv(),persist:save});
        report.cleanup.push(result);if(!result.removed)process.exitCode=1;
        continue;
      }
      try { assertContainer(proof,proof[kind]); docker(['rm','-f','-v',proof[kind].id]); report.cleanup.push({kind,removed:true}); }
      catch { report.cleanup.push({kind,removed:false,reason:'ownership check/removal failed; manual inspection required'});process.exitCode=1; }
    }
    try{report.cleanup.push({kind:'run-owned storage',removed:cleanupStorage(proof)});}catch{report.cleanup.push({kind:'run-owned storage',removed:false});process.exitCode=1;}
    if(scannerPlan?.owned){
      try{report.cleanup.push({kind:'run-owned scanner',removed:cleanupScanner(scannerPlan,{onResolved:selection=>{proof.scanner=selection;report.scanner=selection;save();}})});}
      catch{report.cleanup.push({kind:'run-owned scanner',removed:false,reason:'ownership check/removal failed; manual inspection required'});process.exitCode=1;}
    }
    if(report.cleanup.some(c=>!c.removed))report.status='failed';
    report.finishedAt=new Date().toISOString();save();
    console.log(JSON.stringify({status:report.status,evidence:root,failure:report.failure,checks:report.checks,scenario:report.scenario,cleanup:report.cleanup},null,2));
    cancellation.dispose();
    if(process.connected)process.disconnect();
  }
}
module.exports = { scenarioTimeout, attachOwnedCancellation };
if(require.main===module) {
  if(process.argv[2]==='--cleanup') {
    try{recoverOwnedRun(process.argv[3]);}catch{console.error('OWNED_CLEANUP_REFUSED: verify proof and stopped processes');process.exitCode=1;}
  } else if(process.argv.length!==2 && !(process.argv.length===3 && ['--bank-isolation-peer','--auth-rls','--workflow','--workflow-central','--workflow-upgrade','--worker-resilience','--cross-app','--cross-app-browser','--cross-app-performance'].includes(process.argv[2]))) {console.error('Unsupported arguments');process.exitCode=1;}
  else if(process.argv[2]==='--bank-isolation-peer'&&!process.connected){console.error('OWNED_BANK_PEER_IPC_REQUIRED');process.exitCode=1;}
  else main(process.argv[2]==='--bank-isolation-peer'?'bank-isolation-peer':process.argv[2]==='--auth-rls'?'auth':['--cross-app','--cross-app-browser','--cross-app-performance'].includes(process.argv[2])?'cross-app':process.argv[2]==='--worker-resilience'?'worker':process.argv[2]==='--workflow-upgrade'?'upgrade':process.argv[2]==='--workflow-central'?'central':process.argv[2]==='--workflow').catch(()=>{console.error('ISOLATED_HARNESS_FAILED');process.exitCode=1;});
}
