const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {observeOwnedScenario}=require('./sj-owned-scenario');
const fixture=()=>{const c=new EventEmitter();c.connected=true;c.send=()=>{c.connected=false;c.emit('disconnect');};c.kill=()=>{c.emit('close',1,'SIGKILL');return true;};return c;};
test('actual CLOSE, not EXIT, releases scenario resources',async()=>{
  const child=fixture();let closed=false,settled=false;
  const p=observeOwnedScenario(child,{timeoutMs:1000,onClosed:()=>{closed=true;}}).then(r=>{settled=true;return r;});
  child.emit('exit',0,null);await new Promise(r=>setImmediate(r));assert.equal(settled,false);assert.equal(closed,false);
  child.emit('close',0,null);assert.deepEqual(await p,{code:0,signal:null});assert.equal(closed,true);
});
for(const asyncFailure of [false,true])test('IPC journal '+(asyncFailure?'async':'sync')+' failure is caught and waits for cleanup CLOSE',async()=>{
  const child=fixture();let closed=false;
  child.once('disconnect',()=>setTimeout(()=>child.emit('close',1,null),10));
  const p=observeOwnedScenario(child,{timeoutMs:1000,onClosed:()=>{closed=true;},onMessage:asyncFailure?async()=>{throw Error('disk');}:()=>{throw Error('disk');}});
  child.emit('message',{type:'progress'});await assert.rejects(p,/SCENARIO_MESSAGE_OR_JOURNAL_FAILED/);assert.equal(closed,true);
});
test('timeout disconnects exact child and waits for observed close',async()=>{
  const child=fixture();let closed=false;child.once('disconnect',()=>child.emit('close',1,null));
  await assert.rejects(observeOwnedScenario(child,{timeoutMs:5,onClosed:()=>{closed=true;}}),/SCENARIO_TIMEOUT/);assert.equal(closed,true);
});
test('no close retains resources explicitly; no fabricated onClosed callback',async()=>{
  const child=fixture();let closed=false;child.kill=()=>true;
  await assert.rejects(observeOwnedScenario(child,{timeoutMs:1,stopGraceMs:5,closeGraceMs:15,onClosed:()=>{closed=true;}}),e=>e.code==='SCENARIO_CLOSE_UNCONFIRMED');assert.equal(closed,false);
});
test('pending async work is settled before successful close',async()=>{
  const child=fixture();let done=false;
  const p=observeOwnedScenario(child,{timeoutMs:1000,onMessage:async()=>{await new Promise(r=>setTimeout(r,10));done=true;}});
  child.emit('message',{});child.emit('close',0,null);await p;assert.equal(done,true);
});
test('real finite Node IPC callback failure observes actual CLOSE after child disconnect cleanup',async()=>{
  const {fork}=require('node:child_process');
  const child=fork(require.resolve('./sj-owned-scenario-fixture.cjs'),[],{windowsHide:true,execArgv:[],stdio:['ignore','pipe','pipe','ipc']});
  let observed=false;
  await assert.rejects(observeOwnedScenario(child,{timeoutMs:5000,onMessage:async()=>{throw Error('synthetic disk failure');},onClosed:()=>{observed=true;}}),/SCENARIO_MESSAGE_OR_JOURNAL_FAILED/);
  assert.equal(observed,true);assert.equal(child.exitCode,7);
});
