// Test infrastructure only. No legacy/shared scanner fallback or application credentials.
const {randomBytes} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const SCANNER_IMAGE = 'clamav/clamav@sha256:9cb27d7660bdf66e9878c832cb433dd8aa152cfbe16f3c2c0084c80b04ae22b4';
const fields = ['SJ_TEST_SCANNER_NAME','SJ_TEST_SCANNER_MARKER','SJ_TEST_SCANNER_ID','SJ_TEST_SCANNER_IMAGE_ID'];
const plans = new WeakMap();
const fail = code => { throw Error(code); };
const docker = args => execFileSync('docker',args,{encoding:'utf8',windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],timeout:10000,killSignal:'SIGKILL',maxBuffer:2*1024*1024}).trim();

function validSelection(selection) {
  return /^ra-sj-ci-[a-f0-9]{32}$/.test(selection?.name || '') && /^[a-f0-9]{64}$/.test(selection?.marker || '') &&
    /^[a-f0-9]{64}$/.test(selection?.id || '') && /^sha256:[a-f0-9]{64}$/.test(selection?.image || '') && selection.imageRef === SCANNER_IMAGE;
}

function scannerSelection(env = process.env) {
  if (Object.keys(env).some(key => key.startsWith('SJ_TEST_SCANNER_') && !fields.includes(key))) fail('INVALID_TEST_SCANNER_SELECTION');
  if (fields.every(key => env[key] === undefined)) return null; // The launcher creates a new owned scanner.
  const selection = {name:env.SJ_TEST_SCANNER_NAME,marker:env.SJ_TEST_SCANNER_MARKER,id:env.SJ_TEST_SCANNER_ID,image:env.SJ_TEST_SCANNER_IMAGE_ID,imageRef:SCANNER_IMAGE};
  if (!validSelection(selection)) fail('INVALID_TEST_SCANNER_SELECTION');
  return Object.freeze(selection);
}

function assertScanner(actual, selection, requireRunning = true) {
  if (!validSelection(selection) || actual?.Id !== selection.id || actual.Image !== selection.image || actual.Config?.Image !== SCANNER_IMAGE ||
      actual.Name !== '/' + selection.name || actual.Config?.Labels?.['sj.prerequisites.marker'] !== selection.marker ||
      (requireRunning && (!actual.State?.Running || actual.State?.Paused || selection.creationUncertain || selection.cleanupResolvedId)) || actual.HostConfig?.Privileged ||
      !['bridge','default'].includes(actual.HostConfig?.NetworkMode) || actual.HostConfig?.PublishAllPorts ||
      (actual.HostConfig?.Binds || []).length || (actual.HostConfig?.VolumesFrom || []).length ||
      Object.values(actual.HostConfig?.PortBindings || {}).some(value => value?.length) ||
      !actual.HostConfig?.Tmpfs?.['/var/lib/clamav'] || Object.keys(actual.HostConfig.Tmpfs).some(key => key !== '/var/lib/clamav') ||
      !Array.isArray(actual.Mounts) || actual.Mounts.some(m => m.Type !== 'tmpfs' || m.Destination !== '/var/lib/clamav')) fail('UNVERIFIED_TEST_SCANNER');
  return actual.Id;
}

function resolveImage(run) {
  const image = JSON.parse(run(['image','inspect',SCANNER_IMAGE]))[0];
  if (!/^sha256:[a-f0-9]{64}$/.test(image?.Id || '') || !image.RepoDigests?.includes(SCANNER_IMAGE)) fail('PINNED_TEST_SCANNER_IMAGE_REQUIRED');
  return image.Id;
}

function inventory(run) {
  return run(['ps','-a','--no-trunc','--format','{{.ID}}|{{.Names}}']).split(/\r?\n/).filter(Boolean).map(line=>{
    const fields=line.split('|');
    if(fields.length!==2||!/^[a-f0-9]{64}$/.test(fields[0])||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(fields[1]))fail('SCANNER_INVENTORY_INVALID');
    return {id:fields[0],name:fields[1]};
  });
}

function validAttempt(selection) {
  return selection?.creationAttempted===true && /^ra-sj-ci-[a-f0-9]{32}$/.test(selection.name||'') &&
    /^[a-f0-9]{64}$/.test(selection.marker||'') && /^sha256:[a-f0-9]{64}$/.test(selection.image||'') &&
    selection.imageRef===SCANNER_IMAGE && (selection.id===null||/^[a-f0-9]{64}$/.test(selection.id||''));
}

// All external fields and live ownership are checked before mkdir/provision/migration.
function prepareScanner(env = process.env, {run = docker} = {}) {
  const supplied = scannerSelection(env); // Invalid config causes zero Docker calls.
  const image = resolveImage(run);
  if (supplied && supplied.image !== image) fail('UNVERIFIED_TEST_SCANNER');
  if (supplied) assertScanner(JSON.parse(run(['inspect',supplied.id]))[0],supplied);
  const state = {owned:!supplied,selection:supplied || Object.freeze({name:'ra-sj-ci-'+randomBytes(16).toString('hex'),marker:randomBytes(32).toString('hex'),image,imageRef:SCANNER_IMAGE}),creationAttempted:false};
  const plan = Object.freeze({owned:state.owned,get selection(){return state.selection;}});
  plans.set(plan,state);
  return plan;
}

