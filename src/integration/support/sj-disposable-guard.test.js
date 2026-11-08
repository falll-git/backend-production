const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {assertConfig,assertLive,assertLocalDocker,assertContainer,cleanupStorage,digest,rejectLegacyRun}=require('./sj-disposable-guard');
function guardWithDockerDouble(execute) {
  const sandbox={module:{exports:{}},require:specifier=>specifier==='node:child_process'?{execFileSync:execute}:require(specifier)};
  vm.runInNewContext(fs.readFileSync(require.resolve('./sj-disposable-guard'),'utf8'),sandbox,{filename:'sj-disposable-guard.js'});
  return sandbox.module.exports;
}
test('actual Docker helper has a finite CLI deadline and forwards exact argv without a shell (unit double)',()=>{
  const calls=[],args=['inspect','b'.repeat(64)];
  const guarded=guardWithDockerDouble((file,argv,options)=>{calls.push({file,argv,options});return '  inspected\n';});
  assert.equal(guarded.docker(args),'inspected');
  assert.equal(calls.length,1);assert.equal(calls[0].file,'docker');assert.equal(calls[0].argv,args);
  assert.equal(calls[0].options.timeout,30000);assert.equal(calls[0].options.killSignal,'SIGKILL');
  assert.equal(calls[0].options.windowsHide,true);assert.equal(calls[0].options.encoding,'utf8');
  assert.deepEqual(Array.from(calls[0].options.stdio),['ignore','pipe','pipe']);
  assert.equal(calls[0].options.shell,undefined);
});
for(const code of ['ETIMEDOUT','ENOENT','EACCES'])test('Docker '+code+' is not swallowed, retried or treated as owned/successful (unit double)',()=>{
  let calls=0;const failure=Object.assign(new Error('synthetic CLI failure'),{code});
  const guarded=guardWithDockerDouble(()=>{calls++;throw failure;});
  assert.throws(()=>guarded.docker(['inspect','b'.repeat(64)]),error=>error===failure);
  assert.equal(calls,1);
});
function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sj-guard-unit-'));
  const token='ephemeral-unit-token',runId='a'.repeat(32);
  const proof={kind:'RA-SJ-02-disposable-v1',runId,tokenHash:digest(token),root,database:'sj_run_'+runId,integrationOrigin:'http://127.0.0.1:54321',pg:{id:'b'.repeat(64),port:54322,internalPort:5432,dataPath:'/var/lib/postgresql/data'},redis:{id:'c'.repeat(64),port:54323,internalPort:6379,dataPath:'/data'}};
  fs.writeFileSync(path.join(root,'owner.json'),JSON.stringify({runId,tokenHash:proof.tokenHash}));
  for(const dir of ['storage','uploads','tmp'])fs.mkdirSync(path.join(root,dir));
  const env={NODE_ENV:'test',DATABASE_URL:`postgresql://sj_test_app:unit@127.0.0.1:54322/${proof.database}`,DATABASE_SYSTEM_URL:`postgresql://sj_test_app:unit@127.0.0.1:54322/${proof.database}`,SJ_WORKER_DATABASE_URL:`postgresql://sj_test_worker:unit@127.0.0.1:54322/${proof.database}`,SJ_MEDIA_FILESYSTEM_ROOT:path.join(root,'storage'),UPLOAD_DIR:path.join(root,'uploads'),UPLOAD_TEMP_DIR:path.join(root,'tmp'),SJ_TEST_REDIS_PREFIX:`ra-sj:${runId}:`,SJ_CONTROL_BASE_URL:proof.integrationOrigin,SJ_TEST_CENTRAL_BASE_URL:proof.integrationOrigin};
  for(const k of ['REDIS_URL','JOB_QUEUE_REDIS_URL','APP_CACHE_REDIS_URL','RATE_LIMIT_REDIS_URL'])env[k]='redis://127.0.0.1:54323/0';
  env.SJ_MEDIA_STORAGE_PROVIDER='FILESYSTEM';
  const inspect=id=>{const item=id===proof.pg.id?proof.pg:proof.redis;return{Id:id,Config:{Labels:{'ra-sj.run':runId,'ra-sj.proof':proof.tokenHash}},Mounts:[],HostConfig:{Tmpfs:{[item.dataPath]:'rw'},PortBindings:{[item.internalPort+'/tcp']:[{HostIp:'127.0.0.1'}]}},NetworkSettings:{Ports:{[item.internalPort+'/tcp']:[{HostIp:'127.0.0.1',HostPort:String(item.port)}]}}};};
  return{root,proof,env,token,inspect};
}
const f=fixture();
test('paused Docker recovery checks immutable ownership; normal runtime still rejects missing ports',()=>{
  const paused=id=>{const a=f.inspect(id);a.State={Paused:true};a.NetworkSettings.Ports={};return a;};
  assert.throws(()=>assertContainer(f.proof,f.proof.pg,paused));
  assert.ok(assertContainer(f.proof,f.proof.pg,paused,true));
  assert.throws(()=>assertContainer(f.proof,f.proof.pg,id=>{const a=paused(id);a.Config.Labels['ra-sj.run']='foreign';return a;},true));
});
test('owned config accepts complete proof (unit double, not Docker)',()=>assert.equal(assertConfig(f.proof,f.env,f.token,f.inspect),true));
for(const [name,change] of [
  ['operational DB despite local suffix',e=>e.DATABASE_URL='postgresql://sj_test_app:x@127.0.0.1:5432/ruwang_arsip_local'],
  ['same name wrong port',e=>e.DATABASE_URL=e.DATABASE_URL.replace(':54322/',':5432/')],
  ['system DB escape',e=>e.DATABASE_SYSTEM_URL='postgresql://postgres:x@localhost:5432/ruwang_arsip_local'],
  ['worker DB escape',e=>e.SJ_WORKER_DATABASE_URL=e.DATABASE_URL],
  ['review DB escape',e=>e.SJ_REVIEW_DATABASE_URL='postgresql://sj_test_review:x@127.0.0.1:5432/ruwang_arsip_local'],
  ['review role escape',e=>e.SJ_REVIEW_DATABASE_URL=e.DATABASE_URL],
  ['review URL override',e=>e.SJ_REVIEW_DATABASE_URL=e.DATABASE_URL.replace('sj_test_app','sj_test_review')+'?host=elsewhere'],
  ['production mode',e=>e.NODE_ENV='production'],
  ['outside storage',e=>e.SJ_MEDIA_FILESYSTEM_ROOT='D:/backend-production/uploads'],
  ['redis escape',e=>e.REDIS_URL='redis://127.0.0.1:56379/0'],
  ['redis namespace escape',e=>e.SJ_TEST_REDIS_PREFIX='ruwang:'],
  ['real Control target',e=>e.SJ_CONTROL_BASE_URL='http://127.0.0.1:4320'],
  ['migration credential in runtime',e=>e.MIGRATION_DATABASE_URL=e.DATABASE_URL],
  ['file credential escape',e=>e.DATABASE_URL_FILE='operational.secret'],
]) test(name+' rejected before a database connection',async()=>{
  const env={...f.env};change(env);let connections=0;
  class Client{constructor(){connections++;}}
  await assert.rejects(assertLive(f.proof,env,f.token,{Client,inspect:f.inspect,cwd:f.root}));assert.equal(connections,0);
});
test('wrong capability rejected',()=>assert.throws(()=>assertConfig(f.proof,f.env,'wrong',f.inspect)));
test('missing proof rejected',()=>assert.throws(()=>assertConfig(null,f.env,f.token,f.inspect)));
test('foreign Docker label rejected',()=>assert.throws(()=>assertConfig(f.proof,f.env,f.token,id=>{const a=f.inspect(id);a.Config.Labels['ra-sj.run']='foreign';return a;})));
test('persistent host/volume mount rejected',()=>assert.throws(()=>assertConfig(f.proof,f.env,f.token,id=>{const a=f.inspect(id);a.Mounts=[{Type:'bind'}];return a;})));
test('legacy workflow and adapter flags fail closed',()=>{
  assert.throws(()=>rejectLegacyRun({RUN_SEPUTAR_JAMINAN_INTEGRATION:'true'}),/SJ_LEGACY_HARNESS_UNSAFE/);
  assert.throws(()=>rejectLegacyRun({RUN_CONTROL_REVIEW_ADAPTER_INTEGRATION:'true'}),/SJ_LEGACY_HARNESS_UNSAFE/);
});
test('guard proof directory contains only unit-owned files; preserve as evidence',()=>assert.ok(fs.existsSync(path.join(f.root,'owner.json'))));

