'use strict';
// Finite pure EventEmitter doubles only. No spawned process, browser or service.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {observeOwnedUiChild}=require('./sj-owned-ui-child');
function fixture(){const child=new EventEmitter();child.pid=123456;child.exitCode=null;child.signalCode=null;
  child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.signals=[];
  child.kill=signal=>{child.signals.push(signal);return true;};return child;}
test('EXIT alone cannot satisfy CLOSE or cleanup',async()=>{
  const child=fixture(),o=observeOwnedUiChild(child);let done=false;
  const waiting=o.waitClose(1000).then(value=>{done=true;return value;});
  child.exitCode=0;child.emit('exit',0,null);await new Promise(r=>setImmediate(r));
  assert.equal(done,false);assert.equal(o.closed,false);
  child.emit('close',0,null);assert.equal((await waiting).proof,'ACTUAL_CHILD_CLOSE_NOT_EXIT');
});
test('a CLOSE already observed is not lost by registering stop later',async()=>{
  const child=fixture(),o=observeOwnedUiChild(child);child.exitCode=0;child.emit('close',0,null);
  assert.equal((await o.stop({graceMs:5,forceMs:5})).code,0);assert.deepEqual(child.signals,[]);
});
test('graceful stop waits actual close and does not force kill',async()=>{
  const child=fixture(),o=observeOwnedUiChild(child);
  child.kill=signal=>{child.signals.push(signal);setImmediate(()=>{child.signalCode=signal;child.emit('close',null,signal);});return true;};
  assert.equal((await o.stop({graceMs:50,forceMs:50})).signal,'SIGTERM');assert.deepEqual(child.signals,['SIGTERM']);
});
test('force signal applies only to same child handle after finite graceful timeout',async()=>{
  const child=fixture(),o=observeOwnedUiChild(child);
  child.kill=signal=>{child.signals.push(signal);if(signal==='SIGKILL')setImmediate(()=>child.emit('close',null,signal));return true;};
  assert.equal((await o.stop({graceMs:5,forceMs:50})).signal,'SIGKILL');assert.deepEqual(child.signals,['SIGTERM','SIGKILL']);
});
test('unconfirmed close rejects and never fabricates cleanup',async()=>{
  const child=fixture(),o=observeOwnedUiChild(child);
  await assert.rejects(o.stop({graceMs:5,forceMs:5}),e=>e.code==='UI_CHILD_CLOSE_UNCONFIRMED');assert.equal(o.receipt,null);
});
test('exited but not closed child is awaited without signalling stale PID',async()=>{
  const child=fixture(),o=observeOwnedUiChild(child);child.exitCode=1;
  setTimeout(()=>child.emit('close',1,null),5);
  assert.equal((await o.stop({graceMs:50,forceMs:50})).code,1);assert.deepEqual(child.signals,[]);
});
test('stdout and stderr remain distinct and their final trailing bytes are captured',async()=>{
  const child=fixture(),seen=[],o=observeOwnedUiChild(child,{onStdout:b=>seen.push('o'+b),onStderr:b=>seen.push('e'+b)});
  child.emit('exit',0,null);child.stdout.emit('data',Buffer.from('tail'));child.stderr.emit('data',Buffer.from('error'));
  child.emit('close',0,null);const r=await o.waitClose(50);
  assert.equal(r.stdoutBytes,4);assert.equal(r.stderrBytes,5);assert.deepEqual(seen,['otail','eerror']);
  assert.match(r.stdoutSha256,/^[a-f0-9]{64}$/);assert.notEqual(r.stdoutSha256,r.stderrSha256);
});
test('logging callback exception is fenced and reported only after CLOSE',async()=>{
  const child=fixture(),o=observeOwnedUiChild(child,{onStdout:()=>{throw Error('synthetic private path');}});
  child.stdout.emit('data',Buffer.from('owned'));child.emit('close',0,null);
  await assert.rejects(o.waitClose(50),e=>e.code==='UI_CHILD_LOG_FAILED'&&e.receipt.proof==='ACTUAL_CHILD_CLOSE_NOT_EXIT');
});
test('spawn error is consumed but never accepted as successful start/cleanup',async()=>{
  const child=fixture(),o=observeOwnedUiChild(child);child.emit('error',Error('synthetic secret must not enter receipt'));child.emit('close',-2,null);
  await assert.rejects(o.waitClose(50),e=>e.code==='UI_CHILD_SPAWN_FAILED'&&!JSON.stringify(e.receipt).includes('synthetic secret'));
});
test('invalid wait/stop bounds reject before signalling child',async()=>{
  const child=fixture(),o=observeOwnedUiChild(child);
  for(const value of [0,-1,30_001,Infinity,1.5])await assert.rejects(o.stop({graceMs:value,forceMs:5}),/UI_CHILD_BOUND_INVALID/);
  assert.deepEqual(child.signals,[]);child.emit('close',0,null);
});
test('finite actual Node child retains terminal stream bytes and observed CLOSE',async()=>{
  const {spawn}=require('node:child_process');
  const chunks=[];
  const child=spawn(process.execPath,[require.resolve('./sj-owned-ui-child-fixture.cjs'),'natural'],
    {windowsHide:true,stdio:['ignore','pipe','pipe'],env:{}});
  const observer=observeOwnedUiChild(child,{onStdout:b=>chunks.push(b)});
  try{
    const receipt=await observer.waitClose(5000);
    assert.equal(receipt.code,0);assert.equal(receipt.signal,null);
    assert.equal(receipt.proof,'ACTUAL_CHILD_CLOSE_NOT_EXIT');
    assert.match(Buffer.concat(chunks).toString('utf8'),/owned-fixture-final-tail/);
  }finally{await observer.stop({graceMs:1000,forceMs:1000});}
});
test('finite actual Node child is stopped through its owned handle and observed CLOSE',async()=>{
  const {spawn}=require('node:child_process');
  const child=spawn(process.execPath,[require.resolve('./sj-owned-ui-child-fixture.cjs'),'stop'],
    {windowsHide:true,stdio:['ignore','pipe','pipe'],env:{}});
  const observer=observeOwnedUiChild(child);
  try{
    const receipt=await observer.stop({graceMs:1000,forceMs:1000});
    assert.equal(receipt.pid,child.pid);assert.equal(receipt.proof,'ACTUAL_CHILD_CLOSE_NOT_EXIT');
    assert.equal(observer.closed,true);
  }finally{await observer.stop({graceMs:1000,forceMs:1000});}
});
