// Disposable harness infrastructure only. A CLI timeout never proves that the
// daemon cancelled creation. Persist the attempt before spawning, and reconcile
// uncertainty only for cleanup, never to resume the positive workflow.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {assertLocalDocker} = require('./sj-disposable-guard');
const specifications = Object.freeze({
  pg: Object.freeze({imageRef:'postgres:17-alpine',repository:'postgres',internalPort:5432,dataPath:'/var/lib/postgresql/data'}),
  redis: Object.freeze({imageRef:'redis:7.4.11-alpine',repository:'redis',internalPort:6379,dataPath:'/data'}),
});
const fail = code => { throw Error(code); };
const fullId = value => /^[a-f0-9]{64}$/.test(value || '');
const imageId = value => /^sha256:[a-f0-9]{64}$/.test(value || '');
const same = (left,right) => JSON.stringify(left) === JSON.stringify(right);

function assertOwner(proof) {
  if(proof?.kind!=='RA-SJ-02-disposable-v1'||!/^[a-f0-9]{32}$/.test(proof.runId||'')||!fullId(proof.tokenHash)||!path.isAbsolute(proof.root||''))fail('OWNED_CONTAINER_OWNER_INVALID');
  if(fs.lstatSync(proof.root).isSymbolicLink()||fs.realpathSync(proof.root)!==path.resolve(proof.root))fail('OWNED_CONTAINER_OWNER_INVALID');
  const marker=JSON.parse(fs.readFileSync(path.join(proof.root,'owner.json'),'utf8'));
  if(marker.runId!==proof.runId||marker.tokenHash!==proof.tokenHash)fail('OWNED_CONTAINER_OWNER_INVALID');
}

function boundedDocker(execute,args,env) {
  return execute('docker',args,{env,encoding:'utf8',windowsHide:true,shell:false,
    stdio:['ignore','pipe','pipe'],timeout:30000,killSignal:'SIGKILL',maxBuffer:2*1024*1024}).trim();
}

function containerInventory(call) {
  return call(['ps','-a','--no-trunc','--format','{{.ID}}|{{.Names}}']).split(/\r?\n/).filter(Boolean).map(line=>{
    const fields=line.split('|');
    if(fields.length!==2||!fullId(fields[0])||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(fields[1]))fail('OWNED_CONTAINER_INVENTORY_INVALID');
    return {id:fields[0],name:fields[1]};
  });
}

function assertAttempt(proof,kind,item) {
  assertOwner(proof);
  const spec=specifications[kind];
  if(!spec||item?.creationAttempted!==true||item.name!==`ra-sj-${proof.runId}-${kind}`||
    item.imageRef!==spec.imageRef||!imageId(item.imageId)||item.internalPort!==spec.internalPort||item.dataPath!==spec.dataPath||
    !Array.isArray(item.imageDigests)||!item.imageDigests.length||
    item.imageDigests.some(value=>!new RegExp('^'+spec.repository+'@sha256:[a-f0-9]{64}$').test(value))||
    item.id!==null&&!fullId(item.id))fail('OWNED_CONTAINER_ATTEMPT_INVALID');
  return spec;
}

function assertCleanupIdentity(proof,kind,item,actual,expectedId) {
  assertAttempt(proof,kind,item);
  if(!fullId(expectedId)||actual?.Id!==expectedId||actual.Name!=='/'+item.name||actual.Image!==item.imageId||
    actual.Config?.Image!==item.imageId||actual.Config?.Labels?.['ra-sj.run']!==proof.runId||
    actual.Config?.Labels?.['ra-sj.proof']!==proof.tokenHash)fail('OWNED_CONTAINER_IDENTITY_INVALID');
  if(!Array.isArray(actual.Mounts)||actual.Mounts.some(m=>m.Type!=='tmpfs'||m.Destination!==item.dataPath)||
    actual.HostConfig?.Privileged||!['bridge','default'].includes(actual.HostConfig?.NetworkMode)||actual.HostConfig?.PublishAllPorts||
    (actual.HostConfig?.Binds||[]).length||(actual.HostConfig?.VolumesFrom||[]).length||
    !same(actual.HostConfig?.Tmpfs,{[item.dataPath]:'rw'}))fail('OWNED_CONTAINER_MOUNTS_INVALID');
  const bindings=actual.HostConfig?.PortBindings;
  if(!bindings||!same(Object.keys(bindings),[item.internalPort+'/tcp'])||
    !same(bindings[item.internalPort+'/tcp'],[{HostIp:'127.0.0.1',HostPort:''}])||
    !['created','running','paused','exited','dead'].includes(actual.State?.Status))fail('OWNED_CONTAINER_BINDING_INVALID');
  return expectedId;
}

