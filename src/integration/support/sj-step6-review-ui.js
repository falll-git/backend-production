'use strict';

// Serialized into the actual owned CLI page. Only a real confirmation sends a
// decision. UNKNOWN permits ONE existing bank-ledger lookup, never a new intent.
async function decideThroughUi(page,{label,note,decisionPath,unknownScreenshot}){
  const proof={decision:null,recovery:null,decisionPosts:0,lookupPosts:0,applied:false,error:null};
  const origin=new URL(page.url()).origin;
  const match=(r,pathname)=>r.request().method()==='POST'&&new URL(r.url()).origin===origin&&new URL(r.url()).pathname===pathname;
  const track=request=>{if(request.method()!=='POST')return;const u=new URL(request.url());if(u.origin!==origin)return;
    if(u.pathname===decisionPath)proof.decisionPosts++;
    if(proof.decision&&u.pathname===decisionPath.replace(/\/reviews\/[^/]+\/decisions$/,'/review-commands/'+proof.decision.commandId))proof.lookupPosts++;
  };
  page.on('request',track);
  const read=async(response,withCommand)=>{
    const body=await response.json(),data=body?.data;
    if(!response.ok()||!(withCommand?[200,202].includes(response.status()):response.status()===200)||!data||!['PENDING','DISPATCHING','APPLIED','REJECTED','UNKNOWN'].includes(data.state))throw Error('REVIEW_UI_RECEIPT_INVALID');
    if(withCommand&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(data.commandId||''))throw Error('REVIEW_UI_COMMAND_INVALID');
    if(data.resultCode!==null&&(typeof data.resultCode!=='string'||!/^[A-Z0-9_]{1,128}$/.test(data.resultCode)))throw Error('REVIEW_UI_CODE_INVALID');
    return {httpStatus:response.status(),state:data.state,resultCode:data.resultCode,...(withCommand?{commandId:data.commandId}:{})};
  };
  try{
    if(note)await page.locator('#review-note').fill(note);
    const button=page.getByRole('button',{name:label,exact:true});await button.waitFor();
    if(!await button.isEnabled())throw Error('REVIEW_UI_NOT_ELIGIBLE');
    await button.click();const dialog=page.getByRole('dialog');await dialog.waitFor();
    const [submitted]=await Promise.all([page.waitForResponse(r=>match(r,decisionPath)),dialog.getByRole('button',{name:label,exact:true}).click()]);
    proof.decision=await read(submitted,true);
    const intent=submitted.request().headers()['idempotency-key'];
    if(intent!==proof.decision.commandId)throw Error('REVIEW_UI_COMMAND_ID_MISMATCH');
    const region=page.getByRole('region',{name:'Keputusan pemeriksaan'});
    if(proof.decision.state==='UNKNOWN'){
      const recovery=region.getByRole('button',{name:'Periksa hasil di bank',exact:true});await recovery.waitFor();
      if(unknownScreenshot)await page.screenshot({path:unknownScreenshot,fullPage:false});
      const resultPath=decisionPath.replace(/\/reviews\/[^/]+\/decisions$/,'/review-commands/'+proof.decision.commandId);
      if(resultPath===decisionPath)throw Error('REVIEW_UI_LOOKUP_PATH_INVALID');
      const [checked]=await Promise.all([page.waitForResponse(r=>match(r,resultPath)),recovery.click({timeout:15000})]);
      const lookup=checked.request().postDataJSON();
      if(!lookup||Object.keys(lookup).length!==1||lookup.action!=='check_result')throw Error('REVIEW_UI_LOOKUP_BODY_INVALID');
      proof.recovery={...await read(checked,false),commandId:proof.decision.commandId,resultPath};
    }
    if((proof.recovery??proof.decision).state!=='APPLIED')throw Error('REVIEW_UI_NOT_APPLIED');
    await region.getByText('Diterapkan di bank',{exact:true}).waitFor();
    if(proof.decisionPosts!==1||proof.lookupPosts!==(proof.recovery?1:0))throw Error('REVIEW_UI_DUPLICATE_REQUEST');
    proof.applied=true;
  }catch(error){proof.error={name:error.name,code:/^REVIEW_UI_[A-Z_]+$/.test(error.message)?error.message:'REVIEW_UI_INTERACTION_FAILED'};}
  finally{page.off('request',track);}
  return proof;
}
module.exports={decideThroughUi};
