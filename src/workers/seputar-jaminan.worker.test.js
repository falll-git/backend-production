const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('worker retries a failed cycle and drains an active cycle before shutdown', {timeout:5000}, async t => {
  // Unit fault injection only. Real DB role/claim/restart evidence lives in the
  // disposable process harness; these substitutes cannot connect to a database.
  const originalLoad=Module._load;
  const previous={role:process.env.RUNTIME_ROLE,poll:process.env.SJ_OUTBOX_POLL_INTERVAL_MS};
  process.env.SJ_OUTBOX_POLL_INTERVAL_MS='1';
  const calls={connect:0,disconnect:0,start:0,stop:0,cycles:0,warnings:[]};
  let release,second;
  const active=new Promise(r=>{second=r;});
  const logger={info(){},warn(data){calls.warnings.push(data);}};
  const substitutes={
    '../config/env':{loadEnv(){},validateEnv(){}},
    '../config/prisma':{$connect:async()=>{calls.connect++;},$disconnect:async()=>{calls.disconnect++;},$queryRawUnsafe:async()=>[{is_superuser:false,bypass_rls:false,is_worker_member:true}]},
    '../modules/seputar-jaminan/syncWorker.service':{
      safeLocalErrorCode:()=> 'LOCAL_TEST_FAULT',
      runSyncCycle:async()=>{
        calls.cycles++;
        if(calls.cycles===1)throw Error('explicit unit cycle fault');
        second();await new Promise(r=>{release=r;});
        return {processed_count:0};
      },
    },
    '../system/logger':{logger:{child:()=>logger}},
    '../system/worker-heartbeat':{createSeputarJaminanWorkerHeartbeat:()=>({start:async()=>{calls.start++;},stop:async()=>{calls.stop++;}})},
  };
  Module._load=function(request,parent,...rest){
    if(parent?.filename===require.resolve('./seputar-jaminan.worker')&&substitutes[request])return substitutes[request];
    return originalLoad.call(this,request,parent,...rest);
  };
  t.after(()=>{
    Module._load=originalLoad;
    for(const [key,value] of [['RUNTIME_ROLE',previous.role],['SJ_OUTBOX_POLL_INTERVAL_MS',previous.poll]]){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  });
  const worker=await require('./seputar-jaminan.worker').startSeputarJaminanWorker({registerSignals:false});
  await active;
  const stopped=worker.shutdown();
  assert.equal(calls.disconnect,0);assert.equal(calls.stop,0);
  release();await stopped;
  assert.equal(calls.cycles,2);assert.equal(calls.connect,1);assert.equal(calls.disconnect,1);
  assert.equal(calls.start,1);assert.equal(calls.stop,1);
  assert.deepEqual(calls.warnings,[{event:'sj_worker_cycle_failed',code:'LOCAL_TEST_FAULT'}]);
});
