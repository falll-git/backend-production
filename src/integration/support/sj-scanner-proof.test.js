// Pure infrastructure predicates/launcher orchestration. Docker is a command-recording double.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {SCANNER_IMAGE,scannerSelection,assertScanner,prepareScanner,startScanner,scannerEnvironment,cleanupScanner,recoverScanner}=require('./sj-scanner-proof');

function scannerFixture(){
  const selection={name:'ra-sj-ci-'+'a'.repeat(32),marker:'b'.repeat(64),id:'c'.repeat(64),image:'sha256:'+'d'.repeat(64),imageRef:SCANNER_IMAGE};
  const actual={Id:selection.id,Image:selection.image,Name:'/'+selection.name,Config:{Image:SCANNER_IMAGE,Labels:{'sj.prerequisites.marker':selection.marker}},State:{Running:true,Paused:false},HostConfig:{PortBindings:{},Privileged:false,NetworkMode:'bridge',Tmpfs:{'/var/lib/clamav':'rw'}},Mounts:[{Type:'tmpfs',Destination:'/var/lib/clamav'}]};
  return {selection,actual};
}

test('scanner selection has no legacy fallback; partial/foreign configuration makes zero Docker calls',()=>{
  assert.equal(scannerSelection({}),null);
  const {selection}=scannerFixture(),env=scannerEnvironment(selection);
  assert.deepEqual(scannerSelection(env),selection);
  for(const invalid of [
    {SJ_TEST_SCANNER_NAME:'production'}, {SJ_TEST_SCANNER_MARKER:'a'.repeat(64)},
    ...Object.keys(env).map(key=>{const v={...env};delete v[key];return v;}),
    {...env,SJ_TEST_SCANNER_ID:'e'.repeat(63)}, {...env,SJ_TEST_SCANNER_IMAGE_ID:'clamav:latest'},
    {...env,SJ_TEST_SCANNER_STORAGE_ROOT:'D:/operational'}
  ]){
    let calls=0;
    assert.throws(()=>prepareScanner(invalid,{run:()=>{calls++;}}),/INVALID_TEST_SCANNER_SELECTION/);
    assert.equal(calls,0);
  }
});

test('scanner proof pins exact ID, resolved image, digest, capability, tmpfs, ports and running state',()=>{
  const {selection,actual}=scannerFixture();
  assert.equal(assertScanner(actual,selection),actual.Id);
  for(const mutate of [
    v=>v.Id='e'.repeat(64),v=>v.Image='sha256:'+'e'.repeat(64),v=>v.Config.Image='untrusted/scanner:latest',
    v=>v.Name='/foreign',v=>v.Config.Labels={},v=>v.State.Running=false,v=>v.State.Paused=true,
    v=>v.HostConfig.Privileged=true,v=>v.HostConfig.NetworkMode='host',v=>v.HostConfig.NetworkMode='container:foreign',
    v=>v.HostConfig.PublishAllPorts=true,v=>v.HostConfig.PortBindings={'3310/tcp':[{HostPort:'3310'}]},
    v=>v.HostConfig.Binds=['D:/data:/var/lib/clamav'],v=>v.HostConfig.VolumesFrom=['foreign'],
    v=>v.HostConfig.Tmpfs={},v=>v.HostConfig.Tmpfs['/foreign']='rw',
    v=>v.Mounts=[{Type:'bind',Destination:'/var/lib/clamav'}],
    v=>v.Mounts=[{Type:'volume',Destination:'/var/lib/clamav',Name:'operational-signatures'}]
  ]){
    const value=structuredClone(actual);mutate(value);assert.throws(()=>assertScanner(value,selection),/UNVERIFIED/);
  }
  assert.throws(()=>assertScanner(actual,{...selection,imageRef:'clamav:latest'}),/UNVERIFIED/);
  const stopped=structuredClone(actual);stopped.State.Running=false;
  assert.equal(assertScanner(stopped,selection,false),actual.Id);
});

function fakeDocker({ready=true}={}){
  const {selection,actual}=scannerFixture(),calls=[];
  let removed=false;
  const run=args=>{
    calls.push(args);
    if(args[0]==='image')return JSON.stringify([{Id:selection.image,RepoDigests:[SCANNER_IMAGE]}]);
    if(args[0]==='create'){
      actual.Name='/'+args[args.indexOf('--name')+1];actual.Config.Labels['sj.prerequisites.marker']=args[args.indexOf('--label')+1].split('=')[1];actual.State.Running=false;
      return actual.Id;
    }
    if(args[0]==='inspect')return JSON.stringify([actual]);
    if(args[0]==='start'){actual.State.Running=true;return actual.Id;}
    if(args[0]==='exec'){if(!ready)throw Error('NOT_READY');return '';}
    if(args[0]==='rm'){assert.equal(args.at(-1),actual.Id);removed=true;return actual.Id;}
    if(args[0]==='ps')return removed?'':actual.Id+'|'+actual.Name.slice(1);
    throw Error('UNEXPECTED_DOCKER_COMMAND');
  };
  return {run,selection,actual,calls};
}

