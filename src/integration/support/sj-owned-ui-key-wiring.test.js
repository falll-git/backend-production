'use strict';
// VM/unit doubles only: no service, browser, port bind or spawn.
// Executes actual exported setup/finally and exact parent retention source.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),util=require('node:util');
function wire({factoryCode='EEXIST',probeFailure=false}={}){
  const filename=require.resolve('./sj-three-ui-browser'),source=fs.readFileSync(filename,'utf8');
  const writes=new Map();let factories=0,spawns=0;
  const forbidden=()=>{throw Error('UNEXPECTED_UNIT_SIDE_EFFECT');};
  const server=()=>({
    onError:null,once(event,callback){if(event==='error')this.onError=callback;return this;},
    listen(_port,_host,callback){queueMicrotask(()=>probeFailure?this.onError(Error('UNIT_PROBE_OCCUPIED')):callback());},
    close(callback){callback();},closeAllConnections(){}
  });
  const execFile=forbidden;execFile[util.promisify.custom]=async()=>({stdout:'### Result\n[]\n### End',stderr:''});
  const modules={
    'node:fs':{mkdirSync(){},writeFileSync(file,bytes){writes.set(path.basename(file),String(bytes));},readFileSync:forbidden},
    'node:path':path,'node:http':{createServer:server,get:forbidden,request:forbidden},'node:net':{createServer:server},
    'node:crypto':require('node:crypto'),'node:assert/strict':assert,'node:util':util,
    'node:child_process':{spawn(){spawns++;return forbidden();},execFile},
    './sj-peer-paths':{peerRoot:forbidden},'./sj-disposable-guard':{assertContainer(){},digest:forbidden},
    './sj-browser-code-file':{runBrowserCode:forbidden},'./sj-harness-error':{safeHarnessError:()=>({unit:true})},
    './sj-owned-ui-child':{observeOwnedUiChild:forbidden},'./sj-owned-ui-logs':{createOwnedUiLogs:forbidden},
    './sj-owned-ui-key':{createOwnedUiKey(){factories++;const error=Error('UNIT_SETUP_REFUSAL');error.code=factoryCode;throw error;}},
    './sj-step6-browser-observer':{installBrowserObserver(){},readBrowserObserver(){}},
    './sj-step6-review-ui':{decideThroughUi:forbidden},'./sj-step6-visible-media':{collectVisibleMedia:forbidden},
    './sj-browser-toolchain':{resolveCliToolchain:()=>({entry:'UNIT_CLI_NOT_EXECUTED'})},
    './sj-step6-browser-profile':{ownedBrowserProfile:()=>null},
    './sj-browser-selection':{resolveTestBrowserSelection:forbidden,browserCommandArgs:args=>args}
  };
  const module={exports:{}};
  const sandbox={module,exports:module.exports,require(request){assert.equal(Object.hasOwn(modules,request),true,'unknown unit dependency');return modules[request];},
    process:{execPath:process.execPath,env:{}},Buffer,setTimeout:forbidden,clearTimeout(){},queueMicrotask};
  new vm.Script(source,{filename}).runInNewContext(sandbox,{timeout:1000});
  const invoke=cross=>module.exports.run({proof:{runId:'a'.repeat(32),root:path.join(osTemporaryShape(),'unit-root'),pg:{}},cross:{...cross}});
  return {invoke,writes,get factories(){return factories;},get spawns(){return spawns;}};
}
function osTemporaryShape(){return path.join(path.parse(process.cwd()).root,'unit-no-filesystem');}
test('actual browser exported run propagates key mode collision as unconfirmed cleanup', {timeout:2000},async()=>{
  const unit=wire({factoryCode:'EEXIST'});
  await assert.rejects(unit.invoke({}),error=>error.code==='UI_CHILD_CLOSE_UNCONFIRMED');
  const cleanup=JSON.parse(unit.writes.get('ui-cleanup.json'));
  assert.equal(cleanup.pass,false);assert.equal(cleanup.bankKey,null);
  assert.deepEqual(cleanup.errors,['UI_KEY_SETUP_UNCONFIRMED_RETAIN_RESOURCES']);assert.equal(unit.factories,1);assert.equal(unit.spawns,0);
});
test('actual browser finally conservatively retains partial key setup failure', {timeout:2000},async()=>{
  const unit=wire({factoryCode:'ENOSPC'});
  await assert.rejects(unit.invoke({}),error=>error.code==='UI_CHILD_CLOSE_UNCONFIRMED');
  assert.equal(JSON.parse(unit.writes.get('ui-cleanup.json')).errors.includes('UI_KEY_SETUP_UNCONFIRMED_RETAIN_RESOURCES'),true);
  assert.equal(unit.factories,1);assert.equal(unit.spawns,0);
});
test('failure before key setup is not falsely described as unknown key launch', {timeout:2000},async()=>{
  const unit=wire({probeFailure:true});
  await assert.rejects(unit.invoke({}),error=>error.message==='THREE_UI_FAILED_setup'&&error.code!=='UI_CHILD_CLOSE_UNCONFIRMED');
  const cleanup=JSON.parse(unit.writes.get('ui-cleanup.json'));
  assert.equal(cleanup.pass,true);assert.deepEqual(cleanup.errors,[]);assert.equal(unit.factories,0);assert.equal(unit.spawns,0);
});
test('conflicting mode flags refuse before any UI setup or factory invocation', {timeout:2000},async()=>{
  const unit=wire();await assert.rejects(unit.invoke({uiInitialProfileMode:true,uiFinalLifecycleMode:true}),/mutually exclusive UI key modes/);
  assert.equal(unit.writes.size,0);assert.equal(unit.factories,0);assert.equal(unit.spawns,0);
});
test('actual parent assignment and retention branch recognize the browser error code',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../scripts/run-sj-isolated-tests.js'),'utf8');
  const assignmentStart=source.indexOf("ownedUiCloseUnconfirmed=result?.code==='UI_CHILD_CLOSE_UNCONFIRMED';");
  assert.equal(assignmentStart>=0,true,'parent exact retention assignment missing');
  const assignment=source.slice(assignmentStart,source.indexOf(';',assignmentStart)+1);
  const start=source.indexOf('if(activeScenario||ownedUiCloseUnconfirmed){'),end=source.indexOf('    if(admin)',start);
  assert.equal(start>=0&&end>start,true,'parent bounded retention branch missing');
  const branch=source.slice(start,end);
  // Execute the actual source slice, not a retyped policy. Side effects remain
  // in-memory doubles; no actual report, IPC, resource or environment is touched.
  const policy=new Function('result',`let ownedUiCloseUnconfirmed=false;${assignment}
    const activeScenario=null,report={cleanup:[]};let saved=0,disposed=0;
    const process={connected:false,exitCode:0},save=()=>saved++,cancellation={dispose:()=>disposed++};
    const outcome=(()=>{${branch}return 'CONTINUE_RESOURCE_CLEANUP';})();
    return {report,saved,disposed,outcome,exitCode:process.exitCode};`);
  const retained=policy({code:'UI_CHILD_CLOSE_UNCONFIRMED'});
  assert.equal(retained.report.status,'failed');assert.equal(retained.report.cleanup[0].removed,false);
  assert.equal(retained.report.cleanup[0].kind,'unconfirmed owned UI CLOSE resource retention');
  assert.equal(retained.saved,1);assert.equal(retained.disposed,1);assert.equal(retained.exitCode,1);assert.equal(retained.outcome,undefined);
  const ordinary=policy({code:'Error'});assert.equal(ordinary.outcome,'CONTINUE_RESOURCE_CLEANUP');assert.deepEqual(ordinary.report.cleanup,[]);
});
