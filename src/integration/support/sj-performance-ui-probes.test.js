'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {classifyProbeFailure,responseQueryMatches,waitForObservedWork,validModalFocusCycle,browserTools}=require('./sj-performance-ui-probes');
const {prefetchedFromHeaders}=require('./sj-production-performance');
const {attachBrowserNetworkDiagnostic}=require('./sj-performance-network-diagnostic');
const origin='http://127.0.0.1:3111';
const row={uri:'http://127.0.0.1:7111/api/v1/seputar-jaminan/publications',method:'GET',error:'net::ERR_ABORTED',prefetched:false,observedInWindow:true,action:'rapid-filter',superseded:true};
test('only captured superseded GET list filter aborts are expected, not arbitrary rapid-filter failures',()=>{
  assert.deepEqual(classifyProbeFailure(row,origin),{expected:true,reason:'PROVEN_SUPERSEDED_LIST_FILTER_ABORTED'});
  for(const changes of [{superseded:false},{observedInWindow:false},{observedInWindow:undefined},{method:'POST'},{action:'append'},
    {error:'net::ERR_CONNECTION_RESET'},{uri:'http://127.0.0.1:9998/api/v1/seputar-jaminan/publications'},
    {uri:'http://127.0.0.1:7111/api/v1/seputar-jaminan/settings'},
    {uri:'http://127.0.0.1:7111/api/v1/seputar-jaminan/publications/private-id'}]){
    assert.equal(classifyProbeFailure({...row,...changes},origin).expected,false);
  }
});
test('prefetch proof uses the same strict origin, method, route and window rules as measurement',()=>{
  const prefetch={...row,uri:origin+'/dashboard/account/security',prefetched:true,superseded:false,action:'initial'};
  assert.equal(classifyProbeFailure(prefetch,origin).expected,true);
  assert.equal(classifyProbeFailure({...prefetch,prefetched:false},origin).expected,false);
  assert.equal(classifyProbeFailure({...prefetch,uri:origin+'/dashboard/seputar-jaminan/kontak'},origin).expected,false);
});

test('intended list responses require exact origin, method, route and query, including cursor presence',()=>{
  const response=(url,method='GET')=>({url:()=>url,request:()=>({method:()=>method})});
  const contract={origin,pathname:'/api/reviews',query:{state:'all',page:2,limit:10,cursor:null}};
  assert.equal(responseQueryMatches(response(origin+'/api/reviews?state=all&page=2&limit=10'),contract),true);
  for(const url of [origin+'/api/reviews?state=all&page=1&limit=10',origin+'/api/reviews?state=APPROVED&page=2&limit=10',origin+'/api/reviews?state=all&page=2&limit=10&cursor=old',origin+'/api/reviews/private?state=all&page=2&limit=10','http://127.0.0.1:9998/api/reviews?state=all&page=2&limit=10'])assert.equal(responseQueryMatches(response(url),contract),false);
  assert.equal(responseQueryMatches(response(origin+'/api/reviews?state=all&page=2&limit=10','POST'),contract),false);
  assert.equal(responseQueryMatches(response('not-a-url'),contract),false);
  const cursor={origin,pathname:'/api/reviews',present:['cursor']};
  assert.equal(responseQueryMatches(response(origin+'/api/reviews?cursor=next'),cursor),true);
  assert.equal(responseQueryMatches(response(origin+'/api/reviews?cursor='),cursor),false);
  assert.equal(responseQueryMatches(response(origin+'/api/reviews'),cursor),false);
});

test('fresh activity is drained even when the previous document readiness was already satisfied',async()=>{
  let clock=0,revision=0;const active=new Map(),tasks=[];let added=false,parsed=false;
  await waitForObservedWork({active,tasks,getRevision:()=>revision,now:()=>clock,quietMs:50,timeoutMs:300,pause:async ms=>{
    clock+=ms;
    if(!added){added=true;active.set('new-client-read',true);revision++;}
    else if(clock>=75&&active.size){active.clear();tasks.push(Promise.resolve().then(()=>{parsed=true;}));revision++;}
  }});
  assert.equal(added,true);assert.equal(parsed,true);assert.equal(active.size,0);assert.ok(clock>=125);
});
test('response tasks registered during a drain are included before returning',async()=>{
  let clock=0,revision=0,secondParsed=false;const active=new Map(),tasks=[];
  tasks.push(Promise.resolve().then(()=>{tasks.push(Promise.resolve().then(()=>{secondParsed=true;}));revision++;}));
  await waitForObservedWork({active,tasks,getRevision:()=>revision,now:()=>clock,quietMs:25,timeoutMs:300,pause:async ms=>{clock+=ms;}});
  assert.equal(secondParsed,true);assert.ok(clock>=50);
});
test('never declares fresh work settled while a captured request remains pending',async()=>{
  let clock=0;
  await assert.rejects(waitForObservedWork({active:new Map([['pending',true]]),tasks:[],getRevision:()=>0,now:()=>clock,quietMs:25,timeoutMs:100,pause:async ms=>{clock+=ms;}}),/ObservedWorkDeadline/);
});

