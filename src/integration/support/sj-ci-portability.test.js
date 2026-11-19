const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {peerRoot}=require('./sj-peer-paths');
const {SCANNER_IMAGE,scannerSelection,assertScanner}=require('./sj-scanner-proof');
test('CI explicitly covers all five modes without business credentials or a container-shared database',()=>{
  const {MODES,SCANNER_IMAGE}=require('../../../scripts/run-sj-ci-gate');
  assert.deepEqual(MODES,['--workflow','--workflow-central','--workflow-upgrade','--worker-resilience','--cross-app']);
  assert.match(SCANNER_IMAGE,/@sha256:[a-f0-9]{64}$/);
  const workflow=fs.readFileSync(path.resolve(__dirname,'../../../.github/workflows/sj-isolated.yml'),'utf8');
  assert.match(workflow,/runs-on: ubuntu-24.04/);
  assert.match(workflow,/run: node scripts\/run-sj-ci-gate.js/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.doesNotMatch(workflow,/secrets\.|persist-credentials: true|ref: main|pull_request_target|services:|container:/);
  assert.equal((workflow.match(/persist-credentials: false/g)||[]).length,4);
  const imagePreparation=workflow.indexOf('- name: Prepare pinned images for owned fixture suites');
  assert(imagePreparation>=0&&imagePreparation<workflow.indexOf('run: node scripts/run-sj-ci-gate.js'));
  assert(workflow.includes(`docker pull ${SCANNER_IMAGE}`),'scanner image must exist before prepareScanner inspects it');
  for(const image of ['postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73 postgres:17-alpine','redis@sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf redis:7.4.11-alpine'])assert(workflow.includes(`pull_fixture ${image}`));
  for(const ref of ['frontend_ref','control_ref','central_ref'])assert.ok(workflow.includes('ref: ${{ inputs.'+ref+' }}'));
  for(const line of workflow.split('\n').filter(l=>l.includes('uses:')))assert.match(line,/@[a-f0-9]{40}$/);
});
test('SJ companion enforces pinned npm and separate frontend policy/age install before owned suites',async()=>{
  const {validateFrontendNpmPolicyWorkflow}=await import('../../../scripts/verify-ci-workflow.mjs');
  const workflow=fs.readFileSync(path.resolve(__dirname,'../../../.github/workflows/sj-isolated.yml'),'utf8').replaceAll('\r\n','\n');
  assert.deepEqual(validateFrontendNpmPolicyWorkflow(workflow,'owned-integration'),{npm_version:'11.21.0',age_check_before_ci:true});
  assert(workflow.indexOf('node scripts/verify-dependency-age.mjs')<workflow.indexOf('run: node scripts/run-sj-ci-gate.js'));
});
test('SJ companion rejects missing bootstrap/age, install-before-age and frontend inside peer loop',async()=>{
  const {validateFrontendNpmPolicyWorkflow}=await import('../../../scripts/verify-ci-workflow.mjs');
  const workflow=fs.readFileSync(path.resolve(__dirname,'../../../.github/workflows/sj-isolated.yml'),'utf8').replaceAll('\r\n','\n');
  for(const changed of [workflow.replace(/\n      - name: Bootstrap pinned npm in ephemeral runner[\s\S]*?(?=\n      - name:)/,''),workflow.replace('          node scripts/verify-dependency-age.mjs\n',''),workflow.replace('          node scripts/verify-dependency-age.mjs\n          npm ci','          npm ci\n          node scripts/verify-dependency-age.mjs'),workflow.replace('for repo in backend-production ruwang-control','for repo in backend-production frontend-production ruwang-control')])assert.throws(()=>validateFrontendNpmPolicyWorkflow(changed,'owned-integration'),/npm policy/);
});
test('peer sources resolve from checkout siblings, not cwd or a drive letter',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sj-peer-test-'));
  try{
    fs.mkdirSync(path.join(root,'ruwang-control'));fs.writeFileSync(path.join(root,'ruwang-control/package.json'),JSON.stringify({name:'ruwang-control'}));
    assert.equal(peerRoot('control',path.join(root,'backend-production')),path.join(root,'ruwang-control'));
    fs.writeFileSync(path.join(root,'ruwang-control/package.json'),JSON.stringify({name:'different-app'}));
    assert.throws(()=>peerRoot('control',path.join(root,'backend-production')),/PACKAGE_MISMATCH/);
    assert.throws(()=>peerRoot('unknown'),/UNKNOWN_TEST_PEER/);
  }finally{fs.rmSync(root,{recursive:true});}
});
test('scanner selection rejects partial/foreign configuration',()=>{
  assert.equal(scannerSelection({}),null);
  assert.throws(()=>scannerSelection({SJ_TEST_SCANNER_NAME:'production'}),/INVALID_TEST/);
  assert.throws(()=>scannerSelection({SJ_TEST_SCANNER_MARKER:'a'.repeat(64)}),/INVALID_TEST/);
});
test('scanner proof rejects foreign mounts, identity, ports, privileged and stopped scanners',()=>{
  const selection=scannerSelection({SJ_TEST_SCANNER_NAME:'ra-sj-ci-'+'a'.repeat(32),SJ_TEST_SCANNER_MARKER:'b'.repeat(64),SJ_TEST_SCANNER_ID:'c'.repeat(64),SJ_TEST_SCANNER_IMAGE_ID:'sha256:'+'d'.repeat(64)});
  const valid={Id:selection.id,Image:selection.image,Name:'/'+selection.name,Config:{Image:SCANNER_IMAGE,Labels:{'sj.prerequisites.marker':selection.marker}},State:{Running:true},HostConfig:{PortBindings:{},Privileged:false,NetworkMode:'bridge',Tmpfs:{'/var/lib/clamav':'rw'}},Mounts:[{Type:'tmpfs',Destination:'/var/lib/clamav'}]};
  assert.equal(assertScanner(valid,selection),valid.Id);
  for(const mutate of [v=>v.Id='x',v=>v.Name='/foreign',v=>v.Config.Labels={},v=>v.State.Running=false,v=>v.HostConfig.Privileged=true,v=>v.HostConfig.NetworkMode='host',v=>v.HostConfig.PortBindings={'3310/tcp':[{HostPort:'3310'}]},v=>v.Mounts=[{Type:'bind',Destination:'/var/lib/clamav'}],v=>v.Mounts=[{Type:'volume',Destination:'/data'}]]){
    const value=structuredClone(valid);mutate(value);assert.throws(()=>assertScanner(value,selection),/UNVERIFIED/);
  }
  const stopped=structuredClone(valid);stopped.State.Running=false;assert.equal(assertScanner(stopped,selection,false),valid.Id);
  for(const mutate of [v=>v.Id='e'.repeat(64),v=>v.Image='sha256:'+'e'.repeat(64),v=>v.Config.Image='untrusted/scanner:latest',v=>v.HostConfig.Tmpfs={},v=>v.Mounts=[{Type:'volume',Destination:'/var/lib/clamav',Name:'operational-signatures'}]]){
    const value=structuredClone(valid);mutate(value);assert.throws(()=>assertScanner(value,selection),/UNVERIFIED/);
  }
});
