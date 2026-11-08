'use strict';
// Serialized into the actual Playwright CLI process; no application state or
// payload/cookie/header/credential collection. Preserve failures for triage.
async function installBrowserObserver(page){
 const context=page.context();if(context.__step6Qa)throw Error('QA_OBSERVER_ALREADY_ATTACHED');
 const qa={started:new Date().toISOString(),events:[],pending:new Map(),sequence:0,phase:'initial',overflow:false};
 context.__step6Qa=qa;
 const location=url=>{try{const u=new URL(url);return {origin:u.origin,path:u.pathname};}catch{return {origin:'invalid',path:'invalid'};}};
 const record=value=>{if(qa.events.length>=10000){qa.overflow=true;return;}qa.events.push({at:new Date().toISOString(),phase:qa.phase,...value});};
 const attach=p=>{
  p.on('pageerror',error=>record({type:'pageerror',name:/^[A-Za-z]+Error$/.test(error.name)?error.name:'Error',page:location(p.url())}));
  p.on('console',message=>{if(message.type()==='error')record({type:'console-error',page:location(p.url()),location:location(message.location().url||p.url())});});
  p.on('request',request=>{qa.pending.set(request,{id:++qa.sequence,method:request.method(),resource:request.resourceType(),...location(request.url())});});
  p.on('response',response=>{if(response.status()>=400)record({type:'http',status:response.status(),method:response.request().method(),...location(response.url())});});
  p.on('requestfinished',request=>qa.pending.delete(request));
  p.on('requestfailed',request=>{const item=qa.pending.get(request);const raw=request.failure()?.errorText||'';
   record({type:'requestfailed',...(item||location(request.url())),error:/^(net::)?ERR_[A-Z_]+$/.test(raw)?raw:'NETWORK_FAILURE'});qa.pending.delete(request);});
 };
 context.pages().forEach(attach);context.on('page',attach);
 return {installed:true,scope:'actual context events; no request/response body, headers or secrets'};
}
async function readBrowserObserver(page){const qa=page.context().__step6Qa;if(!qa)throw Error('QA_OBSERVER_NOT_ATTACHED');
 return {started:qa.started,at:new Date().toISOString(),events:qa.events,pending:[...qa.pending.values()],overflow:qa.overflow};}
module.exports={installBrowserObserver,readBrowserObserver};