test('modal native cycles require every explicit control, order and both wraps',()=>{
  assert.equal(validModalFocusCycle({controlCount:2,forward:[0,1,0],reverse:[0,1,0]}),true);
  assert.equal(validModalFocusCycle({controlCount:2,forward:[0,2,1,0],reverse:[0,1,2,0],bodyInsertion:1}),true);
  assert.equal(validModalFocusCycle({controlCount:6,forward:[0,1,2,3,4,5,0],reverse:[0,5,4,3,2,1,0]}),true);
  for(const changes of [{forward:[0,2,1,0],reverse:[0,1,2,0]}, {forward:[0,-1,1,0],reverse:[0,1,0]}, {forward:[0,1],reverse:[0,1,0]}, {forward:[0,0],reverse:[0,1,0]}, {forward:[0,1,1,0],reverse:[0,1,0]}, {forward:[0,1,0],reverse:[0,-1,0]}, {forward:[0,2,1,0],reverse:[0,2,1,0],bodyInsertion:1}])assert.equal(validModalFocusCycle({controlCount:2,...changes}),false);
  assert.equal(validModalFocusCycle({controlCount:3,forward:[0,2,1,0],reverse:[0,1,2,0]}),false);
});

// EventEmitter doubles exercise telemetry only: no browser, HTTP, database,
// credentials, RSC body reads, or application authentication are involved.
class DiagnosticPage extends EventEmitter {
  constructor(){super();this.location='http://127.0.0.1:4100/katalog';this.waits=0;this.failStage=null;}
  url(){return this.location;}
  locator(){return {ariaSnapshot:async()=>'- main\n  - heading'};}
  async waitForFunction(){this.waits++;if(this.failStage==='ready-before'&&this.waits===1||this.failStage==='ready-after'&&this.waits===2){const error=new Error('private router/cursor value');error.name='TimeoutError';throw error;}}
  async evaluate(fn){
    const source=fn.toString();
    if(source.includes('document.fonts')&&this.failStage==='fonts')throw Error('private font URL');
    if(source.includes('requestAnimationFrame')&&this.failStage==='animation-frames')throw Error('private frame detail');
    if(source.includes('width: innerWidth'))return {width:1440,height:900,overflow:false};
  }
}
const diagnosticRequest=(url,changes={})=>({url:()=>url,method:()=>changes.method||'GET',resourceType:()=>changes.type||'fetch',headers:()=>changes.headers||{rsc:'1','next-router-state-tree':'private-router-tree'},failure:()=>({errorText:changes.error||'net::ERR_ABORTED'})});
const diagnosticResponse=(request,{status=200,mime='text/x-component; charset=utf-8'}={})=>({request:()=>request,url:()=>request.url(),status:()=>status,headers:()=>({'content-type':mime}),json:()=>{throw Error('RSC bodies must not be consumed');}});
const complete=(page,request,changes)=>{page.emit('request',request);page.emit('response',diagnosticResponse(request,changes));page.emit('requestfinished',request);};

test('RSC transport completion is observed without consuming its body or waiving abort',async()=>{
  const before=Date.now(),page=new DiagnosticPage(),t=browserTools(page),request=diagnosticRequest(page.url()+'?cursor=private-cursor&_rsc=abc');
  const response={...diagnosticResponse(request),finished:async()=>new Error('net::ERR_ABORTED')};
  try{
    await t.action('next-page',async()=>{
      t.navigationIntent(page.url()+'?cursor=private-cursor');
      page.emit('request',request);page.emit('response',response);page.emit('requestfailed',request);
    });
    const result=await t.finish({});
    assert.ok(result.startedAt>=before&&result.startedAt<=Date.now());
    assert.ok(Number.isFinite(result.durationMs)&&result.durationMs>=0);
    assert.equal(result.responses[0].transportCompletion.finished,false);
    assert.equal(result.responses[0].transportCompletion.error,'net::ERR_ABORTED');
    assert.equal(result.failures[0].expected,false);
    assert.ok(result.issues.some(issue=>issue.code==='UNEXPECTED_REQUEST_FAILURE'));
    assert.equal(JSON.stringify(result).includes('private-cursor'),false);
  }finally{t.dispose();}
});

