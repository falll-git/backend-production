'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {recoverContactReadThroughUi}=require('./sj-step6-contact-recovery');

const args={file:'owned/error.jpg',recoveredFile:'owned/recovered.jpg'};
function pageDouble(options={}){
  const page=new EventEmitter(),calls=[],label='Kontak terisolasi pertama';
  let phase='initial',installed=false,handler,routeMatcher,responseWait;
  const networkUrl='http://127.0.0.1:7111/api/v1/seputar-jaminan/contacts?limit=20&paged=true';
  const response={request:()=>({method:()=>options.responseMethod||'GET'}),url:()=>options.responseUrl||networkUrl,
    status:()=>options.status??200,finished:async()=>{calls.push('response-finished');if(options.bodyHangs)return new Promise(()=>{});return options.bodyFailure?new Error('body failed'):null;}};
  const emptyAlert={textContent:'',tagName:'NEXT-ROUTE-ANNOUNCER',id:'__next-route-announcer__',getAttribute:()=>null,getBoundingClientRect:()=>({width:0,height:0})};
  const unrelatedAlert={textContent:'Notifikasi lain yang harus dilaporkan',tagName:'DIV',id:'owned-other-alert',getAttribute:()=>null,getBoundingClientRect:()=>({width:80,height:20})};
  const chain={first(){return this;},waitFor:async({state})=>{
    calls.push('row-'+state);
    if(options.empty||!['initial','recovered'].includes(phase))throw Error('fake-row-timeout');
  },getAttribute:async name=>{assert.equal(name,'aria-label');return options.changedFirstRow&&phase==='recovered'?'Aksi kontak Berbeda':'Aksi kontak '+label;}};
  const specificError={waitFor:async({state,timeout})=>{
    assert.equal(timeout,20000);calls.push('specific-error-'+state);
    if(state==='visible'){
      assert.equal(installed,true,'fault must remain installed until the actual table error is captured');
      assert(['fault-loading','fault-error'].includes(phase));
      if(options.errorNeverRenders)throw Error('fake-specific-error-timeout');
      phase='fault-error';
    }else{
      if(options.persistentError&&phase==='recovered')throw Error('fake-specific-error-still-visible');
      assert(['initial','recovered'].includes(phase));
    }
  }};
  const table={
    waitFor:async({state,timeout})=>{assert.equal(state,'visible');assert.equal(timeout,20000);calls.push('table-visible');},
    getByText:(text,{exact})=>{
      assert.equal(exact,true);
      if(text==='Kontak WhatsApp belum dapat dimuat')return specificError;
      assert.equal(text,label);return {first(){return this;},waitFor:async({state})=>{calls.push('label-'+phase);assert.equal(state,'visible');assert(['initial','recovered'].includes(phase));}};
    },
    getByRole:(role,{name})=>{assert.equal(role,'button');assert.equal(String(name),'/^Aksi kontak /');return chain;},
  };
  const reload={click:async({timeout})=>{
    assert.equal(timeout,20000);
    if(phase==='initial'){
      calls.push('fault-click');assert.equal(installed,true);phase='fault-loading';
      if(options.probeNonGet){
        await handler({request:()=>({method:()=> 'POST',url:()=>networkUrl}),abort:async()=>{throw Error('non-GET must not be faulted');},continue:async()=>calls.push('non-GET-continued')});
      }
      if(!options.noFault){
        const request={method:()=> 'GET',url:()=>networkUrl};
        await handler({request:()=>request,abort:async reason=>{assert.equal(reason,'failed');calls.push('fault-aborted');},continue:async()=>{throw Error('fault unexpectedly continued');}});
      }
    }else{
      calls.push('retry-click');assert.equal(installed,false);assert.equal(phase,'fault-error');assert(responseWait,'waitForResponse must be installed before retry click');
      if(options.retryClickFails)throw Error('fake-retry-click-failure');
      phase='retry-loading';
      if(!responseWait.predicate(response)){responseWait.reject(Error('fake-response-timeout'));return;}
      page.emit('response',response);
      if(options.duplicateResponse)page.emit('response',response);
      responseWait.resolve(response);
    }
  }};
  page.url=()=>options.pageUrl||'http://127.0.0.1:3111/dashboard/seputar-jaminan/kontak';
  page.getByRole=(role,configuration)=>{
    if(role==='table'){assert.equal(configuration.name,'Daftar kontak WhatsApp marketing');assert.equal(configuration.exact,true);return table;}
    if(role==='button'){assert.equal(configuration.name,'Muat ulang');assert.equal(configuration.exact,true);return reload;}
    assert.equal(role,'alert');return {evaluateAll:async fn=>{calls.push('alerts-'+phase);return fn([emptyAlert,unrelatedAlert]);}};
  };
  page.waitForFunction=async(fn,tableLabel,{timeout})=>{
    assert.equal(timeout,20000);calls.push('settled-'+phase);
    if(phase==='retry-loading'){assert(calls.includes('response-finished'),'must finish actual response before accepting restored DOM');phase='recovered';}
    assert(['initial','fault-error','recovered'].includes(phase),'loading may not be captured as settled');
    const previous=global.document;
    global.document={querySelector:selector=>{assert.equal(selector,'table[aria-label="'+tableLabel+'"]');return {getAttribute:name=>{assert.equal(name,'aria-busy');return 'false';}};}};
    try{assert.equal(fn(tableLabel),true);}finally{if(previous===undefined)delete global.document;else global.document=previous;}
  };
  page.route=async(matcher,abort)=>{calls.push('route');assert.equal(matcher(new URL(networkUrl)),true);assert.equal(matcher(new URL('http://example.test/api/v1/seputar-jaminan/contacts')),false);assert.equal(matcher(new URL('http://127.0.0.1:7111/api/v1/seputar-jaminan/profile')),false);routeMatcher=matcher;handler=abort;installed=true;};
  page.unroute=async(matcher,abort)=>{calls.push('unroute');assert.equal(matcher,routeMatcher);assert.equal(abort,handler);installed=false;if(options.unrouteFails)throw Error('fake-unroute-failure');};
  page.screenshot=async({path,fullPage,timeout})=>{
    calls.push('screenshot-'+phase);assert.equal(fullPage,false);assert.equal(timeout,20000);
    if(path===args.file){assert.equal(phase,'fault-error');assert.equal(installed,true);if(options.faultScreenshotFails)throw Error('fake-screenshot-failure');}
    else{assert.equal(path,args.recoveredFile);assert.equal(phase,'recovered');assert.equal(installed,false);}
  };
  page.waitForResponse=(predicate,{timeout})=>{
    calls.push('wait-response');assert.equal(timeout,20000);assert.equal(installed,false);
    return new Promise((resolve,reject)=>{responseWait={predicate,resolve,reject};});
  };
  page.calls=calls;page.faultInstalled=()=>installed;return page;
}