test('Docker remote contexts and endpoints rejected before provisioning',()=>{
  assert.throws(()=>assertLocalDocker({DOCKER_HOST:'tcp://127.0.0.1:2375'}));
  assert.throws(()=>assertLocalDocker({DOCKER_CONTEXT:'remote'},()=> 'ssh://example.test'));
  assert.equal(assertLocalDocker({},()=> 'npipe:////./pipe/dockerDesktopLinuxEngine'),'npipe:////./pipe/dockerDesktopLinuxEngine');
});
test('runner pins the resolved local engine and removes context precedence before child provisioning',()=>{
  const {pinLocalDocker}=require('./sj-disposable-guard');
  const env={DOCKER_CONTEXT:'local',DOCKER_HOST:'ssh://ignored-context-override'};
  let reads=0;
  assert.equal(pinLocalDocker(env,()=>{reads++;return 'npipe:////./pipe/dockerDesktopLinuxEngine';}),'npipe:////./pipe/dockerDesktopLinuxEngine');
  assert.equal(reads,1);assert.equal(env.DOCKER_HOST,'npipe:////./pipe/dockerDesktopLinuxEngine');
  assert.equal(Object.hasOwn(env,'DOCKER_CONTEXT'),false);
  assert.equal(assertLocalDocker(env,()=>{throw Error('must not re-resolve context');}),env.DOCKER_HOST);
});
test('a refused remote engine does not mutate the runner environment',()=>{
  const {pinLocalDocker}=require('./sj-disposable-guard');
  const env={DOCKER_CONTEXT:'remote',DOCKER_HOST:'unix:///var/run/docker.sock'},before={...env};
  assert.throws(()=>pinLocalDocker(env,()=> 'ssh://foreign.example.invalid'));
  assert.deepEqual(env,before);
});
test('repository cwd rejected before connecting even with otherwise owned configuration',async()=>{
  let connections=0; class Client { constructor(){connections++;} }
  await assert.rejects(assertLive(f.proof,f.env,f.token,{Client,inspect:f.inspect,cwd:__dirname}));
  assert.equal(connections,0);
});
for(const defect of ['marker','superuser','bypassrls','privileged-membership','table-owner','wrong-membership'])test('live proof rejects '+defect+' using read-only queries',async()=>{
  const queries=[];
  class Client {
    async connect(){} async end(){}
    async query(sql){
      queries.push(sql);
      if(sql.includes('FROM pg_roles WHERE'))return {rows:[{db:f.proof.database,app_member:defect!=='wrong-membership',worker_member:false,rolsuper:defect==='superuser',rolbypassrls:defect==='bypassrls',privileged_membership:defect==='privileged-membership',owns_application_tables:defect==='table-owner'}]};
      if(sql.includes('sj_test_guard.owner'))return {rows:[{run_id:defect==='marker'?'foreign':f.proof.runId,token_hash:f.proof.tokenHash}]};
      return {rows:[]};
    }
  }
  await assert.rejects(assertLive(f.proof,f.env,f.token,{Client,inspect:f.inspect,cwd:f.root}));
  assert.equal(queries[0],'BEGIN READ ONLY');assert.ok(queries.every(q=>/^(BEGIN READ ONLY|SELECT|ROLLBACK)/.test(q)));
});
test('cleanup refuses foreign marker without touching files',()=>{
  const x=fixture();fs.writeFileSync(path.join(x.root,'storage','sentinel'),'keep');
  assert.throws(()=>cleanupStorage({...x.proof,tokenHash:digest('foreign')}));
  assert.equal(fs.readFileSync(path.join(x.root,'storage','sentinel'),'utf8'),'keep');
});
test('cleanup refuses a junction before deleting any owned directory',()=>{
  const x=fixture(),other=fixture();
  const link=path.join(x.root,'tmp','outside');
  fs.symlinkSync(path.join(other.root,'storage'),link,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>cleanupStorage(x.proof));
  assert.ok(fs.existsSync(path.join(x.root,'storage')));assert.ok(fs.existsSync(path.join(other.root,'storage')));
  // Remove only this known test symlink, never recurse through it.
  fs.unlinkSync(link);assert.equal(cleanupStorage(x.proof),true);
});
test('cleanup removes only the run-owned storage, preserves another run and proof',()=>{
  const x=fixture(),other=fixture();fs.writeFileSync(path.join(other.root,'storage','sentinel'),'keep');
  assert.equal(cleanupStorage(x.proof),true);assert.equal(cleanupStorage(x.proof),true);
  assert.ok(fs.existsSync(path.join(x.root,'owner.json')));
  assert.equal(fs.readFileSync(path.join(other.root,'storage','sentinel'),'utf8'),'keep');
});
test('normalized legacy activation cannot bypass guard',()=>assert.throws(()=>rejectLegacyRun({RUN_CONTROL_REVIEW_ADAPTER_INTEGRATION:' TRUE '})));