test('RSC completion errors retain only allowlisted diagnostics',async()=>{
  const page=new DiagnosticPage(),t=browserTools(page),request=diagnosticRequest(page.url()+'?_rsc=abc');
  const response={...diagnosticResponse(request),finished:async()=>new Error('Bearer secret postgres://user:password@host')};
  try{
    await t.action('next-page',async()=>{page.emit('request',request);page.emit('response',response);page.emit('requestfinished',request);});
    const result=await t.finish({});assert.equal(result.responses[0].transportCompletion.error,'REQUEST_FAILED');
    assert.ok(result.issues.some(issue=>issue.code==='RSC_TRANSPORT_NOT_COMPLETED'));
    assert.equal(JSON.stringify(result).includes('password'),false);
    assert.equal(JSON.stringify(result).includes('Bearer'),false);
  }finally{t.dispose();}
});

test('viewport preparation releases and drains the previous document before resizing',async()=>{
  const page=new DiagnosticPage(),trace=[],t=browserTools(page);
  page.goto=async(url,options)=>{trace.push(['goto',url,options.waitUntil]);page.location=url;};
  page.setViewportSize=async(size)=>{trace.push(['resize',size]);};
  try{
    await t.prepareViewport(1024,480);
    assert.deepEqual(trace,[['goto','about:blank','domcontentloaded'],['resize',{width:1024,height:480}]]);
    const result=await t.finish({});
    assert.equal(result.settles[0].settled,true);assert.deepEqual(result.issues,[]);
  }finally{t.dispose();}
});

test('failed old-document drain cannot resize the page or hide the measurement failure',async()=>{
  const page=new DiagnosticPage(),t=browserTools(page);let resized=false;
  page.goto=async url=>{page.location=url;};page.setViewportSize=async()=>{resized=true;};page.failStage='fonts';
  try{
    await assert.rejects(t.prepareViewport(1440,600),/PreviousDocumentNotDrained/);
    assert.equal(resized,false);
    page.failStage=null;
    const result=await t.finish({});assert.equal(result.issues[0].code,'SETTLE_DEADLINE');
  }finally{t.dispose();}
});

test('correlates a completed RSC response by captured sequence with ordered terminal evidence',async()=>{
  const page=new DiagnosticPage(),t=browserTools(page);
  try{
    await t.action('next-page',async()=>{t.navigationIntent('/katalog?cursor=private-cursor');complete(page,diagnosticRequest(page.url()+'?cursor=private-cursor&_rsc=abc12'));});
    const result=await t.finish({});
    assert.equal(result.issues.length,0);assert.equal(result.requests.length,1);assert.equal(result.lifecycle.length,1);
    const request=result.requests[0],response=result.responses[0],finished=result.lifecycle[0];
    for(const row of [request,response,finished]){assert.equal(row.sequence,0);assert.equal(row.actionSequence,0);assert.equal(row.observedInWindow,true);assert.equal(row.intendedDestinationMatch,true);}
    assert.equal(request.rscRequest,true);assert.equal(request.routerStateHeaderPresent,true);assert.equal(request.rscMarkerValid,true);
    assert.equal(response.mime,'rsc');assert.equal(response.status,200);assert.equal(response.responseObserved,true);
    assert.equal(finished.outcome,'finished');assert.equal(finished.responseStatus,200);assert.equal(finished.responseMime,'rsc');
    assert.ok(request.startedElapsedMs<=response.responseElapsedMs);assert.ok(response.responseElapsedMs<=finished.finishedElapsedMs);
    assert.equal(result.finalPending.length,0);assert.equal(result.actions[0].pendingAfter.length,0);
    assert.deepEqual(result.settles[0].stages.map(value=>value.stage),['fonts','observed-work','animation-frames']);
  }finally{t.dispose();}
});