test('invalid external image/container proof is rejected using only read-only Docker inspection',()=>{
  for(const defect of ['image','id','marker','volume','digest']){
    const f=fakeDocker();
    if(defect==='image')f.actual.Image='sha256:'+'e'.repeat(64);
    if(defect==='id')f.actual.Id='e'.repeat(64);
    if(defect==='marker')f.actual.Config.Labels['sj.prerequisites.marker']='e'.repeat(64);
    if(defect==='volume')f.actual.Mounts=[{Type:'volume',Destination:'/var/lib/clamav'}];
    const run=args=>defect==='digest'&&args[0]==='image'?JSON.stringify([{Id:f.selection.image,RepoDigests:['untrusted@sha256:'+'f'.repeat(64)]}]):f.run(args);
    assert.throws(()=>prepareScanner(scannerEnvironment(f.selection),{run}),/UNVERIFIED|PINNED/);
    assert.ok(f.calls.every(args=>['image','inspect'].includes(args[0])));
  }
});

test('standalone launch creates a random owned scanner and journals ID before start; exact cleanup',async()=>{
  const f=fakeDocker(),plan=prepareScanner({}, {run:f.run});
  assert.equal(plan.owned,true);assert.match(plan.selection.name,/^ra-sj-ci-[a-f0-9]{32}$/);
  assert.notEqual(plan.selection.name,f.selection.name);assert.notEqual(plan.selection.marker,f.selection.marker);
  const id=await startScanner(plan,{run:f.run,attempts:1,onCreated:selection=>{
    assert.equal(selection.id,f.actual.Id);assert.equal(f.calls.some(args=>args[0]==='start'),false);
  }});
  assert.equal(id,plan.selection.id);
  assert.deepEqual(scannerSelection(scannerEnvironment(plan.selection)),{name:plan.selection.name,marker:plan.selection.marker,id:plan.selection.id,image:plan.selection.image,imageRef:plan.selection.imageRef});
  assert.equal(plan.selection.creationAttempted,true);assert.equal(plan.selection.creationValidated,true);assert.equal(plan.selection.creationUncertain,false);
  assert.equal(cleanupScanner(plan,{run:f.run}),true);
  const create=f.calls.find(args=>args[0]==='create');
  assert.equal(create.at(-1),SCANNER_IMAGE);assert.ok(create.includes('--tmpfs'));assert.ok(!create.includes('-p'));
  assert.deepEqual(f.calls.find(args=>args[0]==='rm'),['rm','-f',id]);
});

test('parent-owned scanner is only read/pinged; forged capability and foreign cleanup are refused',async()=>{
  const f=fakeDocker(),plan=prepareScanner(scannerEnvironment(f.selection),{run:f.run});
  assert.equal(plan.owned,false);
  assert.equal(await startScanner(plan,{run:f.run,attempts:1}),f.selection.id);
  const calls=f.calls.length;
  assert.throws(()=>cleanupScanner(plan,{run:f.run}),/SCANNER_NOT_OWNED/);
  assert.throws(()=>cleanupScanner({owned:true,selection:f.selection},{run:f.run}),/SCANNER_NOT_OWNED/);
  assert.equal(f.calls.length,calls);
  assert.ok(f.calls.every(args=>['image','inspect','exec'].includes(args[0])));
});

test('failed readiness remains a failure with exact owned cleanup; changed ID never removed',async()=>{
  const f=fakeDocker({ready:false}),plan=prepareScanner({}, {run:f.run});
  await assert.rejects(startScanner(plan,{run:f.run,attempts:1}),/OWNED_SCANNER_NOT_READY/);
  assert.equal(cleanupScanner(plan,{run:f.run}),true);
  const changed=fakeDocker(),other=prepareScanner({}, {run:changed.run});
  await startScanner(other,{run:changed.run,attempts:1});changed.actual.Id='e'.repeat(64);
  assert.throws(()=>cleanupScanner(other,{run:changed.run}),/UNVERIFIED/);
  assert.ok(!changed.calls.some(args=>args[0]==='rm'));
});

