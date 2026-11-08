const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createOwnedContainer,cleanupOwnedContainer}=require('./sj-owned-container-create');
const {assertContainer}=require('./sj-disposable-guard');

function fixture(t,kind='pg'){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sj-owned-create-unit-'));
  const proof={kind:'RA-SJ-02-disposable-v1',runId:'a'.repeat(32),tokenHash:'d'.repeat(64),root};
  fs.writeFileSync(path.join(root,'owner.json'),JSON.stringify({runId:proof.runId,tokenHash:proof.tokenHash}));
  t.after(()=>{
    assert.equal(fs.realpathSync(root),path.resolve(root));assert.ok(path.basename(root).startsWith('sj-owned-create-unit-'));
    const marker=JSON.parse(fs.readFileSync(path.join(root,'owner.json'),'utf8'));assert.equal(marker.runId,proof.runId);assert.equal(marker.tokenHash,proof.tokenHash);
    fs.rmSync(root,{recursive:true});
  });
  const env={NODE_ENV:'test'},snapshots=[],calls=[],containers=new Map();
  const ownedId='b'.repeat(64),otherId='c'.repeat(64),image='sha256:'+'e'.repeat(64),repository=kind==='pg'?'postgres':'redis';
  const spec={internalPort:kind==='pg'?5432:6379,dataPath:kind==='pg'?'/var/lib/postgresql/data':'/data'};
  const foreign={Id:otherId,Name:'/untouched-other-run',Config:{Labels:{'ra-sj.run':'f'.repeat(32),'ra-sj.proof':'9'.repeat(64)}}};
  containers.set(otherId,foreign);
  const actual=()=>({Id:ownedId,Name:`/ra-sj-${proof.runId}-${kind}`,Image:image,
    Config:{Image:image,Labels:{'ra-sj.run':proof.runId,'ra-sj.proof':proof.tokenHash}},
    Mounts:[],HostConfig:{Tmpfs:{[spec.dataPath]:'rw'},PortBindings:{[spec.internalPort+'/tcp']:[{HostIp:'127.0.0.1',HostPort:''}]},NetworkMode:'bridge',Privileged:false,PublishAllPorts:false,Binds:[],VolumesFrom:[]},
    State:{Status:'running',Running:true,Paused:false,Restarting:false},
    NetworkSettings:{Ports:{[spec.internalPort+'/tcp']:[{HostIp:'127.0.0.1',HostPort:'55001'}]}}});
  const state={createFault:null,inspectFault:false,removeFault:false,localImageFault:false,lateCreation:false};
  const persist=()=>snapshots.push(JSON.parse(JSON.stringify(proof)));
  const timeout=()=>Object.assign(Error('simulated Docker client timeout'),{code:'ETIMEDOUT'});
  const execute=(command,args,options)=>{
    assert.equal(command,'docker');calls.push({args:[...args],options});
    assert.equal(options.timeout,30000);assert.equal(options.killSignal,'SIGKILL');assert.equal(options.shell,false);assert.equal(options.windowsHide,true);
    if(args[0]==='context')return 'npipe:////./pipe/dockerDesktopLinuxEngine';
    if(args[0]==='image')return JSON.stringify([{Id:image,RepoDigests:[repository+'@sha256:'+'e'.repeat(64)],Os:state.localImageFault?'windows':'linux'}]);
    if(args[0]==='ps')return [...containers.values()].map(c=>c.Id+'|'+c.Name.slice(1)).join('\n');
    if(args[0]==='run'){
      assert.equal(snapshots.at(-1)[kind].creationAttempted,true);assert.equal(snapshots.at(-1)[kind].id,null);
      assert.equal(args.filter(a=>a==='run').length,1);assert.ok(args.includes(image));assert.ok(!args.includes(kind==='pg'?'postgres:17-alpine':'redis:7.4.11-alpine'));
      if(state.createFault==='beforeCreation')throw timeout();
      if(state.createFault==='lateCreation'){state.lateCreation=true;throw timeout();}
      containers.set(ownedId,actual());
      if(state.createFault==='afterCreation')throw timeout();
      if(state.createFault==='malformed')return 'not-a-full-id';
      return ownedId;
    }
    if(args[0]==='inspect'){
      assert.equal(args[1],ownedId);if(state.inspectFault)throw timeout();
      return JSON.stringify([containers.get(args[1])]);
    }
    if(args[0]==='rm'){
      assert.deepEqual(args,['rm','-f',ownedId]);containers.delete(ownedId);
      if(state.removeFault)throw timeout();return ownedId;
    }
    throw Error('Unexpected doubled Docker command');
  };
  const create=()=>createOwnedContainer({proof,kind,env,persist,performance:kind==='pg'}, {execute});
  const cleanup=()=>cleanupOwnedContainer({proof,kind,env,persist},{execute});
  return {root,proof,kind,env,snapshots,calls,containers,ownedId,otherId,image,state,actual,create,cleanup,execute,persist};
}