test('a 200 then abort retains originating and failure phases and still fails the strict gate',async()=>{
  const page=new DiagnosticPage(),t=browserTools(page),request=diagnosticRequest(page.url()+'?cursor=private-cursor&_rsc=abc');
  try{
    page.failStage='ready-before';
    await t.action('next-page',async()=>{t.navigationIntent('/katalog?cursor=private-cursor');page.emit('request',request);page.emit('response',diagnosticResponse(request));},()=>true);
    page.failStage=null;
    await t.action('first-page',async()=>{t.navigationIntent('/katalog');page.emit('requestfailed',request);});
    const result=await t.finish({}),failure=result.failures[0];
    assert.equal(result.responses[0].sequence,failure.sequence);assert.equal(failure.action,'next-page');assert.equal(failure.actionSequence,0);
    assert.equal(failure.eventAction,'first-page');assert.equal(failure.eventActionSequence,1);assert.equal(failure.responseStatus,200);assert.equal(failure.responseMime,'rsc');
    assert.equal(failure.expected,false);assert.equal(failure.observedInWindow,true);assert.equal(failure.outcome,'failed');
    assert.ok(failure.responseElapsedMs<=failure.failedElapsedMs);assert.ok(result.issues.some(value=>value.code==='UNEXPECTED_REQUEST_FAILURE'&&value.count===1));
    assert.equal(result.actions[0].pendingAfter[0].sequence,0);assert.equal(result.actions[1].pendingBefore[0].sequence,0);
    assert.equal(result.settles[0].failedStage,'ready-before');assert.ok(result.issues.some(value=>value.code==='SETTLE_DEADLINE'));
  }finally{t.dispose();}
});

test('uncaptured lifecycle and reused URLs do not acquire a captured sequence or destination proof',async()=>{
  const page=new DiagnosticPage(),t=browserTools(page),url=page.url()+'?cursor=private-cursor&_rsc=abc';
  try{
    await t.action('next-page',async()=>{
      t.navigationIntent('/katalog?cursor=private-cursor');
      const prior=diagnosticRequest(url);page.emit('response',diagnosticResponse(prior));page.emit('requestfailed',prior);
      complete(page,diagnosticRequest(url));complete(page,diagnosticRequest(url));
    });
    const result=await t.finish({});
    assert.equal(result.responses[0].sequence,null);assert.equal(result.responses[0].observedInWindow,false);assert.equal(result.responses[0].intendedDestinationMatch,null);
    assert.equal(result.failures[0].sequence,null);assert.equal(result.failures[0].capturedInWindow,false);assert.equal(result.failures[0].expected,false);
    assert.deepEqual(result.requests.map(value=>value.sequence),[0,1]);assert.deepEqual(result.responses.slice(1).map(value=>value.sequence),[0,1]);
    assert.equal(result.requests.length,2);assert.equal(result.finalPending.length,0);
  }finally{t.dispose();}
});

test('destination telemetry checks all scalar query keys privately and only ignores one valid RSC marker',async()=>{
  const page=new DiagnosticPage(),t=browserTools(page),base=page.url();
  const cases=[
    [base+'?category=LAND&cursor=private-cursor',{},true],
    [base+'?cursor=private-cursor&category=LAND&_rsc=abc12',{},true],
    [base+'?category=LAND&cursor=private-cursor&_rsc=AbC_deF-GhIj0123',{},true],
    [base+'?category=LAND&cursor=private-cursor&_rsc=abc123',{},false],
    [base+'?category=LAND&cursor=private-cursor&_rsc=AbC_deF-GhIj012',{},false],
    [base+'?category=LAND&cursor=private-cursor&_rsc=AbC_deF-GhIj01234',{},false],
    [base+'?category=LAND&cursor=private-cursor&_rsc=AbC+deF-GhIj0123',{},false],
    [base+'?category=LAND&cursor=wrong-private-cursor',{},false],
    [base+'?category=LAND&cursor=private-cursor&cursor=private-cursor',{},false],
    [base+'?category=LAND&cursor=private-cursor&extra=private-extra',{},false],
    [base+'?category=LAND&cursor=private-cursor&_rsc=abc&_rsc=def',{},false],
    [base+'?category=LAND&cursor=private-cursor&_rsc=',{},false],
    ['http://127.0.0.1:4999/katalog?category=LAND&cursor=private-cursor',{},false],
    [base+'/other?category=LAND&cursor=private-cursor',{},false],
    [base+'?category=LAND&cursor=private-cursor',{method:'POST'},false],
  ];
  try{
    await t.action('next-page',async()=>{t.navigationIntent('/katalog?category=LAND&cursor=private-cursor');for(const [url,changes] of cases)complete(page,diagnosticRequest(url,changes));});
    const result=await t.finish({});assert.deepEqual(result.requests.map(value=>value.intendedDestinationMatch),cases.map(value=>value[2]));
    assert.ok(result.requests.every(value=>value.intentActionSequence===0));
    const serialized=JSON.stringify(result);for(const privateValue of ['private-cursor','wrong-private-cursor','private-extra','private-router-tree'])assert.equal(serialized.includes(privateValue),false);
  }finally{t.dispose();}
});