test('interrupted scanner recovery checks pinned image and exact proof before deleting',()=>{
  const f=fakeDocker();f.actual.State.Running=false;
  assert.equal(recoverScanner(f.selection,{run:f.run}),true);
  const changed=fakeDocker();changed.actual.Config.Labels['sj.prerequisites.marker']='foreign';
  assert.throws(()=>recoverScanner(changed.selection,{run:changed.run}),/UNVERIFIED/);
  assert.ok(!changed.calls.some(args=>args[0]==='rm'));
});

test('standalone and CI reject incomplete external proof before run storage or infrastructure startup',()=>{
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','USERPROFILE'].includes(key.toUpperCase())));
  for(const file of ['run-sj-isolated-tests.js','run-sj-ci-gate.js']){
    const result=spawnSync(process.execPath,[path.resolve(__dirname,'../../../scripts',file),...(file.includes('isolated')?['--cross-app']:[])],{env:{...env,SJ_TEST_SCANNER_NAME:'production'},encoding:'utf8',windowsHide:true,timeout:10000});
    assert.notEqual(result.status,0);assert.equal(result.stdout,'');
    assert.match(result.stderr,/ISOLATED_HARNESS_FAILED|SJ_CI_GATE_REFUSED/);
    assert.doesNotMatch(result.stderr,/production|postgresql:/);
  }
});

// This records daemon outcomes separately from CLI outcomes. A timeout never
// authorizes start or a positive run, even if the daemon did create a resource.
function uncertainDocker(){
  const base=scannerFixture(),calls=[],containers=new Map();
  const foreignId='e'.repeat(64),foreign={Id:foreignId,Name:'/sj-ops-local-clamav-20260916',Config:{Labels:{'sj.prerequisites.marker':'foreign-shared-service'}},Mounts:[{Type:'volume',Name:'normal-signatures'}]};
  containers.set(foreignId,foreign);
  const state={fault:null,created:null,late:null,persisted:[],removeNoop:false,removeTimeout:false,inventoryFault:null};
  const command=args=>{
    calls.push([...args]);
    if(args[0]==='image')return JSON.stringify([{Id:base.selection.image,RepoDigests:[SCANNER_IMAGE]}]);
    if(args[0]==='ps'){
      if(state.inventoryFault==='timeout')throw Object.assign(Error('unit timeout'),{code:'ETIMEDOUT'});
      if(state.inventoryFault==='malformed')return 'not-a-full-id|foreign';
      return [...containers.values()].map(c=>c.Id+'|'+c.Name.slice(1)).join('\n');
    }
    if(args[0]==='create'){
      assert.equal(state.persisted.at(-1)?.id,null);assert.equal(state.persisted.at(-1)?.creationAttempted,true);
      const actual=structuredClone(base.actual);actual.Name='/'+args[args.indexOf('--name')+1];actual.Config.Labels['sj.prerequisites.marker']=args[args.indexOf('--label')+1].split('=')[1];actual.State.Running=false;
      state.created=actual;
      if(state.fault==='before-create')throw Object.assign(Error('unit timeout'),{code:'ETIMEDOUT'});
      if(state.fault==='late-create'){state.late=actual;throw Object.assign(Error('unit timeout'),{code:'ETIMEDOUT'});}
      containers.set(actual.Id,actual);
      if(state.fault==='after-create')throw Object.assign(Error('unit timeout'),{code:'ETIMEDOUT'});
      if(state.fault==='malformed-id')return 'short-id';
      return actual.Id;
    }
    if(args[0]==='inspect'){
      if(state.fault==='inspect-timeout')throw Object.assign(Error('unit timeout'),{code:'ETIMEDOUT'});
      return JSON.stringify([containers.get(args[1])]);
    }
    if(args[0]==='start'){containers.get(args[1]).State.Running=true;return args[1];}
    if(args[0]==='exec')return '';
    if(args[0]==='rm'){
      assert.deepEqual(args,['rm','-f',base.selection.id]);
      if(!state.removeNoop)containers.delete(args[2]);
      if(state.removeTimeout)throw Object.assign(Error('unit timeout'),{code:'ETIMEDOUT'});
      return args[2];
    }
    throw Error('UNEXPECTED_UNIT_DOCKER');
  };
  const persist=selection=>state.persisted.push(structuredClone(selection));
  const plan=prepareScanner({},{run:command});
  const start=()=>startScanner(plan,{run:command,attempts:1,onAttempt:persist,onCreated:persist});
  return {plan,state,calls,containers,foreignId,foreign,command,persist,start};
}

