'use strict';
// Pure configuration/refusal tests. Injected resolvers are explicit doubles;
// installed-byte and portable-proof predicates have their own fixture tests.
// No CLI, browser, Docker, database or application server is executed here.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {resolveBrowserRunConfig}=require('./sj-browser-run-config');

const explicit={SJ_TEST_PLAYWRIGHT_CLI_ROOT:'C:/owned-cli/node_modules',
  SJ_TEST_PLAYWRIGHT_CLI_PIN:JSON.stringify({unit:'not-a-real-toolchain-pin'}),
  SJ_TEST_BROWSER_PROOF:'C:/owned-browser/proof.json'};
function observed({toolchainFailure=false,selectionFailure=false}={}){
  const calls=[];
  return {calls,dependencies:{
    resolveCliToolchain(value){calls.push({kind:'toolchain',value});if(toolchainFailure)throw Error('TOOLCHAIN_HASH_MISMATCH');return {cliExecuted:false};},
    resolveTestBrowserSelection(value){calls.push({kind:'selection',value});if(selectionFailure)throw Error('BROWSER_PROOF_DRIFT');return value?{version:'157.0.8099.0',proofPath:value}:null;},
  }};
}
test('browser-only verifies the explicit CLI and browser without enabling performance',()=>{
  const o=observed(),input={browser:true,performance:false,env:{...explicit}};
  const result=resolveBrowserRunConfig(input,o.dependencies);
  assert.deepEqual(o.calls.map(call=>call.kind),['toolchain','selection']);
  assert.equal(input.performance,false);
  assert.equal(result.browserToolchain.root,explicit.SJ_TEST_PLAYWRIGHT_CLI_ROOT);
  assert.deepEqual(result.browserToolchain.pin,{unit:'not-a-real-toolchain-pin'});
  assert.equal(result.browserSelection.proofPath,explicit.SJ_TEST_BROWSER_PROOF);
});
test('performance retains the same explicit prerequisite resolution',()=>{
  const o=observed();
  const result=resolveBrowserRunConfig({browser:true,performance:true,env:{...explicit}},o.dependencies);
  assert.equal(result.browserSelection.version,'157.0.8099.0');
  assert.deepEqual(o.calls.map(call=>call.kind),['toolchain','selection']);
});
test('service-only runs do not resolve or launch browser tooling',()=>{
  const o=observed();
  assert.deepEqual(resolveBrowserRunConfig({browser:false,performance:false,env:{}},o.dependencies),
    {browserToolchain:null,browserSelection:null});
  assert.deepEqual(o.calls,[]);
});
for(const key of Object.keys(explicit))test('service-only refuses browser option '+key,()=>{
  const o=observed();
  assert.throws(()=>resolveBrowserRunConfig({browser:false,performance:false,env:{[key]:explicit[key]}},o.dependencies),/EXPLICIT_BROWSER_REQUIRES_BROWSER_RUN/);
  assert.deepEqual(o.calls,[]);
});
for(const key of ['SJ_TEST_PLAYWRIGHT_CLI_ROOT','SJ_TEST_PLAYWRIGHT_CLI_PIN'])
  for(const missing of [undefined,''])test('browser-only refuses missing/empty '+key+' '+String(missing),()=>{
    const o=observed();
    assert.throws(()=>resolveBrowserRunConfig({browser:true,performance:false,env:{...explicit,[key]:missing}},o.dependencies),/PINNED_BROWSER_TOOLCHAIN_REQUIRED/);
    assert.deepEqual(o.calls,[]);
  });
