const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {validatePeer,runtimeUrl,bankOrigin,isolationSettings,setReadActor}=require('./sj-bank-isolation-proof');
const a={runId:'a'.repeat(32),tokenHash:'1'.repeat(64),pg:{id:'2'.repeat(64),port:51001},redis:{id:'3'.repeat(64),port:51002},dockerEndpoint:'npipe:////./pipe/dockerDesktopLinuxEngine'};
const holder=path.resolve('owned-test-holder');
const b={kind:'RA-SJ-02-disposable-v1',runId:'b'.repeat(32),tokenHash:'4'.repeat(64),root:path.join(holder,'ra-sj-02-unit'),database:'sj_run_'+'b'.repeat(32),pg:{id:'5'.repeat(64),port:51003},redis:{id:'6'.repeat(64),port:51004},dockerEndpoint:a.dockerEndpoint};
test('second bank shape requires distinct owner, DB cluster, Redis, root and engine',()=>assert.doesNotThrow(()=>validatePeer(a,b,holder)));
for(const [name,mutate]of [['run',v=>v.runId=a.runId],['capability',v=>v.tokenHash=a.tokenHash],['PGcluster',v=>v.pg.id=a.pg.id],['Redis',v=>v.redis.id=a.redis.id],['PGport',v=>v.pg.port=a.pg.port],['Redisport',v=>v.redis.port=a.redis.port],['engine',v=>v.dockerEndpoint='unix:///other'],['root',v=>v.root=path.resolve('other')],['database',v=>v.database='operational'],['kind',v=>v.kind='normal']])test('second bank rejects shared/foreign '+name,()=>{const value=structuredClone(b);mutate(value);assert.throws(()=>validatePeer(a,value,holder));});
const good='postgresql://sj_test_app:synthetic@127.0.0.1:51003/'+b.database;
test('second bank runtime URL is exact before any connection',()=>assert.equal(runtimeUrl(b,good).pathname,'/'+b.database));
for(const value of [good.replace('127.0.0.1','localhost'),good.replace('51003','5432'),good.replace('sj_test_app','postgres'),good+'?host=other',good+'#foreign',good.replace(b.database,'normal')])test('second bank refuses mismatched runtime target',()=>assert.throws(()=>runtimeUrl(b,value)));
test('bank origin shape accepts explicit ephemeral loopback',()=>assert.equal(bankOrigin('http://127.0.0.1:51005'),'http://127.0.0.1:51005'));
test('fresh bank settings provide required first-connection identities without enabling delivery or publishing',()=>{
  const value=isolationSettings('http://127.0.0.1:51005');
  for(const key of ['institution_id','installation_id','key_id'])assert.match(value[key],/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Set([value.institution_id,value.installation_id,value.key_id]).size,3);
  assert.equal(value.central_base_url,'http://127.0.0.1:51005');assert.equal(value.sync_enabled,false);assert.equal(value.publish_enabled,false);
  const {integrationSettingsSchema}=require('../../modules/seputar-jaminan/seputarJaminan.validation');
  assert.equal(integrationSettingsSchema.validate(value).error,undefined);
});
test('raw runtime read probe supplies actual transaction-local user/read context without changing business state',async()=>{
  const calls=[],db={query:async(...args)=>{calls.push(args);}};
  const id='11111111-1111-4111-8111-111111111111';
  await setReadActor(db,id);
  assert.deepEqual(calls,[["SELECT set_config('app.current_user_id',$1,true)",[id]],['SELECT public.ruwang_arsip_prepare_read_context()']]);
  await assert.rejects(setReadActor(db,'invalid'));assert.equal(calls.length,2);
});
for(const value of ['http://127.0.0.1:4320','http://127.0.0.1:7111','http://localhost:51005','http://127.0.0.1:51005/?x=1','http://127.0.0.1:51005/else','http://x@127.0.0.1:51005'])test('bank origin refuses normal/foreign target',()=>assert.throws(()=>bankOrigin(value)));