for(const kind of ['pg','redis'])test(kind+' creation is persisted before spawn, image-pinned and operation-bounded',t=>{
  const f=fixture(t,kind),item=f.create();
  assert.equal(item.id,f.ownedId);assert.equal(item.port,55001);assert.equal(item.creationValidated,true);assert.equal(item.creationUncertain,false);
  assert.equal(f.calls.filter(c=>c.args[0]==='run').length,1);
  assert.equal(assertContainer(f.proof,item,id=>f.containers.get(id)).Id,f.ownedId);
  assert.deepEqual(f.cleanup(),{kind,removed:true});assert.ok(f.containers.has(f.otherId));
});

test('client timeout after actual creation never becomes a successful create; cleanup resolves exact owned ID',t=>{
  const f=fixture(t);f.state.createFault='afterCreation';assert.throws(f.create,/OWNED_CONTAINER_CREATE_UNCERTAIN/);
  assert.equal(f.proof.pg.id,null);assert.equal(f.proof.pg.creationUncertain,true);assert.equal(f.proof.pg.creationValidated,false);
  assert.deepEqual(f.cleanup(),{kind:'pg',removed:true});assert.equal(f.proof.pg.id,f.ownedId);assert.equal(f.proof.pg.cleanupResolvedId,true);
  assert.equal(f.proof.pg.creationUncertain,true);assert.equal(f.calls.filter(c=>c.args[0]==='run').length,1);assert.ok(f.containers.has(f.otherId));
});

test('missing result after create timeout stays unknown, not cleaned or retried',t=>{
  const f=fixture(t);f.state.createFault='beforeCreation';assert.throws(f.create,/OWNED_CONTAINER_CREATE_UNCERTAIN/);
  assert.equal(f.cleanup().removed,false);assert.equal(f.proof.pg.id,null);assert.equal(f.calls.filter(c=>c.args[0]==='rm').length,0);assert.equal(f.calls.filter(c=>c.args[0]==='run').length,1);
});

test('late daemon creation cannot retroactively turn an absent lookup into cleanup PASS',t=>{
  const f=fixture(t);f.state.createFault='lateCreation';assert.throws(f.create,/OWNED_CONTAINER_CREATE_UNCERTAIN/);
  const first=f.cleanup();assert.equal(first.removed,false);assert.equal(f.calls.filter(c=>c.args[0]==='rm').length,0);
  f.containers.set(f.ownedId,f.actual()); // Test double only: daemon completes after first lookup.
  assert.equal(first.removed,false);assert.deepEqual(f.cleanup(),{kind:'pg',removed:true});assert.equal(f.calls.filter(c=>c.args[0]==='run').length,1);assert.ok(f.containers.has(f.otherId));
});

test('malformed creating output retains attempt and only proved identity can be cleaned',t=>{
  const f=fixture(t);f.state.createFault='malformed';assert.throws(f.create,/OWNED_CONTAINER_CREATE_UNCERTAIN/);
  assert.equal(f.proof.pg.id,null);assert.deepEqual(f.cleanup(),{kind:'pg',removed:true});
});