function createOwnedContainer({proof,kind,env,performance=false,persist}, {execute=execFileSync}={}) {
  assertOwner(proof);
  const spec=specifications[kind];
  if(!spec||typeof persist!=='function'||typeof execute!=='function'||typeof performance!=='boolean'||proof[kind])fail('OWNED_CONTAINER_CREATE_INPUT_INVALID');
  const call=args=>boundedDocker(execute,args,env);
  assertLocalDocker(env,()=>call(['context','inspect','--format','{{.Endpoints.docker.Host}}']));
  const image=JSON.parse(call(['image','inspect',spec.imageRef]))[0];
  if(!imageId(image?.Id)||!Array.isArray(image.RepoDigests)||!image.RepoDigests.length||image.Os!=='linux'||
    image.RepoDigests.some(value=>!new RegExp('^'+spec.repository+'@sha256:[a-f0-9]{64}$').test(value)))fail('OWNED_CONTAINER_LOCAL_IMAGE_INVALID');
  const name=`ra-sj-${proof.runId}-${kind}`;
  if(containerInventory(call).some(row=>row.name===name))fail('OWNED_CONTAINER_NAME_ALREADY_EXISTS');
  const item={name,imageRef:spec.imageRef,imageId:image.Id,imageDigests:[...image.RepoDigests].sort(),
    internalPort:spec.internalPort,dataPath:spec.dataPath,id:null,port:null,creationAttempted:true,
    creationUncertain:false,creationValidated:false};
  proof[kind]=item;persist(); // Must complete before the first creating command.
  const args=['run','-d','--name',name,'--label',`ra-sj.run=${proof.runId}`,'--label',`ra-sj.proof=${proof.tokenHash}`,
    '--tmpfs',`${spec.dataPath}:rw`,'-p',`127.0.0.1::${spec.internalPort}`,
    ...(kind==='pg'?['-e','POSTGRES_PASSWORD','-e','POSTGRES_DB']:[]),image.Id,
    ...(kind==='redis'?['redis-server','--save','','--appendonly','no']:performance?['postgres','-c','shared_preload_libraries=pg_stat_statements']:[])];
  try {
    const id=call(args);
    if(!fullId(id))fail('OWNED_CONTAINER_CREATE_OUTPUT_INVALID');
    item.id=id;persist(); // Retain the exact returned ID even if inspect fails.
    const actual=JSON.parse(call(['inspect',id]))[0];
    assertCleanupIdentity(proof,kind,item,actual,id);
    const live=actual.NetworkSettings?.Ports?.[spec.internalPort+'/tcp'];
    const port=Number(live?.[0]?.HostPort);
    if(!actual.State.Running||actual.State.Paused||actual.State.Restarting||live?.length!==1||live[0].HostIp!=='127.0.0.1'||!Number.isInteger(port)||port<1024||port>65535)fail('OWNED_CONTAINER_LIVE_PORT_INVALID');
    item.port=port;item.creationValidated=true;persist();
    return item;
  } catch {
    item.creationUncertain=true;item.creationFailure='creation or setup outcome not proved';persist();
    // Do not adopt a successful daemon outcome as a positive timeout fallback.
    // The runner's finally may resolve it only for exact owned cleanup.
    fail('OWNED_CONTAINER_CREATE_UNCERTAIN');
  }
}

function cleanupOwnedContainer({proof,kind,env,persist}, {execute=execFileSync}={}) {
  const item=proof?.[kind];
  try {
    assertAttempt(proof,kind,item);
    if(typeof persist!=='function'||typeof execute!=='function')fail('OWNED_CONTAINER_CLEANUP_INPUT_INVALID');
    const call=args=>boundedDocker(execute,args,env);
    assertLocalDocker(env,()=>call(['context','inspect','--format','{{.Endpoints.docker.Host}}']));
    const inventory=containerInventory(call);
    let id=item.id;
    if(!id){
      const matches=inventory.filter(row=>row.name===item.name);
      if(matches.length!==1)fail('OWNED_CONTAINER_CREATION_UNCERTAIN');
      id=matches[0].id; // Name locates an ID only; it never authorizes removal.
    }else if(!inventory.some(row=>row.id===id&&row.name===item.name))fail('OWNED_CONTAINER_CREATION_UNCERTAIN');
    const actual=JSON.parse(call(['inspect',id]))[0];
    assertCleanupIdentity(proof,kind,item,actual,id);
    const image=JSON.parse(call(['image','inspect',item.imageId]))[0];
    if(image?.Id!==item.imageId||!same([...(image.RepoDigests||[])].sort(),item.imageDigests))fail('OWNED_CONTAINER_LOCAL_IMAGE_INVALID');
    if(!item.id){item.id=id;item.cleanupResolvedId=true;persist();}
    // Re-inspect the exact ID after persisting and immediately before removal.
    assertCleanupIdentity(proof,kind,item,JSON.parse(call(['inspect',id]))[0],id);
    call(['rm','-f',id]);
    if(containerInventory(call).some(row=>row.id===id||row.name===item.name))fail('OWNED_CONTAINER_REMOVAL_UNCERTAIN');
    return {kind,removed:true};
  } catch {
    return {kind,removed:false,reason:'creation/ownership/removal outcome not proved; manual inspection required'};
  }
}

module.exports={createOwnedContainer,cleanupOwnedContainer};
