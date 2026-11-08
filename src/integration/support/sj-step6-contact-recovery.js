'use strict';

// Serialized as-is into the owned browser page. This injects one read fault,
// never a response or a business mutation. Global live-region alerts are kept
// as observations: an empty Next route announcer is not a contacts read error.
async function recoverContactReadThroughUi(page,{file,recoveredFile}){
  const timeout=20000,tableLabel='Daftar kontak WhatsApp marketing';
  const errorText='Kontak WhatsApp belum dapat dimuat',actionPrefix='Aksi kontak ';
  const bankOrigin='http://127.0.0.1:3111',apiOrigin='http://127.0.0.1:7111';
  const contactsPath='/api/v1/seputar-jaminan/contacts';
  const pageUrl=new URL(page.url());
  if(pageUrl.origin!==bankOrigin||pageUrl.pathname!=='/dashboard/seputar-jaminan/kontak')throw Error('CONTACT_READ_OWNED_PAGE_REQUIRED');
  if(typeof file!=='string'||!file||typeof recoveredFile!=='string'||!recoveredFile||file===recoveredFile)throw Error('CONTACT_READ_SCREENSHOT_PATHS_REQUIRED');
  const table=page.getByRole('table',{name:tableLabel,exact:true});
  const tableError=table.getByText(errorText,{exact:true});
  const reload=page.getByRole('button',{name:'Muat ulang',exact:true});
  const settled=async()=>{
    await table.waitFor({state:'visible',timeout});
    await page.waitForFunction(label=>{
      const element=document.querySelector('table[aria-label="'+label+'"]');
      return element?.getAttribute('aria-busy')==='false';
    },tableLabel,{timeout});
  };
  const alerts=()=>page.getByRole('alert').evaluateAll(nodes=>nodes.map(element=>{
    const rect=element.getBoundingClientRect();
    return {text:(element.textContent||'').replace(/\s+/g,' ').trim().slice(0,500),
      tag:element.tagName,id:element.id||null,ariaLive:element.getAttribute('aria-live'),
      visible:rect.width>0&&rect.height>0};
  }));
  const matches=url=>{try{const value=new URL(typeof url==='string'?url:url.href);return value.origin===apiOrigin&&value.pathname===contactsPath;}catch{return false;}};
  const matchesResponse=response=>response.request().method()==='GET'&&matches(response.url());
  await settled();
  await tableError.waitFor({state:'hidden',timeout});
  const firstAction=table.getByRole('button',{name:/^Aksi kontak /}).first();
  await firstAction.waitFor({state:'visible',timeout});
  const firstActionLabel=await firstAction.getAttribute('aria-label');
  if(typeof firstActionLabel!=='string'||!firstActionLabel.startsWith(actionPrefix)||!firstActionLabel.slice(actionPrefix.length).trim())throw Error('CONTACT_READ_NONEMPTY_TABLE_REQUIRED');
  const firstContactLabel=firstActionLabel.slice(actionPrefix.length);
  await table.getByText(firstContactLabel,{exact:true}).first().waitFor({state:'visible',timeout});
  const globalAlerts={before:await alerts(),fault:null,recovered:null};
  let failures=0,retryResponses=0;
  const abort=async route=>{
    const request=route.request();
    if(request.method()==='GET'&&matches(request.url())){failures++;await route.abort('failed');}
    else await route.continue();
  };
  await page.route(matches,abort);
  try{
    await reload.click({timeout});
    // Wait for the specific table error, not any global role=alert while the
    // table is still loading. The screenshot is captured before fault removal.
    await tableError.waitFor({state:'visible',timeout});
    await settled();
    await tableError.waitFor({state:'visible',timeout});
    if(failures<1)throw Error('CONTACT_READ_FAULT_NOT_EXERCISED');
    globalAlerts.fault=await alerts();
    await page.screenshot({path:file,type:'jpeg',quality:85,fullPage:false,timeout});
  }finally{
    await page.unroute(matches,abort);
  }
  const track=response=>{if(matchesResponse(response))retryResponses++;};
  page.on('response',track);
  try{
    const pending=page.waitForResponse(matchesResponse,{timeout});
    pending.catch(()=>{});
    await reload.click({timeout});
    const response=await pending;
    if(!matchesResponse(response)||response.status()!==200)throw Error('CONTACT_READ_RETRY_HTTP_FAILED');
    let bodyTimer,bodyFailure;
    try{
      bodyFailure=await Promise.race([response.finished(),new Promise((resolve,reject)=>{
        bodyTimer=setTimeout(()=>reject(Error('CONTACT_READ_RETRY_BODY_TIMEOUT')),timeout);
      })]);
    }finally{clearTimeout(bodyTimer);}
    if(bodyFailure)throw Error('CONTACT_READ_RETRY_BODY_FAILED');
    await settled();
    await tableError.waitFor({state:'hidden',timeout});
    const restored=table.getByRole('button',{name:/^Aksi kontak /}).first();
    await restored.waitFor({state:'visible',timeout});
    if(await restored.getAttribute('aria-label')!==firstActionLabel)throw Error('CONTACT_READ_FIRST_ROW_NOT_RESTORED');
    await table.getByText(firstContactLabel,{exact:true}).first().waitFor({state:'visible',timeout});
    globalAlerts.recovered=await alerts();
    await page.screenshot({path:recoveredFile,type:'jpeg',quality:85,fullPage:false,timeout});
    if(retryResponses!==1)throw Error('CONTACT_READ_RETRY_RESPONSE_COUNT');
    return {fault:'browser-abort-owned-GET',failures,recovered:true,retryResponses,httpStatus:response.status(),
      firstContactLabel,screenshot:file,recoveredScreenshot:recoveredFile,globalAlerts,
      boundary:'Owned browser read fault and real GET recovery; not a service outage or global-alert absence claim.'};
  }finally{
    page.off('response',track);
  }
}
module.exports={recoverContactReadThroughUi};