test('create timeout after daemon success preserves attempt; only cleanup resolves ID without any start',async()=>{
  const f=uncertainDocker();f.state.fault='after-create';
  await assert.rejects(f.start(),/SCANNER_CREATION_UNCERTAIN/);
  assert.equal(f.plan.selection.id,null);assert.equal(f.plan.selection.creationUncertain,true);
  assert.ok(f.state.persisted.length>=2);assert.equal(f.calls.filter(c=>c[0]==='create').length,1);assert.equal(f.calls.filter(c=>c[0]==='start').length,0);
  let removalJournal;
  assert.equal(cleanupScanner(f.plan,{run:f.command,onResolved:selection=>{removalJournal=structuredClone(selection);assert.ok(f.containers.has(selection.id));}}),true);
  assert.equal(removalJournal.id,f.state.created.Id);assert.equal(removalJournal.cleanupResolvedId,true);assert.equal(removalJournal.creationUncertain,true);
  assert.throws(()=>scannerEnvironment(f.plan.selection),/INVALID_TEST_SCANNER_SELECTION/);
  assert.throws(()=>assertScanner(f.state.created,f.plan.selection),/UNVERIFIED/);
  await assert.rejects(f.start(),/SCANNER_ALREADY_CREATED/);
  assert.equal(f.calls.filter(c=>c[0]==='start').length,0);assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
  assert.equal(f.containers.get(f.foreignId),f.foreign);
});

for(const fault of ['before-create','late-create'])test(fault+' absent outcome stays uncertain and never becomes cleanup PASS',async()=>{
  const f=uncertainDocker();f.state.fault=fault;await assert.rejects(f.start(),/SCANNER_CREATION_UNCERTAIN/);
  assert.throws(()=>cleanupScanner(f.plan,{run:f.command}),/SCANNER_CREATION_UNCERTAIN/);
  assert.equal(f.calls.filter(c=>c[0]==='rm').length,0);assert.equal(f.calls.filter(c=>c[0]==='start').length,0);
  if(f.state.late){
    f.containers.set(f.state.late.Id,f.state.late);let resolved;
    assert.equal(recoverScanner(f.plan.selection,{run:f.command,onResolved:selection=>{resolved=selection;}}),true);
    assert.equal(resolved.cleanupResolvedId,true);assert.equal(resolved.creationUncertain,true);
  }
  assert.equal(f.containers.get(f.foreignId),f.foreign);assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
});

test('malformed create result is not success; cleanup still requires actual full ID and capability',async()=>{
  const f=uncertainDocker();f.state.fault='malformed-id';await assert.rejects(f.start(),/SCANNER_CREATION_UNCERTAIN/);
  assert.equal(f.plan.selection.id,null);assert.equal(cleanupScanner(f.plan,{run:f.command}),true);
  assert.equal(f.calls.filter(c=>c[0]==='start').length,0);assert.ok(f.containers.has(f.foreignId));
});

test('failed pre-create persistence prevents the creating command entirely',async()=>{
  const f=uncertainDocker();await assert.rejects(startScanner(f.plan,{run:f.command,attempts:1,onAttempt:()=>{throw Error('UNIT_DISK_FAILURE');}}),/UNIT_DISK_FAILURE/);
  assert.equal(f.calls.filter(c=>c[0]==='create').length,0);assert.equal(cleanupScanner(f.plan,{run:f.command}),true);assert.equal(f.calls.filter(c=>c[0]==='rm').length,0);
});

test('known full ID persisted before failed inspect can only be cleaned, not auto-started',async()=>{
  const f=uncertainDocker();f.state.fault='inspect-timeout';await assert.rejects(f.start(),/SCANNER_CREATION_UNCERTAIN/);
  assert.equal(f.plan.selection.id,f.state.created.Id);assert.equal(f.plan.selection.creationValidated,false);
  assert.throws(()=>cleanupScanner(f.plan,{run:f.command}),/unit timeout/);assert.equal(f.calls.filter(c=>c[0]==='rm').length,0);
  f.state.fault=null;assert.equal(cleanupScanner(f.plan,{run:f.command}),true);assert.equal(f.calls.filter(c=>c[0]==='start').length,0);
});

