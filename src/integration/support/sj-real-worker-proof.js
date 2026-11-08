// Real-bank worker process faults against the already-proved real SJ peer.
// Only lease/retry clocks are injected; positive states use official services.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const {fork} = require('node:child_process');
module.exports = async function realWorkerProof({proof,token,http,worker,rpc,reviewer,children}) {
  await require('./sj-disposable-guard').assertLive(proof,process.env,token);
  const owned = [];
  const launch = async (holdResponse = false,fastHttp = false) => {
    const env = {...process.env,RUNTIME_ROLE:'seputar-jaminan-worker',SJ_OUTBOX_LEASE_MS:'1000'};
    if(fastHttp)env.SJ_CENTRAL_REQUEST_TIMEOUT_MS='250';
    delete env.SJ_REVIEW_DATABASE_URL;
    const child = fork(path.join(__dirname,'sj-resilience-worker.js'),[],{cwd:proof.root,env,stdio:['ignore','ignore','ignore','ipc']});
    owned.push(child);children.add(child);child.once('exit',()=>children.delete(child));
    const pending = new Map(),events=[];
    child.on('message',m=>{events.push(m);if(pending.has(m.requestId)){const p=pending.get(m.requestId);pending.delete(m.requestId);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.result);}});
    child.on('exit',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('REAL_WORKER_CHILD_EXIT'));}pending.clear();});
    const event = async type => {for(let i=0;i<400;i++){const at=events.findIndex(e=>e.type===type);if(at>=0)return events.splice(at,1)[0];if(child.exitCode!==null||child.signalCode!==null)throw Error('REAL_WORKER_EXIT_BEFORE_'+type);await new Promise(r=>setTimeout(r,25));}throw Error('REAL_WORKER_EVENT_TIMEOUT_'+type);};
    const command = (type,extra={})=>new Promise((resolve,reject)=>{const requestId=crypto.randomUUID();const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('REAL_WORKER_COMMAND_TIMEOUT_'+type));},45000);pending.set(requestId,{resolve,reject,timer});child.send({type,requestId,...extra});});
    child.send({type:'init',proof,token,holdResponse});await event('ready');
    return {child,command,event,kill:()=>new Promise(r=>{child.once('exit',r);child.kill();})};
  };
  let serial=0;
  const queue = async () => {
    let contact=await http('maker','post','/contacts',{label:'Owned resilience '+(++serial),phone_e164:'+628889900'+String(serial).padStart(3,'0')},201);
    contact=await http('maker','post',`/contacts/${contact.id}/submit`,{expected_version:contact.lock_version});
    await worker(); // Actual bank sends immutable snapshot to actual Control.
    await rpc('decide',{kind:'contact',sourceId:contact.id}); // No SJ delivery yet.
    const row=await reviewer.sj_sync_outbox.findFirstOrThrow({where:{aggregate_id:contact.id,event_type:'UPSERT_WHATSAPP_CONTACT'}});
    assert.equal(row.state,'QUEUED');return row;
  };
  const read=id=>reviewer.sj_sync_outbox.findUniqueOrThrow({where:{id}});
  const checks=[];
  const oneEffect=async row=>{
    const result=await rpc('event-proof',{eventId:row.event_id});
    assert.equal(result.count,1);assert.equal(result.state,'APPLIED');
    assert.equal(result.version,row.aggregate_version);assert.equal(result.activeVersion,row.aggregate_version);
    assert.equal(result.effect,'contact-version-and-checksum');
  };
  try {
    const a=await launch(),b=await launch();
    let row=await queue();
    const claims=await Promise.all([a.command('claim'),b.command('claim')]);assert.equal(claims.flat().length,1);
    const old=claims.flat()[0];assert.equal(old.id,row.id);await (claims[0].length?a:b).kill();
    const c=await launch();await c.command('clock-fault',{id:row.id,field:'locked_at'});
    const [again]=await c.command('claim');assert.equal(again.id,row.id);assert.notEqual(again.locked_by,old.locked_by);
    await c.command('deliver',{row:again});assert.equal((await read(row.id)).state,'ACKNOWLEDGED');await oneEffect(row);
    checks.push({check:'real bank two worker processes claim one owner; killed owner restarts with new lease and real SJ accepts one event',pass:true});

    row=await queue();const held=await launch(true);const [claim]=await held.command('claim');
    void held.command('deliver',{row:claim}).catch(()=>{});await held.event('remote-response');await oneEffect(row);await held.kill();
    await c.command('clock-fault',{id:row.id,field:'locked_at'});const [reclaimed]=await c.command('claim');
    await c.command('deliver',{row:reclaimed});assert.equal((await read(row.id)).state,'ACKNOWLEDGED');await oneEffect(row);
    checks.push({check:'real process crash after SJ commit before bank ACK commit; restart resends immutable event and real duplicate ACK has one ingest effect',pass:true});

    row=await queue();const late=await launch(true);const [lateClaim]=await late.command('claim');
    const completion=late.command('deliver',{row:lateClaim});await late.event('remote-response');
    await c.command('clock-fault',{id:row.id,field:'locked_at'});const [newClaim]=await c.command('claim');await c.command('deliver',{row:newClaim});
    late.child.send({type:'release'});await completion;await late.command('fail',{row:lateClaim});
    assert.equal((await read(row.id)).state,'ACKNOWLEDGED');assert.equal((await read(row.id)).attempt_count,newClaim.attempt_count);await oneEffect(row);
    checks.push({check:'real late response/failure from expired bank worker cannot overwrite new owner ACK or create a second SJ ingest event',pass:true});

    row=await queue();const committed=await launch();const [commitClaim]=await committed.command('claim');
    void committed.command('deliver',{row:commitClaim,holdAfterCommit:true}).catch(()=>{});await committed.event('local-commit');await committed.kill();
    assert.equal((await read(row.id)).state,'ACKNOWLEDGED');assert.equal((await c.command('claim')).length,0);await oneEffect(row);
    checks.push({check:'real worker crash after bank local commit leaves terminal ACK and no re-enqueue',pass:true});

    const network=await launch(false,true);
    for(const mode of ['disconnect','timeout','corrupt']) {
      row=await queue();await rpc('transport-fault',{mode});
      try {await network.command('batch');}finally{await rpc('transport-fault',{mode:null});}
      assert.equal((await read(row.id)).state,mode==='corrupt'?'QUARANTINED':'RETRYING');await oneEffect(row);
      if(mode==='corrupt') {
        process.env.SJ_CONTROL_RECOVERY_ENABLED='true';
        try {await rpc('recovery-proof',{jobId:row.id,uniqueSuffix:'transport-'+mode});}finally{delete process.env.SJ_CONTROL_RECOVERY_ENABLED;}
      } else await c.command('clock-fault',{id:row.id,field:'available_at'});
      await c.command('batch');assert.equal((await read(row.id)).state,'ACKNOWLEDGED');await oneEffect(row);
    }
    checks.push({check:'actual SJ commit with socket disconnect, delayed HTTP timeout and corrupt response never becomes false ACK; authorized same-event recovery proves one real ingest effect',pass:true});
    return checks;
  } finally {
    await rpc('transport-fault',{mode:null}).catch(()=>{});
    for(const child of owned)if(child.exitCode===null&&child.signalCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});
  }
};