test('invalid navigation intents fail without publishing their values or registering proof',async()=>{
  const page=new DiagnosticPage(),t=browserTools(page);
  try{
    assert.throws(()=>t.navigationIntent('/katalog'),/InvalidNavigationIntent/);
    await t.action('invalid-intents',async()=>{
      for(const url of ['http://127.0.0.1:4999/katalog','/other','/katalog#private-hash','/katalog?_rsc=abc','/katalog?cursor=private-cursor&cursor=private-cursor'])assert.throws(()=>t.navigationIntent(url),/InvalidNavigationIntent/);
      complete(page,diagnosticRequest(page.url()));
    });
    const result=await t.finish({});assert.equal(result.navigationIntents.length,0);assert.equal(result.requests[0].intendedDestinationMatch,null);
  }finally{t.dispose();}
});

test('MIME and RSC flags do not turn arbitrary or failed transports into an expected cancellation',async()=>{
  const page=new DiagnosticPage(),t=browserTools(page);
  try{
    await t.action('next-page',async()=>{
      t.navigationIntent('/katalog');
      for(const [headers,mime,status] of [[{rsc:'0'},'application/json',200],[{},'text/html',200],[{rsc:'1'},'application/private-sensitive-type',503]]){
        const request=diagnosticRequest(page.url()+'?_rsc=abc',{headers});page.emit('request',request);page.emit('response',diagnosticResponse(request,{mime,status}));page.emit('requestfailed',request);
      }
    });
    const result=await t.finish({});assert.deepEqual(result.requests.map(value=>value.rscRequest),[false,false,true]);
    assert.deepEqual(result.responses.map(value=>value.mime),['json','html','other']);assert.ok(result.failures.every(value=>value.expected===false));
    assert.ok(result.issues.some(value=>value.code==='UNEXPECTED_REQUEST_FAILURE'&&value.count===3));assert.ok(result.issues.some(value=>value.code==='HTTP_ERROR'&&value.count===1));
    assert.equal(JSON.stringify(result).includes('private-sensitive-type'),false);
  }finally{t.dispose();}
});

test('arbitrary failure, exception and header text remains private while errors stay visible',async()=>{
  const page=new DiagnosticPage(),t=browserTools(page);
  try{
    await t.action('unsafe-error',async()=>{
      const request=diagnosticRequest(page.url()+'?cursor=private-cursor',{headers:{rsc:'1',authorization:'Bearer private-token',cookie:'private-cookie','next-router-state-tree':'private-router-tree'},error:'net::ERR_ABORTED private-token private-cursor'});
      page.emit('request',request);page.emit('requestfailed',request);
      const oversized=diagnosticRequest(page.url(),{error:'net::ERR_'+'X'.repeat(65)});page.emit('request',oversized);page.emit('requestfailed',oversized);
      page.emit('console',{type:()=> 'error'});page.emit('pageerror',Error('private-page-error'));
      const error=Error('private-exception-text');error.name='private-exception-name';throw error;
    });
    const result=await t.finish({});assert.deepEqual(result.failures.map(value=>value.error),['REQUEST_FAILED','REQUEST_FAILED']);assert.ok(result.failures.every(value=>value.expected===false));
    const issue=result.issues.find(value=>value.code==='ACTION_NOT_COMPLETED');assert.equal(issue.errorName,'OtherError');assert.equal(issue.reason,'UNCLASSIFIED_ERROR');
    assert.ok(result.issues.some(value=>value.code==='CONSOLE_ERROR'));assert.ok(result.issues.some(value=>value.code==='PAGE_ERROR'));assert.ok(result.issues.some(value=>value.code==='UNEXPECTED_REQUEST_FAILURE'));
    for(const value of ['private-token','private-cookie','private-router-tree','private-cursor','private-exception','private-page-error'])assert.equal(JSON.stringify(result).includes(value),false);
  }finally{t.dispose();}
});

for(const failedStage of ['ready-before','fonts','animation-frames','ready-after'])test('settle records the exact failed '+failedStage+' stage without exporting error detail',async()=>{
  const page=new DiagnosticPage(),t=browserTools(page);page.failStage=failedStage;
  try{
    assert.equal(await t.settle(()=>true),false);page.failStage=null;
    const result=await t.finish({}),record=result.settles[0],issue=result.issues.find(value=>value.code==='SETTLE_DEADLINE');
    assert.equal(record.failedStage,failedStage);assert.equal(record.settled,false);assert.equal(issue.stage,failedStage);
    assert.equal(record.stages.at(-1).completed,false);assert.ok(record.startedElapsedMs<=record.endedElapsedMs);
    assert.equal(record.reason,'UNCLASSIFIED_ERROR');assert.equal(JSON.stringify(result).includes('private'),false);
  }finally{t.dispose();}
});

