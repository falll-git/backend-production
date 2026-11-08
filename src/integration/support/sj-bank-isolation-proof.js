const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {fork}=require('node:child_process'),{Client}=require('pg');
const {assertLive,assertContainer,docker}=require('./sj-disposable-guard');
const {bankPath}=require('./sj-peer-paths');
function validatePeer(a,b,holder){
  assert.equal(b.kind,'RA-SJ-02-disposable-v1');assert.match(b.runId,/^[a-f0-9]{32}$/);assert.match(b.tokenHash,/^[a-f0-9]{64}$/);
  assert.notEqual(b.runId,a.runId);assert.notEqual(b.tokenHash,a.tokenHash);
  assert.equal(path.dirname(b.root),holder);assert.match(path.basename(b.root),/^ra-sj-02-/);
  assert.notEqual(b.pg.id,a.pg.id);assert.notEqual(b.redis.id,a.redis.id);
  assert.notEqual(b.pg.port,a.pg.port);assert.notEqual(b.redis.port,a.redis.port);
  assert.equal(b.dockerEndpoint,a.dockerEndpoint);assert.equal(b.database,'sj_run_'+b.runId);
}
function runtimeUrl(proof,value){const u=new URL(value);assert.equal(u.protocol,'postgresql:');assert.equal(u.hostname,'127.0.0.1');assert.equal(Number(u.port),proof.pg.port);assert.equal(u.pathname,'/'+proof.database);assert.equal(u.username,'sj_test_app');assert.ok(u.password);assert.equal(u.search,'');assert.equal(u.hash,'');return u;}
function bankOrigin(value){const u=new URL(value);assert.equal(u.protocol,'http:');assert.equal(u.hostname,'127.0.0.1');assert.ok(Number(u.port)>1024&&!['3111','4320','4411','7111'].includes(u.port));assert.equal(u.pathname,'/');for(const k of ['username','password','search','hash'])assert.equal(u[k],'');return u.origin;}
function isolationSettings(origin){return {institution_id:crypto.randomUUID(),installation_id:crypto.randomUUID(),key_id:crypto.randomUUID(),central_base_url:bankOrigin(origin),module_visible:true,draft_enabled:true,review_enabled:true,sync_enabled:false,publish_enabled:false,filesystem_upload_enabled:true,s3_upload_enabled:false};}
async function setReadActor(db,actorId){assert.match(actorId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);await db.query("SELECT set_config('app.current_user_id',$1,true)",[actorId]);await db.query('SELECT public.ruwang_arsip_prepare_read_context()');}
module.exports=async function bankIsolation({proof,token,http,server,tokens,children,actors}){
  await assertLive(proof,process.env,token);
  const holder=path.join(proof.root,'bank-isolation');fs.mkdirSync(holder);
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','DOCKER_HOST'].includes(k)));
  Object.assign(env,{TEMP:holder,TMP:holder});
  const child=fork(bankPath('scripts/run-sj-isolated-tests.js'),['--bank-isolation-peer'],{cwd:proof.root,env,execArgv:[],windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  children.add(child);
  let ready,exit,stdoutBytes=0,stderrBytes=0,finish;
  const stdoutHash=crypto.createHash('sha256'),stderrHash=crypto.createHash('sha256');
  const closed=new Promise(r=>{finish=r;});
  child.on('error',()=>{});child.on('close',(code,signal)=>{exit={code,signal};children.delete(child);finish(exit);});
  child.stdout.on('data',b=>{stdoutBytes+=b.length;stdoutHash.update(b);});child.stderr.on('data',b=>{stderrBytes+=b.length;stderrHash.update(b);});
  child.on('message',message=>{if(message.type==='bank-isolation-ready')ready=message;});
  const waitReady=async()=>{const deadline=Date.now()+240000;while(!ready){assert.equal(exit,undefined,'SECOND_BANK_EXITED_BEFORE_READY');assert.ok(Date.now()<deadline,'SECOND_BANK_READY_TIMEOUT');await new Promise(r=>setTimeout(r,100));}return ready;};
  const boundedClose=()=>{let timer;return Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('SECOND_BANK_CLEANUP_CLOSE_UNCONFIRMED')),90000);})]).finally(()=>clearTimeout(timer));};
  let b;
  try{
    const message=await waitReady();b=message.proof;validatePeer(proof,b,holder);
    assert.equal(fs.realpathSync(b.root),path.resolve(b.root));assert.equal(fs.lstatSync(b.root).isSymbolicLink(),false);
    const owner=JSON.parse(fs.readFileSync(path.join(b.root,'owner.json')));assert.equal(owner.runId,b.runId);assert.equal(owner.tokenHash,b.tokenHash);
    assertContainer(b,b.pg);assertContainer(b,b.redis);
    const origin=bankOrigin(message.bank.origin);assert.notEqual(origin,proof.integrationOrigin);
    const urlA=runtimeUrl(proof,process.env.DATABASE_URL),urlB=runtimeUrl(b,message.bank.databaseUrl);
    assert.notEqual(urlA.password,urlB.password);
    const request=require('supertest');
    const call=async(target,access,method,route,body,status=200)=>{
      const agent=request(target)[method]('/api/v1/seputar-jaminan'+route).set('Authorization','Bearer '+access);
      const response=await(body?agent.send(body):agent);assert.equal(response.status,status,'SECOND_BANK_HTTP_STATUS_'+method+'_'+route.split('/')[1].split('?')[0]);return response.body.data;
    };
    const apiB=(method,route,body,status)=>call(origin,message.bank.token,method,route,body,status);
    await apiB('patch','/settings',isolationSettings(origin));
    let ownA=await http('maker','post','/contacts',{label:'Installation A owned draft',phone_e164:'+6280001112221'},201);
    let ownB=await apiB('post','/contacts',{label:'Installation B owned draft',phone_e164:'+6280001112222'},201);
    assert.notEqual(ownA.id,ownB.id);
    await call(origin,tokens.maker,'get','/contacts',null,401);await call(server,message.bank.token,'get','/contacts',null,401);
    for(const [target,access,own,foreign]of [[server,tokens.maker,ownA,ownB],[origin,message.bank.token,ownB,ownA]]){
      assert.equal((await call(target,access,'get','/contacts/'+own.id)).id,own.id);
      await call(target,access,'get','/contacts/'+foreign.id,null,404);
      await call(target,access,'patch','/contacts/'+foreign.id+'/draft',{expected_version:foreign.lock_version,label:'Must not change another bank'},404);
      const list=await call(target,access,'get','/contacts?paged=true&limit=100');assert.ok(list.items.some(row=>row.id===own.id));assert.equal(list.items.some(row=>row.id===foreign.id),false);
      const updated=await call(target,access,'patch','/contacts/'+own.id+'/draft',{expected_version:own.lock_version,label:'Lawful isolated own-bank update'});assert.equal(updated.id,own.id);
    }
    for(const [p,u,own,foreign,actorId]of [[proof,urlA,ownA,ownB,actors.maker.id],[b,urlB,ownB,ownA,message.bank.actorId]]){
      const db=new Client({connectionString:u.href,connectionTimeoutMillis:3000});await db.connect();try{
        await db.query('BEGIN READ ONLY');
        const role=(await db.query('SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];assert.deepEqual(role,{rolsuper:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false});
        const marker=(await db.query('SELECT run_id,token_hash FROM sj_test_guard.owner')).rows[0];assert.equal(marker.run_id,p.runId);assert.equal(marker.token_hash,p.tokenHash);
        assert.equal((await db.query('SELECT count(*)::int n FROM sj_whatsapp_contacts WHERE id=$1',[own.id])).rows[0].n,0,'Unscoped runtime must remain fail-closed');
        // Same transaction-local user identity/read-context function used by
        // database-rls.js. Never disable RLS or use a migration/system role.
        await setReadActor(db,actorId);
        assert.equal((await db.query('SELECT count(*)::int n FROM sj_whatsapp_contacts WHERE id=$1',[own.id])).rows[0].n,1);
        assert.equal((await db.query('SELECT count(*)::int n FROM sj_whatsapp_contacts WHERE id=$1',[foreign.id])).rows[0].n,0);
        await db.query('ROLLBACK');
      }finally{await db.end();}
    }
    for(const [credentials,endpoint]of [[urlA,urlB],[urlB,urlA]]){
      const crossed=new URL(endpoint);crossed.username=credentials.username;crossed.password=credentials.password;
      const db=new Client({connectionString:crossed.href,connectionTimeoutMillis:3000});
      try{await assert.rejects(db.connect(),e=>['28P01','28000'].includes(e.code));}finally{await db.end().catch(()=>{});}
    }
    child.send({type:'stop-bank-isolation-peer',runId:b.runId,tokenHash:b.tokenHash});
    assert.deepEqual(await boundedClose(),{code:0,signal:null});
    const report=JSON.parse(fs.readFileSync(path.join(b.root,'report.json')));assert.equal(report.status,'passed');assert.equal(report.scenario.pass,true);assert.ok(report.cleanup.length===3&&report.cleanup.every(row=>row.removed));
    const ids=docker(['ps','-aq','--no-trunc']).split(/\r?\n/);assert.equal(ids.includes(b.pg.id),false);assert.equal(ids.includes(b.redis.id),false);
    for(const name of ['storage','uploads','tmp'])assert.equal(fs.existsSync(path.join(b.root,name)),false);
    return {check:'two separate real bank installations: own API reads/updates succeed; reciprocal foreign JWT401, foreign ID read/write404, list/SQL isolation and distinct-PG credential rejection; exact second-bank cleanup',pass:true,
      secondRunId:b.runId,secondRoot:b.root,secondContainers:[b.pg.id,b.redis.id],secondPorts:[b.pg.port,b.redis.port,Number(new URL(origin).port)],actualClose:exit,stdoutBytes,stderrBytes,stdoutSha256:stdoutHash.digest('hex'),stderrSha256:stderrHash.digest('hex'),
      boundary:'Separate PG clusters/credentials/JWT secrets, not artificial CONNECT policies or a second division. Bank login is a fixture-session prerequisite, not browser login evidence.'};
  }finally{
    if(!exit){if(b&&child.connected)child.send({type:'stop-bank-isolation-peer',runId:b.runId,tokenHash:b.tokenHash});else if(child.connected)child.disconnect();await boundedClose();}
  }
};
module.exports.validatePeer=validatePeer;module.exports.runtimeUrl=runtimeUrl;module.exports.bankOrigin=bankOrigin;module.exports.isolationSettings=isolationSettings;module.exports.setReadActor=setReadActor;
