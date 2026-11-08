// Same disposable suites locally and in CI. No supplied DB/storage credentials.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {pinLocalDocker}=require('../src/integration/support/sj-disposable-guard');
const {SCANNER_IMAGE,scannerSelection,prepareScanner,startScanner,scannerEnvironment,cleanupScanner}=require('../src/integration/support/sj-scanner-proof');
const MODES=Object.freeze(['--workflow','--workflow-central','--workflow-upgrade','--worker-resilience','--cross-app']);
async function main(){
  if(scannerSelection())throw Error('CI_GATE_EXTERNAL_SCANNER_REJECTED');
  pinLocalDocker();
  // Resolve all peer sources before creating any disposable resource.
  const {peerRoot}=require('../src/integration/support/sj-peer-paths');
  for(const peer of ['frontend','control','central'])peerRoot(peer);
  const scannerPlan=prepareScanner({});
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ra-sj-ci-'));
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','USERPROFILE','DOCKER_HOST','DOCKER_CONTEXT'].includes(k)));
  const report={status:'running',modes:[],scanner:scannerPlan.selection,cleanup:false};
  const save=()=>fs.writeFileSync(path.join(root,'summary.json'),JSON.stringify(report,null,2));
  // Only this sanitized summary is exported to CI, never raw child/temp files.
  if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`summary=${path.join(root,'summary.json')}\n`);
  console.log(JSON.stringify({evidence:root,pid:process.pid}));save();
  try{
    await startScanner(scannerPlan,{onAttempt:selection=>{report.scanner=selection;save();},onCreated:selection=>{report.scanner=selection;save();}});
    Object.assign(env,scannerEnvironment(scannerPlan.selection));
    for(const mode of MODES){
      report.active=mode;save();
      const result=spawnSync(process.execPath,[path.join(__dirname,'run-sj-isolated-tests.js'),mode],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:900000,maxBuffer:16*1024*1024});
      const start=String(result.stdout||'').split(/\r?\n/).map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(row=>row?.status==='starting');
      let receipt;
      if(start){
        const expected=path.join(os.tmpdir(),path.basename(start.evidence));
        if(path.resolve(start.evidence)!==path.resolve(expected)||!/^ra-sj-02-[\w-]+$/.test(path.basename(expected)))throw Error('UNEXPECTED_EVIDENCE_PATH');
        receipt=JSON.parse(fs.readFileSync(path.join(expected,'report.json'),'utf8'));
      }
      const pass=result.status===0&&receipt?.status==='passed'&&receipt.scenario?.pass===true&&receipt.cleanup?.length===3&&receipt.cleanup.every(item=>item.removed);
      // Allowlisted checks only; raw assertion errors may contain fixture values.
      report.modes.push({mode,pass,exit:result.status,error:result.error?.code,runId:receipt?.runId,cleanup:receipt?.cleanup?.map(c=>({kind:c.kind,removed:c.removed})),checks:[...(receipt?.checks||[]),...(receipt?.scenario?.checks||[])].map(c=>({check:c.check,pass:c.pass})),sourceManifest:receipt?.sourceManifest,peerManifest:receipt?.peerManifest});save();
      console.log(JSON.stringify({mode,pass,exit:result.status}));
      if(!pass)throw Error('MANDATORY_SUITE_FAILED');
    }
    report.status='passed';
  }catch(e){report.status='failed';report.failure=['OWNED_SCANNER_NOT_READY','MANDATORY_SUITE_FAILED','UNEXPECTED_EVIDENCE_PATH'].includes(e.message)?e.message:'CI_GATE_INFRASTRUCTURE_FAILED';process.exitCode=1;}
  finally{
    try{
      report.cleanup=cleanupScanner(scannerPlan,{onResolved:selection=>{report.scanner=selection;save();}});
    }catch{report.cleanup=false;report.status='failed';process.exitCode=1;}
    report.active=null;report.finishedAt=new Date().toISOString();save();
  }
}
module.exports={MODES,SCANNER_IMAGE};
if(require.main===module)main().catch(()=>{console.error('SJ_CI_GATE_REFUSED');process.exitCode=1;});