test('all pending rows survive a bounded observed-work deadline and remain a final gate failure',async()=>{
  const page=new DiagnosticPage(),t=browserTools(page),now=Date.now;let clock=now();
  try{
    page.emit('request',diagnosticRequest(page.url()+'?cursor=private-one'));page.emit('request',diagnosticRequest(page.url()+'?cursor=private-two'));
    // Advance the pure-test clock only; actual browser wait budgets are intact.
    Date.now=()=>{clock+=1000;return clock;};
    const result=await t.finish({});
    assert.deepEqual(result.finalPending.map(value=>value.sequence),[0,1]);assert.equal(result.lifecycle.length,0);assert.ok(result.requests.every(value=>value.outcome==='pending'));
    assert.equal(result.settles[0].failedStage,'observed-work');assert.equal(result.settles[0].reason,'ObservedWorkDeadline');
    assert.deepEqual(result.settles[0].pendingBefore.map(value=>value.sequence),[0,1]);assert.deepEqual(result.settles[0].pendingAfter.map(value=>value.sequence),[0,1]);
    const issue=result.issues.find(value=>value.code==='REQUEST_STILL_PENDING');assert.equal(issue.count,2);assert.deepEqual(issue.pending.map(value=>value.sequence),[0,1]);
  }finally{Date.now=now;t.dispose();}
});

test('serialized browserTools remains self-contained with supplied helpers and cleans up network listeners',async()=>{
  const factory=new Function('prefetchedFromHeaders','classifyProbeFailure','waitForObservedWork','responseQueryMatches','attachBrowserNetworkDiagnostic','return ('+browserTools.toString()+')');
  const attach=new Function('return ('+attachBrowserNetworkDiagnostic.toString()+')')();
  const create=factory(prefetchedFromHeaders,classifyProbeFailure,waitForObservedWork,responseQueryMatches,attach),page=new DiagnosticPage(),session=new EventEmitter();
  const sent=[];let detached=0;session.send=async name=>sent.push(name);session.detach=async()=>{detached++;};
  page.context=()=>({newCDPSession:async()=>session});const t=create(page);
  try{
    await t.captureNetwork();
    await t.action('next-page',async()=>{t.navigationIntent('/katalog');complete(page,diagnosticRequest(page.url()+'?_rsc=abc'));});
    const result=await t.finish({});assert.equal(result.issues.length,0);assert.equal(result.lifecycle[0].outcome,'finished');
    assert.deepEqual(sent,['Network.enable']);assert.equal(detached,1);assert.equal(result.networkDiagnostic.closed,true);assert.equal(result.networkDiagnostic.detached,true);
  }finally{await t.closeNetwork();t.dispose();}
  for(const name of ['request','requestfinished','requestfailed','response','console','pageerror'])assert.equal(page.listenerCount(name),0);
  assert.equal(session.eventNames().length,0);
});

test('instrumented catalog code compiles with exact serialized helpers and never relaxes transport failures',()=>{
  const {catalogCancellationDiagnosticCode}=require('./sj-performance-ui-probes');
  const source=catalogCancellationDiagnosticCode({url:'http://127.0.0.1:4411/katalog',screenshot:'C:/owned/quoted"-capture.png'});
  new vm.Script('('+source+')');
  assert.match(source,/performanceGate:'NOT RUN'/);assert.match(source,/RSC_TRANSPORT_NOT_COMPLETED/);
  assert.match(source,/value\.close\(\)/);assert.match(source,/page\.evaluateHandle\(/);assert.match(source,/await handle\.dispose\(\)/);
  assert.doesNotMatch(source,/sj-owned-catalog-cancel-diagnostic|Reflect\.deleteProperty/);
  assert.match(source,/const install=function installBrowserCancellationDiagnostic/);
  assert.match(source,/return install\(\{maxEvents:200,trackResponseStreams:true\}\)/);
});

const restoredOwnershipCapture=()=>({version:1,capture:'native-call-observation-only',trackResponseStreams:true,
  startedAt:1800000000000,cap:200,pendingPromiseObservations:0,responses:[],streams:[],readers:[],events:[],
  closed:true,active:false,restoreFailures:0,listenerFailures:0});

test('separate catalog diagnostic preserves failed strict probes and labels three bounded reproductions',async()=>{
  const {runCatalogCancellationDiagnostic}=require('./sj-performance-ui-probes');
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'sj-pure-catalog-diagnostic-')),commands=[],sources=[];
  try{
    const report=await runCatalogCancellationDiagnostic({out,publicUi:'http://127.0.0.1:4411',cli:async(...args)=>commands.push(args),code:async source=>{
      new vm.Script('('+source+')');sources.push(source);
      return {completed:true,probe:{issues:[{code:'RSC_TRANSPORT_NOT_COMPLETED'}]},native:restoredOwnershipCapture()};
    }});
    const stored=JSON.parse(fs.readFileSync(report.evidence,'utf8'));
    assert.equal(report.repetitions,3);assert.equal(stored.repetitions.length,3);assert.equal(sources.length,3);
    assert.match(stored.mode,/NOT final performance/);assert.equal('pass' in stored,false);
    assert.ok(stored.repetitions.every(row=>row.probe.issues[0].code==='RSC_TRANSPORT_NOT_COMPLETED'));
    assert.equal(commands.length,9);assert.ok(commands.filter(row=>row[0]==='goto').every(row=>row[1]==='http://127.0.0.1:4411/katalog'));
  }finally{fs.rmSync(out,{recursive:true});}
});