test('exact name already exists: no creating command or adoption',t=>{
  const f=fixture(t);f.containers.get(f.otherId).Name=`/ra-sj-${f.proof.runId}-pg`;
  assert.throws(f.create,/OWNED_CONTAINER_NAME_ALREADY_EXISTS/);assert.equal(f.proof.pg,undefined);assert.equal(f.calls.filter(c=>c.args[0]==='run').length,0);assert.ok(f.containers.has(f.otherId));
});

const defects=[
  ['run label',a=>a.Config.Labels['ra-sj.run']='f'.repeat(32)],
  ['capability hash',a=>a.Config.Labels['ra-sj.proof']='f'.repeat(64)],
  ['full ID',a=>a.Id='f'.repeat(64)],
  ['name',a=>a.Name='/foreign'],
  ['image ID',a=>a.Image='sha256:'+'f'.repeat(64)],
  ['creation image ref',a=>a.Config.Image='postgres:17-alpine'],
  ['bind mount',a=>a.Mounts=[{Type:'bind',Destination:'/var/lib/postgresql/data'}]],
  ['volume mount',a=>a.Mounts=[{Type:'volume',Destination:'/var/lib/postgresql/data'}]],
  ['wrong tmpfs',a=>a.HostConfig.Tmpfs={'/outside':'rw'}],
  ['extra tmpfs',a=>a.HostConfig.Tmpfs['/outside']='rw'],
  ['host bind',a=>a.HostConfig.Binds=['/host:/data']],
  ['volumes from',a=>a.HostConfig.VolumesFrom=['other']],
  ['privileged',a=>a.HostConfig.Privileged=true],
  ['host network',a=>a.HostConfig.NetworkMode='host'],
  ['publish all ports',a=>a.HostConfig.PublishAllPorts=true],
  ['nonloopback binding',a=>a.HostConfig.PortBindings['5432/tcp'][0].HostIp='0.0.0.0'],
  ['non-ephemeral binding',a=>a.HostConfig.PortBindings['5432/tcp'][0].HostPort='5432'],
];
for(const [name,mutate]of defects)test('uncertain cleanup rejects '+name+' without removing any container',t=>{
  const f=fixture(t);f.state.createFault='afterCreation';assert.throws(f.create,/OWNED_CONTAINER_CREATE_UNCERTAIN/);
  mutate(f.containers.get(f.ownedId));assert.equal(f.cleanup().removed,false);assert.equal(f.calls.filter(c=>c.args[0]==='rm').length,0);assert.ok(f.containers.has(f.ownedId));assert.ok(f.containers.has(f.otherId));
});

test('inspect timeout remains failed/unknown and performs no cleanup mutation',t=>{
  const f=fixture(t);f.state.inspectFault=true;assert.throws(f.create,/OWNED_CONTAINER_CREATE_UNCERTAIN/);
  assert.equal(f.proof.pg.id,f.ownedId);assert.equal(f.cleanup().removed,false);assert.equal(f.calls.filter(c=>c.args[0]==='rm').length,0);
});

test('remove timeout is not converted to PASS even when doubled daemon removed resource',t=>{
  const f=fixture(t);f.create();f.state.removeFault=true;
  assert.equal(f.cleanup().removed,false);assert.equal(f.containers.has(f.ownedId),false);assert.ok(f.containers.has(f.otherId));assert.equal(f.calls.filter(c=>c.args[0]==='rm').length,1);
});

test('cleanup-only stopped proof cannot authorize the unchanged normal runtime guard',t=>{
  const f=fixture(t);f.create();const actual=f.containers.get(f.ownedId);actual.State={Status:'exited',Running:false,Paused:false,Restarting:false};actual.NetworkSettings.Ports={};
  assert.throws(()=>assertContainer(f.proof,f.proof.pg,id=>f.containers.get(id)));
  assert.deepEqual(f.cleanup(),{kind:'pg',removed:true});assert.ok(f.containers.has(f.otherId));
});