async function startScanner(plan, {run = docker,onAttempt = () => {},onCreated = () => {},wait = ms => new Promise(resolve => setTimeout(resolve,ms)),attempts = 150} = {}) {
  const state = plans.get(plan);
  if (!state) fail('SCANNER_CAPABILITY_REQUIRED');
  if (state.owned) {
    if (state.creationAttempted) fail('SCANNER_ALREADY_CREATED');
    if(inventory(run).some(row=>row.name===state.selection.name))fail('SCANNER_NAME_ALREADY_EXISTS');
    state.selection=Object.freeze({...state.selection,id:null,creationAttempted:true,creationUncertain:false,creationValidated:false});
    onAttempt(state.selection); // Durable caller journal MUST finish before create.
    state.creationAttempted = true;
    try {
      const id = run(['create','--name',state.selection.name,'--label','sj.prerequisites.marker='+state.selection.marker,'--tmpfs','/var/lib/clamav:rw',SCANNER_IMAGE]);
      if(!/^[a-f0-9]{64}$/.test(id))fail('SCANNER_CREATE_OUTPUT_INVALID');
      state.selection = Object.freeze({...state.selection,id});
      onCreated(state.selection); // Persist exact ID before inspect/start.
      assertScanner(JSON.parse(run(['inspect',id]))[0],state.selection,false);
      state.selection=Object.freeze({...state.selection,creationValidated:true});
      onCreated(state.selection);
    } catch {
      state.selection=Object.freeze({...state.selection,creationUncertain:true});
      try{onAttempt(state.selection);}catch{fail('SCANNER_CREATION_UNCERTAIN_JOURNAL_FAILED');}
      // A late daemon result can be resolved ONLY for cleanup, never for start.
      fail('SCANNER_CREATION_UNCERTAIN');
    }
    run(['start',state.selection.id]);
  }
  assertScanner(JSON.parse(run(['inspect',state.selection.id]))[0],state.selection);
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { run(['exec',state.selection.id,'clamdscan','--ping=1']); return state.selection.id; }
    catch { if (attempt + 1 < attempts) await wait(2000); }
  }
  fail('OWNED_SCANNER_NOT_READY');
}

function scannerEnvironment(selection) {
  if (!validSelection(selection)||selection.creationUncertain||selection.cleanupResolvedId) fail('INVALID_TEST_SCANNER_SELECTION');
  return {SJ_TEST_SCANNER_NAME:selection.name,SJ_TEST_SCANNER_MARKER:selection.marker,SJ_TEST_SCANNER_ID:selection.id,SJ_TEST_SCANNER_IMAGE_ID:selection.image};
}

function removeScanner(selection, run, onResolved = () => {}) {
  if(!validSelection(selection)&&!validAttempt(selection))fail('SCANNER_CREATION_UNCERTAIN');
  if(selection.image!==resolveImage(run))fail('UNVERIFIED_TEST_SCANNER');
  const containers=inventory(run);
  const matches=containers.filter(row=>selection.id?row.id===selection.id&&row.name===selection.name:row.name===selection.name);
  if(selection.id&&containers.some(row=>row.name===selection.name&&row.id!==selection.id))fail('UNVERIFIED_TEST_SCANNER');
  if(matches.length!==1)fail('SCANNER_CREATION_UNCERTAIN');
  const resolved=Object.freeze({...selection,id:matches[0].id,...(!selection.id?{cleanupResolvedId:true}:{} )});
  assertScanner(JSON.parse(run(['inspect',resolved.id]))[0],resolved,false);
  onResolved(resolved); // Persist cleanup-only resolved ID before removal.
  assertScanner(JSON.parse(run(['inspect',resolved.id]))[0],resolved,false);
  run(['rm','-f',resolved.id]);
  if(inventory(run).some(row=>row.id===resolved.id||row.name===resolved.name))fail('TEST_SCANNER_CLEANUP_FAILED');
  return true;
}

function cleanupScanner(plan, {run = docker,onResolved = () => {}} = {}) {
  const state = plans.get(plan);
  if (!state || !state.owned) fail('SCANNER_NOT_OWNED'); // Never delete a valid parent's scanner.
  if (!state.creationAttempted) return true;
  return removeScanner(state.selection,run,selection=>{state.selection=selection;onResolved(selection);});
}

// Called only by interrupted-run recovery after the saved run owner/PID was checked.
function recoverScanner(selection, {run = docker,onResolved = () => {}} = {}) {
  if (!validSelection(selection)&&!validAttempt(selection)) fail('UNVERIFIED_TEST_SCANNER');
  return removeScanner(selection,run,onResolved);
}

module.exports = {SCANNER_IMAGE,scannerSelection,assertScanner,prepareScanner,startScanner,scannerEnvironment,cleanupScanner,recoverScanner};