test('production helper waits for specific settled table error then actual successful GET and restored first row',async()=>{
  const page=pageDouble(),result=await recoverContactReadThroughUi(page,args);
  assert.equal(result.recovered,true);assert.equal(result.failures,1);assert.equal(result.retryResponses,1);assert.equal(result.httpStatus,200);
  assert.equal(result.firstContactLabel,'Kontak terisolasi pertama');
  assert(page.calls.indexOf('specific-error-visible')<page.calls.indexOf('screenshot-fault-error'));
  assert(page.calls.indexOf('screenshot-fault-error')<page.calls.indexOf('unroute'));
  assert(page.calls.indexOf('wait-response')<page.calls.indexOf('retry-click'));
  assert(page.calls.indexOf('response-finished')<page.calls.indexOf('screenshot-recovered'));
  assert.equal(page.faultInstalled(),false);assert.equal(page.listenerCount('response'),0);
});
test('empty Next announcer and unrelated global alert are retained, not mistaken for table failure or silently discarded',async()=>{
  const result=await recoverContactReadThroughUi(pageDouble(),args);
  for(const alerts of Object.values(result.globalAlerts)){
    assert.equal(alerts.length,2);assert.equal(alerts[0].text,'');assert.equal(alerts[0].id,'__next-route-announcer__');
    assert.equal(alerts[1].text,'Notifikasi lain yang harus dilaporkan');
  }
});
for(const [name,configuration,message] of [
  ['unrelated alert cannot replace missing specific table error',{errorNeverRenders:true},'fake-specific-error-timeout'],
  ['fault not actually exercised is rejected',{noFault:true},'CONTACT_READ_FAULT_NOT_EXERCISED'],
  ['fault screenshot failure still removes route',{faultScreenshotFails:true},'fake-screenshot-failure'],
  ['unroute failure cannot become a successful recovery',{unrouteFails:true},'fake-unroute-failure'],
  ['retry HTTP503 is not success',{status:503},'CONTACT_READ_RETRY_HTTP_FAILED'],
  ['retry HTTP202 is not success',{status:202},'CONTACT_READ_RETRY_HTTP_FAILED'],
  ['response body failure is not a recovered UI',{bodyFailure:true},'CONTACT_READ_RETRY_BODY_FAILED'],
  ['different first contact cannot count as restored data',{changedFirstRow:true},'CONTACT_READ_FIRST_ROW_NOT_RESTORED'],
  ['specific table error persisting remains a failure',{persistentError:true},'fake-specific-error-still-visible'],
  ['duplicate retry response is rejected',{duplicateResponse:true},'CONTACT_READ_RETRY_RESPONSE_COUNT'],
  ['wrong response origin is not accepted',{responseUrl:'http://example.test/api/v1/seputar-jaminan/contacts'},'fake-response-timeout'],
  ['non-GET response is not accepted',{responseMethod:'POST'},'fake-response-timeout'],
  ['retry click failure removes response listener',{retryClickFails:true},'fake-retry-click-failure'],
])test(name,async()=>{
  const page=pageDouble(configuration);
  await assert.rejects(recoverContactReadThroughUi(page,args),error=>error.message===message);
  assert.equal(page.faultInstalled(),false);assert.equal(page.listenerCount('response'),0);assert(page.calls.includes('unroute'));
});
test('an empty table fails before any fault is installed',async()=>{
  const page=pageDouble({empty:true});await assert.rejects(recoverContactReadThroughUi(page,args),/fake-row-timeout/);
  assert(!page.calls.includes('route'));assert.equal(page.listenerCount('response'),0);
});
test('foreign page and identical screenshot paths are refused before interaction',async()=>{
  const foreign=pageDouble({pageUrl:'http://127.0.0.1:4320/operators'});
  await assert.rejects(recoverContactReadThroughUi(foreign,args),/CONTACT_READ_OWNED_PAGE_REQUIRED/);assert.deepEqual(foreign.calls,[]);
  const page=pageDouble();await assert.rejects(recoverContactReadThroughUi(page,{file:'same',recoveredFile:'same'}),/CONTACT_READ_SCREENSHOT_PATHS_REQUIRED/);assert.deepEqual(page.calls,[]);
});
test('the actual serialized production function executes without module-local dependencies',async()=>{
  const serialized=new Function('return ('+recoverContactReadThroughUi.toString()+')')();
  const page=pageDouble(),result=await serialized(page,args);assert.equal(result.recovered,true);assert.equal(page.listenerCount('response'),0);
});
test('a matching URL with non-GET method is not aborted by the production route handler',async()=>{
  const page=pageDouble({probeNonGet:true}),result=await recoverContactReadThroughUi(page,args);
  assert.equal(result.failures,1);assert(page.calls.includes('non-GET-continued'));
});
test('unfinished response body hits the production deadline and removes the response listener',async()=>{
  const page=pageDouble({bodyHangs:true}),originalSet=global.setTimeout,originalClear=global.clearTimeout;
  const marker={ownedFakeTimer:true};let cleared=false;
  global.setTimeout=(callback,delay)=>{assert.equal(delay,20000);queueMicrotask(callback);return marker;};
  global.clearTimeout=timer=>{assert.equal(timer,marker);cleared=true;};
  try{
    await assert.rejects(recoverContactReadThroughUi(page,args),/CONTACT_READ_RETRY_BODY_TIMEOUT/);
    assert.equal(cleared,true);assert.equal(page.listenerCount('response'),0);assert.equal(page.faultInstalled(),false);
  }finally{global.setTimeout=originalSet;global.clearTimeout=originalClear;}
});