test('malformed pin is refused without asking either resolver to run',()=>{
  const o=observed();
  assert.throws(()=>resolveBrowserRunConfig({browser:true,performance:false,env:{...explicit,SJ_TEST_PLAYWRIGHT_CLI_PIN:'{invalid'}},o.dependencies),/BROWSER_TOOLCHAIN_PIN_INVALID_JSON/);
  assert.deepEqual(o.calls,[]);
});
test('drifted CLI fails before browser-proof resolution, with no fallback download',()=>{
  const o=observed({toolchainFailure:true});
  assert.throws(()=>resolveBrowserRunConfig({browser:true,performance:false,env:{...explicit}},o.dependencies),/TOOLCHAIN_HASH_MISMATCH/);
  assert.deepEqual(o.calls.map(call=>call.kind),['toolchain']);
});
test('drifted portable proof is not replaced by a default browser',()=>{
  const o=observed({selectionFailure:true});
  assert.throws(()=>resolveBrowserRunConfig({browser:true,performance:false,env:{...explicit}},o.dependencies),/BROWSER_PROOF_DRIFT/);
});
test('an omitted explicit browser retains CLI default but still requires pinned CLI',()=>{
  const o=observed(),env={...explicit};delete env.SJ_TEST_BROWSER_PROOF;
  assert.equal(resolveBrowserRunConfig({browser:true,performance:false,env},o.dependencies).browserSelection,null);
  assert.equal(o.calls[1].value,undefined);
});
test('performance cannot exist without browser scope',()=>{
  const o=observed();
  assert.throws(()=>resolveBrowserRunConfig({browser:false,performance:true,env:{}},o.dependencies),/PERFORMANCE_REQUIRES_BROWSER_RUN/);
  assert.deepEqual(o.calls,[]);
});
test('runner calls real config predicates before scanner, Docker pin or owned mkdir',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../../../scripts/run-sj-isolated-tests.js'),'utf8');
  const main=source.slice(source.indexOf('async function main(workflow = false)'));
  assert.match(main,/resolveBrowserRunConfig\(\{browser:browserRun\(\),performance:performanceRun\(\),env:process\.env\}\)/);
  const guard=main.indexOf('.resolveBrowserRunConfig(');
  assert.ok(guard>=0&&guard<main.indexOf('scannerSelection();'));
  assert.ok(guard<main.indexOf('pinLocalDocker()'));
  assert.ok(guard<main.indexOf('fs.mkdtempSync('));
  assert.doesNotMatch(main,/EXPLICIT_BROWSER_REQUIRES_PERFORMANCE_RUN/);
  assert.match(main,/cross\.performance=performanceRun\(\)/);
});
for(const filename of ['sj-cross-app-browser.js','sj-three-ui-browser.js'])test(filename+' always uses pinned CLI/selection, engine check and bounded source-file capture',()=>{
  const source=fs.readFileSync(path.join(__dirname,filename),'utf8');
  assert.match(source,/const toolchain=require\('\.\/sj-browser-toolchain'\)\.resolveCliToolchain\(cross\.browserToolchain\)/);
  assert.match(source,/execute\(process\.execPath,\[toolchain\.entry,'--session',session,\.\.\.browserCommandArgs\(args,browserSelection\)\]/);
  assert.match(source,/assert\.equal\(engine\.version,browserSelection\.version/);
  assert.match(source,/runBrowserCode\(\{out,source(?::inspectSource)?,execute:filename=>cli\('run-code','--filename='\+filename\)\}\)/);
  assert.doesNotMatch(source,/execute\('C:\/Program Files\/Git\/bin\/bash\.exe'/);
  assert.doesNotMatch(source,/cross\.performance\?require\('\.\/sj-browser-toolchain'\)/);
});
test('credentials stay inline rather than being passed through file transport',()=>{
  const control=fs.readFileSync(path.join(__dirname,'sj-cross-app-browser.js'),'utf8');
  const bank=fs.readFileSync(path.join(__dirname,'sj-three-ui-browser.js'),'utf8');
  assert.match(control,/const login=parse\(await cli\('run-code',`async\(page\)/);
  assert.match(bank,/await code\(`async\(page\)=>\{await page\.locator\('input\[name=/);
  assert.doesNotMatch(control,/capture\([^\n]*browserPassword/);
  assert.doesNotMatch(bank,/runBrowserCode\([^\n]*browserBankPassword/);
});