test('missing ownership tracking, invalid anchors and incomplete restore cannot become diagnostic proof',async()=>{
  const {runCatalogCancellationDiagnostic}=require('./sj-performance-ui-probes');
  for(const changes of [{trackResponseStreams:false},{trackResponseStreams:undefined},{startedAt:null},
    {startedAt:Infinity},{startedAt:-1},{readers:undefined},{cap:201},{pendingPromiseObservations:201},
    {pendingPromiseObservations:-1},{restoreFailures:undefined},{listenerFailures:undefined}]){
    const out=fs.mkdtempSync(path.join(os.tmpdir(),'sj-pure-catalog-incomplete-'));let calls=0;
    try{
      await assert.rejects(runCatalogCancellationDiagnostic({out,publicUi:'http://127.0.0.1:4411',cli:async()=>{},code:async()=>{
        calls++;return {completed:true,native:{...restoredOwnershipCapture(),...changes}};
      }}),/Diagnostic(?:OwnershipCapture|NativeRestoration)NotProven/);
      const stored=JSON.parse(fs.readFileSync(path.join(out,'catalog-cancel-diagnostic.json'),'utf8'));
      assert.equal(calls,1);assert.equal(stored.repetitions.length,1);assert.equal(stored.finishedAt,undefined);
    }finally{fs.rmSync(out,{recursive:true});}
  }
});

test('failed capture is persisted before refusal and retains previous repetitions without private error text',async()=>{
  const {runCatalogCancellationDiagnostic}=require('./sj-performance-ui-probes');
  for(const failedRepetition of [1,2]){
    const out=fs.mkdtempSync(path.join(os.tmpdir(),'sj-pure-catalog-rejected-'));let calls=0;
    try{
      await assert.rejects(runCatalogCancellationDiagnostic({out,publicUi:'http://127.0.0.1:4411',cli:async()=>{},code:async()=>{
        calls++;if(calls===failedRepetition)throw new TypeError('secret-context-token');
        return {completed:true,probe:{issues:[{code:'RSC_TRANSPORT_NOT_COMPLETED'}]},native:restoredOwnershipCapture()};
      }}),/^Error: DiagnosticRepetitionNotCompleted$/);
      const text=fs.readFileSync(path.join(out,'catalog-cancel-diagnostic.json'),'utf8'),stored=JSON.parse(text);
      assert.equal(calls,failedRepetition);assert.equal(stored.repetitions.length,failedRepetition);
      assert.equal(stored.repetitions.at(-1).phase,'capture-and-restore');
      assert.equal(stored.repetitions.at(-1).captureState,'failed');
      assert.equal(stored.repetitions.at(-1).failure.reason,'DIAGNOSTIC_CAPTURE_OR_RESTORATION_FAILED');
      assert.equal('native' in stored.repetitions.at(-1),false);assert.equal(stored.finishedAt,undefined);
      if(failedRepetition===2)assert.equal(stored.repetitions[0].probe.issues[0].code,'RSC_TRANSPORT_NOT_COMPLETED');
      assert.doesNotMatch(text,/secret|token|context-token/);
    }finally{fs.rmSync(out,{recursive:true});}
  }
});

