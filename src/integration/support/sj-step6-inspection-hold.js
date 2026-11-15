'use strict';
// Test-only handoff: the real authenticated browser/services stay owned by the
// scenario while the main agent inspects screenshots and performs extra input.
// A release file is coordination, NOT visual PASS. Main's report is separate.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {readOwnedFileSync}=require('./sj-owned-file');
exports.waitForMain=async({proof,out,session,bankUi,publicUi,controlOrigin})=>{
 const owner=JSON.parse(readOwnedFileSync(path.join(proof.root,'owner.json'),{maxBytes:64*1024}).bytes);
 assert.equal(owner.runId,proof.runId);assert.equal(owner.tokenHash,proof.tokenHash);
 assert.match(proof.runId,/^[a-f0-9]{32}$/);assert.equal(session,'three-ui-'+proof.runId.slice(0,10));
 assert.equal(fs.realpathSync(out),path.resolve(out));
 const ready=path.join(out,'inspection-ready.json'),release=path.join(out,'inspection-release.json');
 assert(!fs.existsSync(release),'INSPECTION_ALREADY_REGISTERED');
 try {
  fs.writeFileSync(ready,JSON.stringify({runId:proof.runId,session,bankUi,publicUi,controlOrigin,at:new Date().toISOString(),deadlineMinutes:15,scope:'Coordination only; screenshot review not inferred'},null,2),{flag:'wx'});
 } catch(error) {
  if(error.code==='EEXIST')throw new Error('INSPECTION_ALREADY_REGISTERED',{cause:error});
  throw error;
 }
 const deadline=Date.now()+15*60*1000;
 while(Date.now()<deadline){
  let bytes;
  try { bytes=readOwnedFileSync(release,{maxBytes:64*1024}).bytes; }
  catch(error) { if(error.code!=='ENOENT')throw error; }
  if(bytes){
   const value=JSON.parse(bytes);assert.deepEqual(Object.keys(value).sort(),['runId','stopInspection']);
   assert.equal(value.runId,proof.runId);assert.equal(value.stopInspection,true);
   return {label:'main-inspection-handoff-ended-not-visual-verdict',pass:true,runId:proof.runId,at:new Date().toISOString()};
  }
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 throw Error('MAIN_INSPECTION_DEADLINE_NOT_SIGNED_OFF');
};
