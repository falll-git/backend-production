'use strict';
// Register immediately after spawn. Keep the actual ChildProcess handle; never
// enumerate or signal a PID. EXIT alone is not cleanup or a drained-log proof.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const bounded=ms=>assert.ok(Number.isInteger(ms)&&ms>0&&ms<=30_000,'UI_CHILD_BOUND_INVALID');
function observeOwnedUiChild(child,{onStdout=()=>{},onStderr=()=>{}}={}){
  assert.ok(child&&typeof child.once==='function'&&typeof child.kill==='function','OWNED_CHILD_HANDLE_REQUIRED');
  assert.equal(typeof onStdout,'function');assert.equal(typeof onStderr,'function');
  const startedAt=new Date().toISOString();
  let closed=false,receipt,spawnError=false,logError=false,finish;
  const streams={stdout:{bytes:0,hash:crypto.createHash('sha256')},stderr:{bytes:0,hash:crypto.createHash('sha256')}};
  const closedPromise=new Promise(resolve=>{finish=resolve;});
  child.on('error',()=>{spawnError=true;});
  for(const [name,callback] of [['stdout',onStdout],['stderr',onStderr]]){
    child[name]?.on('data',value=>{
      const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);
      streams[name].bytes+=bytes.length;streams[name].hash.update(bytes);
      try{callback(bytes);}catch{logError=true;}
    });
    child[name]?.on('error',()=>{logError=true;});
  }
  child.once('close',(code,signal)=>{
    closed=true;
    receipt={pid:child.pid??null,startedAt,closedAt:new Date().toISOString(),code,signal,
      spawnError,logError,stdoutBytes:streams.stdout.bytes,stderrBytes:streams.stderr.bytes,
      stdoutSha256:streams.stdout.hash.digest('hex'),stderrSha256:streams.stderr.hash.digest('hex'),
      proof:'ACTUAL_CHILD_CLOSE_NOT_EXIT'};
    finish(receipt);
  });
  async function waitClose(timeoutMs=10_000){
    bounded(timeoutMs);let timer;
    try{
      const value=await Promise.race([closedPromise,new Promise((resolve,reject)=>{
        timer=setTimeout(()=>{const error=Error('UI_CHILD_CLOSE_UNCONFIRMED_RETAIN_RESOURCES');
          error.code='UI_CHILD_CLOSE_UNCONFIRMED';reject(error);},timeoutMs);
      })]);
      if(value.spawnError||value.logError){const error=Error(value.spawnError?'UI_CHILD_SPAWN_FAILED':'UI_CHILD_LOG_FAILED');
        error.code=error.message;error.receipt=value;throw error;}
      return value;
    }finally{clearTimeout(timer);}
  }
  async function stop({graceMs=10_000,forceMs=10_000}={}){
    bounded(graceMs);bounded(forceMs);
    if(!closed&&child.exitCode==null&&child.signalCode==null){
      // A refused signal is not proof the process is absent; still await CLOSE.
      try{child.kill('SIGTERM');}catch{}
    }
    if(!closed){let graceTimer;
      try{await Promise.race([closedPromise,new Promise(resolve=>{graceTimer=setTimeout(resolve,graceMs);})]);}
      finally{clearTimeout(graceTimer);}
    }
    if(!closed&&child.exitCode==null&&child.signalCode==null){try{child.kill('SIGKILL');}catch{}}
    return waitClose(forceMs);
  }
  return {waitClose,stop,get receipt(){return receipt??null;},get closed(){return closed;}};
}
module.exports={observeOwnedUiChild};