test('browser preparation failure retains a failed attempt without claiming installed hooks or cleanup',async()=>{
  const {runCatalogCancellationDiagnostic}=require('./sj-performance-ui-probes');
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'sj-pure-catalog-prepare-'));let captures=0;
  try{
    await assert.rejects(runCatalogCancellationDiagnostic({out,publicUi:'http://127.0.0.1:4411',
      cli:async()=>{throw Error('secret-browser-state');},code:async()=>{captures++;}}),/DiagnosticRepetitionNotCompleted/);
    const text=fs.readFileSync(path.join(out,'catalog-cancel-diagnostic.json'),'utf8'),stored=JSON.parse(text);
    assert.equal(captures,0);assert.equal(stored.repetitions.length,1);
    assert.equal(stored.repetitions[0].phase,'prepare-browser');
    assert.equal(stored.repetitions[0].failure.reason,'DIAGNOSTIC_PREPARATION_FAILED');
    assert.equal('native' in stored.repetitions[0],false);assert.equal(stored.finishedAt,undefined);
    assert.doesNotMatch(text,/secret|browser-state/);
  }finally{fs.rmSync(out,{recursive:true});}
});

test('diagnostic restoration failure is retained and stops further instrumented repetitions',async()=>{
  const {runCatalogCancellationDiagnostic}=require('./sj-performance-ui-probes');
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'sj-pure-catalog-diagnostic-'));let calls=0;
  try{
    await assert.rejects(runCatalogCancellationDiagnostic({out,publicUi:'http://127.0.0.1:4411',cli:async()=>{},code:async()=>{
      calls++;return {completed:false,native:{closed:true,active:false,restoreFailures:1,listenerFailures:0}};
    }}),/DiagnosticNativeRestorationNotProven/);
    const stored=JSON.parse(fs.readFileSync(path.join(out,'catalog-cancel-diagnostic.json'),'utf8'));
    assert.equal(calls,1);assert.equal(stored.repetitions[0].native.restoreFailures,1);assert.equal(stored.finishedAt,undefined);
  }finally{fs.rmSync(out,{recursive:true});}
});

test('private diagnostic handle closes only its captured object, without invoking or deleting foreign page state',async()=>{
  const {closeBrowserCancellationDiagnosticHandle}=require('./sj-performance-ui-probes');
  let ownedClosed=0,foreignClosed=0,disposed=0;
  const owned={close:()=>{ownedClosed++;return {closed:true};}},foreign={close:()=>{foreignClosed++;}};
  const unrelated={lease:foreign};
  const result=await closeBrowserCancellationDiagnosticHandle({evaluate:async fn=>fn(owned),dispose:async()=>{disposed++;}});
  assert.deepEqual(result,{closed:true});assert.equal(ownedClosed,1);assert.equal(disposed,1);
  assert.equal(foreignClosed,0);assert.equal(unrelated.lease,foreign);
});

test('diagnostic handle is disposed even when context/restoration evaluation fails',async()=>{
  const {closeBrowserCancellationDiagnosticHandle}=require('./sj-performance-ui-probes');let disposed=0;
  await assert.rejects(closeBrowserCancellationDiagnosticHandle({evaluate:async()=>{throw Error('ContextDestroyed');},dispose:async()=>{disposed++;}}),/ContextDestroyed/);
  assert.equal(disposed,1);
});

test('repeat template uses existing strict catalog probe, without native fetch/stream instrumentation',()=>{
  const {catalogTransportRepeatCode}=require('./sj-performance-ui-probes');
  const source=catalogTransportRepeatCode({url:'http://127.0.0.1:4411/katalog',screenshot:'unit-only.png'});
  new vm.Script('('+source+')');
  assert.match(source,/response\.finished\(\)/);assert.match(source,/PREFETCH_NOT_PROVEN|classifyRequestFailure/);
  assert.match(source,/RSC_TRANSPORT_NOT_COMPLETED/);assert.match(source,/Lihat aset berikutnya/);
  assert.doesNotMatch(source,/installBrowserCancellationDiagnostic|evaluateHandle|trackResponseStreams/);
});

for(const failed of [false,true])test('three plain catalog repeats retain '+(failed?'failed transport':'complete capture')+' (pure browser double)',async t=>{
  const {runCatalogTransportRepeats}=require('./sj-performance-ui-probes');
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'sj-plain-repeat-unit-'));
  t.after(()=>{assert.equal(fs.realpathSync(out),path.resolve(out));assert.ok(path.basename(out).startsWith('sj-plain-repeat-unit-'));fs.rmSync(out,{recursive:true});});
  let calls=0;
  const result=await runCatalogTransportRepeats({out,publicUi:'http://127.0.0.1:4411',cli:async()=>{},code:async source=>{calls++;new vm.Script('('+source+')');return {name:'sj-catalog-cursor',issues:failed?[{code:'RSC_TRANSPORT_NOT_COMPLETED',action:'first-page'}]:[]};}});
  assert.equal(calls,3);assert.equal(result.probes.length,3);assert.equal(result.pass,!failed);assert.equal(result.issues.length,failed?3:0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out,'catalog-transport-repeats.json'),'utf8')),result);
});
