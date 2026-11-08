'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {decideThroughUi}=require('./sj-step6-review-ui');
const commandId='12345678-1234-4234-8234-123456789012';
const decisionPath='/api/instances/12345678-1234-4234-8234-000000000001/reviews/12345678-1234-4234-8234-000000000002/decisions';
function pageDouble({state='APPLIED',recovered='APPLIED',status=200,lookupStatus=200,body={action:'check_result'},id=commandId,header=commandId,duplicate=false}={}){
  const page=new EventEmitter();page.url=()=> 'http://127.0.0.1:4320/reviews/example';
  let dialog=false,index=0;const calls=[];
  const request=(lookup=false)=>({method:()=> 'POST',url:()=> 'http://127.0.0.1:4320'+(lookup?decisionPath.replace(/\/reviews\/[^/]+\/decisions$/,'/review-commands/'+id):decisionPath),headers:()=>({'idempotency-key':header}),postDataJSON:()=>body});
  page.waitForResponse=async predicate=>{
    const lookup=index++>0,req=request(lookup),code=lookup?lookupStatus:status;
    const response={request:()=>req,url:req.url,status:()=>code,ok:()=>code>=200&&code<300,json:async()=>({data:{state:lookup?recovered:state,resultCode:'TEST_CODE',...(lookup?{}:{commandId:id})}})};
    assert.equal(predicate(response),true);return response;
  };
  const locator=(role,options={})=>({waitFor:async()=>{},isEnabled:async()=>true,fill:async()=>{},
    click:async()=>{calls.push(options.name||role);if(options.name==='Periksa hasil di bank')page.emit('request',request(true));else if(role==='confirm') {page.emit('request',request());if(duplicate)page.emit('request',request());}else if(role==='button')dialog=true;},
    getByRole:(child,opts)=>locator(role==='dialog'?'confirm':child,opts),getByText:()=>({waitFor:async()=>{calls.push('applied-visible');}})});
  page.locator=()=>locator('field');page.getByRole=(role,opts)=>locator(role,opts);
  page.screenshot=async()=>{};page.calls=calls;page.wasDialog=()=>dialog;return page;
}
const args={label:'Setujui',note:'Owned test note',decisionPath};
test('UI helper requires one authentic APPLIED response and visible bank application',async()=>{
 const page=pageDouble(),r=await decideThroughUi(page,args);assert.equal(r.applied,true);assert.equal(r.decisionPosts,1);assert.equal(r.lookupPosts,0);assert.equal(page.listenerCount('request'),0);assert.equal(page.wasDialog(),true);assert(page.calls.includes('applied-visible'));
});
test('UNKNOWN uses exactly one same-command lookup without another decision',async()=>{
 const page=pageDouble({state:'UNKNOWN',status:202}),r=await decideThroughUi(page,args);assert.equal(r.applied,true);assert.equal(r.decision.state,'UNKNOWN');assert.equal(r.recovery.commandId,commandId);assert.equal(r.lookupPosts,1);assert.equal(r.decisionPosts,1);assert.equal(page.calls.filter(x=>x==='Periksa hasil di bank').length,1);
});
for(const state of ['UNKNOWN','REJECTED','PENDING','DISPATCHING'])test('lookup '+state+' must not become PASS',async()=>{
 const r=await decideThroughUi(pageDouble({state:'UNKNOWN',status:202,recovered:state}),args);assert.equal(r.applied,false);assert.equal(r.error.code,'REVIEW_UI_NOT_APPLIED');
});
test('recovery requires HTTP200, not any 2xx',async()=>{const r=await decideThroughUi(pageDouble({state:'UNKNOWN',lookupStatus:202}),args);assert.equal(r.applied,false);assert.equal(r.error.code,'REVIEW_UI_RECEIPT_INVALID');});
test('lookup mutation body cannot become a second intent',async()=>{const r=await decideThroughUi(pageDouble({state:'UNKNOWN',body:{action:'retry'}}),args);assert.equal(r.applied,false);assert.equal(r.error.code,'REVIEW_UI_LOOKUP_BODY_INVALID');});
test('a different returned command is not silently accepted',async()=>{const r=await decideThroughUi(pageDouble({header:'12345678-1234-4234-8234-123456789999'}),args);assert.equal(r.applied,false);assert.equal(r.error.code,'REVIEW_UI_COMMAND_ID_MISMATCH');});
test('duplicate decision POST fails even when response says applied',async()=>{const r=await decideThroughUi(pageDouble({duplicate:true}),args);assert.equal(r.applied,false);assert.equal(r.error.code,'REVIEW_UI_DUPLICATE_REQUEST');});
test('actual browser serialization is self contained',()=>assert.doesNotThrow(()=>new Function('return ('+decideThroughUi.toString()+')')));