test('wrong owner marker rejects before any Docker call and never clears another run',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.root,'owner.json'),JSON.stringify({runId:'f'.repeat(32),tokenHash:f.proof.tokenHash}));
  assert.throws(f.create,/OWNED_CONTAINER_OWNER_INVALID/);assert.equal(f.calls.length,0);
  // Restore only the unit-owned marker so after-hook can prove its cleanup target.
  fs.writeFileSync(path.join(f.root,'owner.json'),JSON.stringify({runId:f.proof.runId,tokenHash:f.proof.tokenHash}));
});

test('remote context rejected before any creating command or attempt record',t=>{
  const f=fixture(t);f.env.DOCKER_HOST='tcp://127.0.0.1:2375';assert.throws(f.create,/SJ_TEST_TARGET_NOT_OWNED/);assert.equal(f.calls.length,0);assert.equal(f.proof.pg,undefined);
});

test('non-Linux image fails before creating or persisting attempt',t=>{
  const f=fixture(t);f.state.localImageFault=true;assert.throws(f.create,/OWNED_CONTAINER_LOCAL_IMAGE_INVALID/);assert.equal(f.calls.filter(c=>c.args[0]==='run').length,0);assert.equal(f.proof.pg,undefined);
});

test('runner uses helper for normal creation/cleanup/recovery but retains normal runtime guard',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../scripts/run-sj-isolated-tests.js'),'utf8');
  assert.match(source,/createOwnedContainer\(\{proof,kind,env:/);assert.match(source,/cleanupOwnedContainer\(\{proof,kind,env:baseEnv\(\),persist:save\}\)/);
  assert.match(source,/cleanupOwnedContainer\(\{proof,kind,env:baseEnv\(\),persist:\(\)=>fs\.writeFileSync\(proofPath/);
  assert.match(source,/assertContainer\(proof,proof\[kind\]\)/);assert.doesNotMatch(source,/execFileSync\('docker',\['run'/);
});

for(const fault of ['invalid-json','empty-result','inventory-timeout','inventory-malformed'])test('uncertain cleanup rejects '+fault+' before removal (Docker double)',t=>{
  const f=fixture(t);f.state.createFault='afterCreation';assert.throws(f.create,/OWNED_CONTAINER_CREATE_UNCERTAIN/);
  const execute=(command,args,options)=>{
    if(args[0]==='inspect'&&fault==='invalid-json')return '{broken';
    if(args[0]==='inspect'&&fault==='empty-result')return '[]';
    if(args[0]==='ps'&&fault==='inventory-timeout')throw Object.assign(Error('unit timeout'),{code:'ETIMEDOUT'});
    if(args[0]==='ps'&&fault==='inventory-malformed')return 'short-id|unexpected';
    return f.execute(command,args,options);
  };
  assert.equal(cleanupOwnedContainer({proof:f.proof,kind:'pg',env:f.env,persist:f.persist},{execute}).removed,false);
  assert.equal(f.calls.filter(c=>c.args[0]==='rm').length,0);assert.ok(f.containers.has(f.ownedId));assert.ok(f.containers.has(f.otherId));
});

test('successful rm response without actual removal cannot prove cleanup (Docker double)',t=>{
  const f=fixture(t);f.create();
  const execute=(command,args,options)=>args[0]==='rm'?f.ownedId:f.execute(command,args,options);
  assert.equal(cleanupOwnedContainer({proof:f.proof,kind:'pg',env:f.env,persist:f.persist},{execute}).removed,false);
  assert.ok(f.containers.has(f.ownedId));assert.ok(f.containers.has(f.otherId));
});

test('persist failure prevents creating command; infrastructure module imports no DB/runtime',t=>{
  const f=fixture(t);
  assert.throws(()=>createOwnedContainer({proof:f.proof,kind:'pg',env:f.env,persist:()=>{throw Error('unit disk failure');}},{execute:f.execute}),/unit disk failure/);
  assert.equal(f.calls.filter(c=>c.args[0]==='run').length,0);assert.ok(f.containers.has(f.otherId));
  const source=fs.readFileSync(path.join(__dirname,'sj-owned-container-create.js'),'utf8');
  assert.deepEqual([...source.matchAll(/require\('([^']+)'\)/g)].map(m=>m[1]),['node:fs','node:path','node:child_process','./sj-disposable-guard']);
});