test('attempt journal refuses an existing exact name before create and never adopts it',async()=>{
  const f=uncertainDocker();f.containers.get(f.foreignId).Name='/'+f.plan.selection.name;
  await assert.rejects(f.start(),/SCANNER_NAME_ALREADY_EXISTS/);
  assert.equal(f.state.persisted.length,0);assert.equal(f.calls.filter(c=>c[0]==='create').length,0);assert.equal(f.calls.filter(c=>c[0]==='rm').length,0);
});

for(const [name,mutate]of [
 ['capability',a=>a.Config.Labels['sj.prerequisites.marker']='f'.repeat(64)],
 ['image',a=>a.Image='sha256:'+'f'.repeat(64)],
 ['creation ref',a=>a.Config.Image='clamav:latest'],
 ['normal signature volume',a=>a.Mounts=[{Type:'volume',Name:'normal-signatures',Destination:'/var/lib/clamav'}]],
 ['host bind',a=>a.HostConfig.Binds=['D:/normal:/var/lib/clamav']],
 ['published port',a=>a.HostConfig.PortBindings={'3310/tcp':[{HostIp:'127.0.0.1',HostPort:'3310'}]}],
 ['privileged',a=>a.HostConfig.Privileged=true],
 ['extra tmpfs',a=>a.HostConfig.Tmpfs['/other']='rw'],
])test('uncertain cleanup refuses changed '+name+' and retains normal scanner',async()=>{
  const f=uncertainDocker();f.state.fault='after-create';await assert.rejects(f.start(),/SCANNER_CREATION_UNCERTAIN/);mutate(f.state.created);
  assert.throws(()=>cleanupScanner(f.plan,{run:f.command}),/UNVERIFIED/);
  assert.equal(f.calls.filter(c=>c[0]==='rm').length,0);assert.equal(f.containers.get(f.foreignId),f.foreign);
});

for(const fault of ['timeout','malformed'])test('uncertain cleanup inventory '+fault+' never removes by name',async()=>{
  const f=uncertainDocker();f.state.fault='after-create';await assert.rejects(f.start(),/SCANNER_CREATION_UNCERTAIN/);f.state.inventoryFault=fault;
  assert.throws(()=>cleanupScanner(f.plan,{run:f.command}),/unit timeout|SCANNER_INVENTORY_INVALID/);
  assert.equal(f.calls.filter(c=>c[0]==='rm').length,0);assert.ok(f.containers.has(f.foreignId));
});

test('cleanup resolution persistence failure prevents removal; second inspect prevents identity race',async()=>{
  const f=uncertainDocker();f.state.fault='after-create';await assert.rejects(f.start(),/SCANNER_CREATION_UNCERTAIN/);
  assert.throws(()=>cleanupScanner(f.plan,{run:f.command,onResolved:()=>{throw Error('UNIT_JOURNAL_FAILED');}}),/UNIT_JOURNAL_FAILED/);
  assert.equal(f.calls.filter(c=>c[0]==='rm').length,0);
  assert.throws(()=>cleanupScanner(f.plan,{run:f.command,onResolved:()=>{f.state.created.Config.Labels['sj.prerequisites.marker']='foreign';}}),/UNVERIFIED/);
  assert.equal(f.calls.filter(c=>c[0]==='rm').length,0);assert.ok(f.containers.has(f.foreignId));
});

for(const fault of ['removeNoop','removeTimeout'])test(fault+' remains failed even when the CLI or daemon claims removal',async()=>{
  const f=uncertainDocker();await f.start();f.state[fault]=true;
  assert.throws(()=>cleanupScanner(f.plan,{run:f.command}),/TEST_SCANNER_CLEANUP_FAILED|unit timeout/);
  assert.equal(f.calls.filter(c=>c[0]==='rm').length,1);assert.ok(f.containers.has(f.foreignId));
});

test('both actual callers persist scanner attempts before create and resolved IDs before removal',()=>{
  const fs=require('node:fs');
  for(const file of ['run-sj-isolated-tests.js','run-sj-ci-gate.js']){
    const source=fs.readFileSync(path.resolve(__dirname,'../../../scripts',file),'utf8');
    assert.match(source,/startScanner\(scannerPlan,\{onAttempt:selection=>\{/);
    assert.match(source,/cleanupScanner\(scannerPlan,\{onResolved:selection=>\{/);
  }
  const source=fs.readFileSync(path.resolve(__dirname,'../../../scripts/run-sj-isolated-tests.js'),'utf8');
  assert.match(source,/proof\.scanner\.creationAttempted===true\|\|ids\.includes\(proof\.scanner\.id\)/);
  assert.match(source,/recoverScanner\(proof\.scanner,\{onResolved:selection=>\{/);
});
