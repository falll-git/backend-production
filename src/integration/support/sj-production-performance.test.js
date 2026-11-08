const {test}=require('node:test'),assert=require('node:assert/strict');
const {summary,delta,pollingClass,idleMeasurementIssues,captureIdleMeasurement,prefetchedFromHeaders,classifyRequestFailure,browserMeasurementIssues,clsSessionScore,layoutShiftRecord,navigationResponseMetadata}=require('./sj-production-performance');

test('navigation response capture serializes without body retrieval or a false byte measurement',()=>{
  const capture=Function('return ('+navigationResponseMetadata.toString()+')')();
  const request={resourceType:()=> 'image'};
  const response={url:()=> 'http://owned.invalid/media?variant=thumbnail',status:()=>200,
    request:()=>request,headers:()=>({'cache-control':'private, no-store','content-type':'image/webp'}),
    body(){throw Error('Must not read an evicted previous-document body');},
    sizes(){throw Error('Must not perform a replacement size lookup');}};
  const key=url=>new URL(url).pathname;
  for(const observedInWindow of [true,false,undefined]){
    const row=capture(response,key,observedInWindow);
    assert.deepEqual(row,{path:'/media',status:200,type:'image',cache:'private, no-store',mime:'image/webp',observedInWindow:observedInWindow===true});
    assert.equal(Object.hasOwn(row,'bytes'),false,'metadata never claims zero bytes or response-body success');
  }
});

test('navigation response ownership survives requestfinished and does not infer an old response was observed',()=>{
  const observed=new WeakSet(),active=new Map(),request={resourceType:()=> 'image'},previous={resourceType:()=> 'image'};
  observed.add(request);active.set(request,{});active.delete(request);
  const capture=req=>navigationResponseMetadata({url:()=> 'http://owned.invalid/media',status:()=>503,request:()=>req,headers:()=>({})},url=>new URL(url).pathname,observed.has(req));
  assert.deepEqual(capture(request),{path:'/media',status:503,type:'image',cache:null,mime:null,observedInWindow:true});
  assert.equal(capture(previous).observedInWindow,false);
  assert.equal(browserMeasurementIssues('bank-publications',browserRun({responses:[capture(request)]}))[0].code,'BROWSER_HTTP_ERROR','real HTTP errors remain a failing gate');
});

test('generated warm-navigation collector never reads image bodies and keeps byte measurements explicit',()=>{
  const fs=require('node:fs'),source=fs.readFileSync(require.resolve('./sj-production-performance'),'utf8');
  const capture=source.slice(source.indexOf('const measured=await code(`async(page)=>{const runs=[];'),source.indexOf('// API sample distributions'));
  assert.ok(capture.includes('navigationResponseMetadata=${navigationResponseMetadata.toString()}'));
  assert.ok(capture.includes('observedRequests.add(r)')&&capture.includes('observedRequests.has(r.request())'));
  assert.ok(capture.includes("bytes:null,byteSource:'NOT_READ_BY_NAVIGATION_OBSERVER'"));
  assert.doesNotMatch(capture,/\.body\(\)|\.sizes\(\)/);
  assert.ok(capture.includes('page.off(\'response\',onResp)'), 'response listener still detached in finally');
  assert.ok(source.includes('body=await r.body();firstBody??=body'),'dedicated real media measurement is not removed');
});
test('shift attribution is bounded and never exports business text, IDs, attributes or URLs',()=>{
  const rectangle={x:1,y:2,width:3,height:4};
  const source={node:{tagName:'DIV',nodeType:1,className:'private-customer-name page-header__actions',id:'sensitive',textContent:'secret',src:'private'},previousRect:rectangle,currentRect:rectangle};
  const entry={value:.1,startTime:20,sources:Array.from({length:6},()=>source)};
  const record=layoutShiftRecord(entry);
  assert.equal(record.value,.1);assert.equal(record.time,20);assert.equal(record.sourcesTruncated,true);assert.equal(record.sources.length,5);
  assert.deepEqual(record.sources[0],{tag:'DIV',nodeType:1,classes:['page-header__actions'],before:rectangle,after:rectangle});
  assert.ok(!/secret|sensitive|customer|private/.test(JSON.stringify(record)));
  assert.equal(clsSessionScore([record]),clsSessionScore([{time:20,value:.1}]));
});
test('shift attribution handles removed and text nodes and nonfinite rectangles without new layout reads',()=>{
  const record=layoutShiftRecord({value:.2,startTime:10,sources:[
    {node:null,previousRect:{x:0,y:0,width:0,height:0},currentRect:{x:0,y:NaN,width:1,height:2}},
    {node:{nodeType:3},previousRect:null,currentRect:{x:Infinity,y:0,width:1,height:2}},
  ]});
  assert.equal(record.sourcesTruncated,false);assert.deepEqual(record.sources[0],{tag:null,nodeType:null,classes:[],before:{x:0,y:0,width:0,height:0},after:null});
  assert.equal(record.sources[1].tag,null);assert.equal(record.sources[1].nodeType,3);assert.equal(record.sources[1].after,null);
  assert.deepEqual(layoutShiftRecord({value:0,startTime:1}).sources,[]);
});
test('CLS session aggregation starts with the actual first shift, including an early shift',()=>{
  assert.equal(clsSessionScore([]),0);assert.equal(clsSessionScore([{time:500,value:.02}]),.02);
  assert.ok(Math.abs(clsSessionScore([500,1400,2300,3200,4100,5000,5400].map(time=>({time,value:.02})))-.14)<1e-12);
});
test('CLS gaps use strict one-second boundaries and independent sessions select the maximum',()=>{
  assert.equal(clsSessionScore([{time:10,value:.1},{time:1009,value:.2}]),.1+.2);
  assert.equal(clsSessionScore([{time:10,value:.1},{time:1010,value:.2}]),.2);
  assert.equal(clsSessionScore([{time:10,value:.1},{time:1010,value:.2},{time:1300,value:.2}]),.4);
});
test('CLS session duration uses strict five-second boundary and zero-value reference behavior',()=>{
  const rows=[500,1400,2300,3200,4100,5000].map(time=>({time,value:.02}));
  assert.ok(Math.abs(clsSessionScore([...rows,{time:5499,value:.02}])-.14)<1e-12);
  assert.ok(Math.abs(clsSessionScore([...rows,{time:5500,value:.02}])-.12)<1e-12);
  assert.equal(clsSessionScore([{time:0,value:0},{time:900,value:.1},{time:1800,value:.2}]),.1+.2);
});
test('only proven same-origin Control navigation prefetch aborts are expected',()=>{
  for(const path of ['/monitoring/pengiriman','/monitoring/pemrosesan']){
    const row={...failure(),origin:'http://127.0.0.1:4320',path:'http://127.0.0.1:4320'+path};
    assert.deepEqual(classifyRequestFailure(row),{expected:true,reason:'PROVEN_CONTROL_NAVIGATION_PREFETCH_ABORTED'});
    for(const changes of [{prefetched:false},{method:'POST'},{observedInWindow:false},{error:'net::ERR_CONNECTION_RESET'},
      {path:'http://127.0.0.1:9999'+path},{path:'http://127.0.0.1:4320/api/monitoring/pengiriman'},{path:'http://127.0.0.1:4320/monitoring/unknown'}]){
      assert.equal(classifyRequestFailure({...row,...changes}).expected,false);
    }
  }
});
test('finite samples report distribution rather than one latency',()=>{
  assert.deepEqual(summary([10,40,20,50,30]),{samples:5,minMs:10,medianMs:30,p95Ms:50,maxMs:50});
});
test('PG deltas preserve query identity across role and top-level execution',()=>{
  const row=(user_id,toplevel,calls,ms)=>({database:'owned',id:'42',user_id,toplevel,calls,ms,rows:calls,kind:'SELECT'});
  const result=delta([row('1',true,10,20),row('2',true,20,40),row('1',false,30,60)],
    [row('1',true,11,22),row('2',true,23,46),row('1',false,35,70)]);
  assert.equal(result.calls,9);assert.equal(result.executionMs,18);
  assert.deepEqual(result.statements.map(r=>r.calls),[1,3,5]);
});
test('idle unchanged and newly observed statements have exact deltas',()=>{
  const before=[{database:'owned',id:'1',user_id:'7',toplevel:true,calls:4,ms:10,rows:4,kind:'SELECT'}];
  assert.deepEqual(delta(before,before),{calls:0,executionMs:0,statements:[]});
  const result=delta(before,[...before,{database:'owned',id:'2',user_id:'8',toplevel:false,calls:2,ms:3,rows:5,kind:'OTHER'}]);
  assert.equal(result.calls,2);assert.equal(result.executionMs,3);assert.equal(result.statements[0].rows,5);
});
test('legitimate 45s bank notification poll is distinct from SJ data or unknown polling',()=>{
  assert.equal(pollingClass('/api/v1/notifications/unread-count'),'expected-bank-shell-notifications');
  for(const path of ['/api/v1/users/me','/api/v1/menus','/api/v1/role-menus'])
    assert.equal(pollingClass(path),'bank-shell-rbac-candidate','candidate classification is not independent proof');
  assert.equal(pollingClass('/api/v1/seputar-jaminan/publications'),'sj-data');
  assert.equal(pollingClass('/api/v1/other'),'unexpected');
});

const idleRow=(path,changes={})=>{
  const row={path,method:'GET',type:'xhr',elapsedMs:1000,originVerified:true,
    roleScoped:path==='/api/v1/role-menus'?true:null,queryContractVerified:true,status:200,failure:null,finished:true,completedElapsedMs:1100,...changes};
  if(!Object.hasOwn(changes,'networkTiming'))row.networkTiming={startElapsedMs:row.elapsedMs,requestElapsedMs:row.elapsedMs,
    responseStartElapsedMs:row.completedElapsedMs-1,responseEndElapsedMs:row.completedElapsedMs};
  return row;
};
const rbacRows=()=>[
  idleRow('/api/v1/users/me'),idleRow('/api/v1/menus',{elapsedMs:1200,completedElapsedMs:1300}),
  idleRow('/api/v1/role-menus',{elapsedMs:1200,completedElapsedMs:1300}),
];
const idleRun=(records=[],changes={})=>({durationMs:50000,drainTimeoutMs:5000,drainMs:0,
  roleContextAvailable:true,requests:records.map(row=>row.path),records,consoleErrors:[],pageErrors:[],pending:[],...changes});
const idleCodes=run=>idleMeasurementIssues('bank-contacts',run).map(issue=>issue.code);
test('idle acceptance requires zero or one complete scoped shell RBAC group, plus at most two notifications',()=>{
  const notification=()=>idleRow('/api/v1/notifications/unread-count');
  for(const rows of [[],[notification()],[notification(),notification()],rbacRows(),[...rbacRows(),notification(),notification()]])
    assert.deepEqual(idleMeasurementIssues('bank-contacts',idleRun(rows)),[]);
  assert.deepEqual(idleMeasurementIssues('control-reviews',idleRun([],{durationMs:12000,roleContextAvailable:null})),[]);
});
test('a group initiated at the window edge may finish its two follow-ups within the finite drain',()=>{
  const rows=[idleRow('/api/v1/users/me',{elapsedMs:49990,completedElapsedMs:50020}),
    idleRow('/api/v1/menus',{elapsedMs:50021,completedElapsedMs:50070}),
    idleRow('/api/v1/role-menus',{elapsedMs:50021,completedElapsedMs:50080})];
  assert.deepEqual(idleMeasurementIssues('bank-contacts',idleRun(rows,{drainMs:100})),[]);
});
test('partial or repeated shell groups and excessive notification calls fail independently of route classification',()=>{
  for(const rows of [rbacRows().slice(0,1),rbacRows().slice(0,2),[...rbacRows(),...rbacRows()],
    [...rbacRows(),idleRow('/api/v1/role-menus')]])
    assert.ok(idleCodes(idleRun(rows)).includes('IDLE_RBAC_GROUP_INCOMPLETE_OR_REPEATED'));
  assert.ok(idleCodes(idleRun(Array.from({length:3},()=>idleRow('/api/v1/notifications/unread-count')))).includes('IDLE_NOTIFICATION_COUNT'));
});
test('wrong or unproven current-role scope and missing browser role context remain failures',()=>{
  for(const roleScoped of [false,null,undefined]){
    const rows=rbacRows();rows[2].roleScoped=roleScoped;
    assert.ok(idleCodes(idleRun(rows)).includes('IDLE_ROLE_SCOPE_INVALID'));
  }
  assert.ok(idleCodes(idleRun([],{roleContextAvailable:false})).includes('IDLE_ROLE_CONTEXT_MISSING'));
});

test('missing or rejected query-contract proof cannot pass merely because a path is recognized',()=>{
  for(const queryContractVerified of [false,null,undefined]){
    const rows=rbacRows();rows[2].queryContractVerified=queryContractVerified;
    assert.ok(idleCodes(idleRun(rows)).includes('IDLE_QUERY_CONTRACT_INVALID'));
  }
});
test('foreign origin, method, resource type, non-200 status and failed requests are not waived for recognized paths',()=>{
  const path='/api/v1/notifications/unread-count';
  for(const [changes,code] of [[{originVerified:false},'IDLE_ORIGIN_UNPROVEN'],[{method:'POST'},'IDLE_METHOD_INVALID'],
    [{type:'document'},'IDLE_RESOURCE_TYPE_INVALID'],[{status:201},'IDLE_HTTP_STATUS'],[{status:401},'IDLE_HTTP_STATUS'],
    [{status:500},'IDLE_HTTP_STATUS'],[{failure:'net::ERR_CONNECTION_RESET',finished:false,status:null},'IDLE_REQUEST_FAILURE']])
    assert.ok(idleCodes(idleRun([idleRow(path,changes)])).includes(code),code);
});
test('unknown routes, actual SJ list polling and bank shell calls on Control are rejected',()=>{
  assert.ok(idleCodes(idleRun([idleRow('/api/v1/other')])).includes('IDLE_UNEXPECTED_ROUTE'));
  assert.ok(idleCodes(idleRun([idleRow('/api/v1/seputar-jaminan/contacts')])).includes('IDLE_SJ_DATA_POLLING'));
  assert.ok(idleMeasurementIssues('control-reviews',idleRun(rbacRows(),{durationMs:12000})).some(issue=>issue.code==='IDLE_UNEXPECTED_ROUTE'));
});
test('request/completion time bounds, group ordering and finite drain are enforced',()=>{
  const path='/api/v1/notifications/unread-count';
  for(const elapsedMs of [-1,NaN,Infinity,50001])
    assert.ok(idleCodes(idleRun([idleRow(path,{elapsedMs})])).includes('IDLE_REQUEST_TIME_OUT_OF_BOUNDS'));
  for(const completedElapsedMs of [null,NaN,Infinity,999,55001])
    assert.ok(idleCodes(idleRun([idleRow(path,{completedElapsedMs})])).includes('IDLE_COMPLETION_TIME_OUT_OF_BOUNDS'));
  const reversed=rbacRows();reversed[1]=idleRow('/api/v1/menus',{elapsedMs:900,completedElapsedMs:1300});
  assert.ok(idleCodes(idleRun(reversed)).includes('IDLE_RBAC_ORDER_INVALID'));
  for(const changes of [{durationMs:60000},{drainTimeoutMs:6000},{drainMs:5001}])
    assert.ok(idleCodes(idleRun([],changes)).length>0);
  const late=rbacRows().map(row=>({...row,elapsedMs:50010,completedElapsedMs:50020}));
  assert.ok(idleCodes(idleRun(late)).includes('IDLE_REQUEST_TIME_OUT_OF_BOUNDS'),'a new drain-only group is not an in-window refresh');
});

test('menus and role-menu reads must begin after users/me completes, not merely after its request begins',()=>{
  for(const index of [1,2]){
    const rows=rbacRows();rows[index]=idleRow(rows[index].path,{elapsedMs:1050,completedElapsedMs:1300});
    assert.ok(idleCodes(idleRun(rows)).includes('IDLE_RBAC_ORDER_INVALID'));
  }
  const edge=[idleRow('/api/v1/users/me',{elapsedMs:49990,completedElapsedMs:50100}),
    idleRow('/api/v1/menus',{elapsedMs:50020,completedElapsedMs:50120}),
    idleRow('/api/v1/role-menus',{elapsedMs:50100,completedElapsedMs:50120})];
  const codes=idleCodes(idleRun(edge,{drainMs:120}));
  assert.ok(codes.includes('IDLE_RBAC_ORDER_INVALID'));
  assert.ok(codes.includes('IDLE_REQUEST_TIME_OUT_OF_BOUNDS'));
});

test('network ordering is exact even when external requestfinished callback arrives after its follow-up',()=>{
  const rows=rbacRows();rows[0].completedElapsedMs=1301;
  assert.deepEqual(idleMeasurementIssues('bank-contacts',idleRun(rows)),[],'wire completion1100 precedes request1200; callback1301 is only diagnostics');
  rows[1].networkTiming.requestElapsedMs=1099;
  assert.ok(idleCodes(idleRun(rows)).includes('IDLE_RBAC_ORDER_INVALID'),'one millisecond of genuine wire overlap is not tolerated');
});

test('missing, nonfinite, negative or non-monotonic transport timing cannot be replaced with status200',()=>{
  const base=rbacRows()[0].networkTiming;
  for(const networkTiming of [null,undefined,{}, {...base,requestElapsedMs:NaN},{...base,responseEndElapsedMs:Infinity},
    {...base,startElapsedMs:-1},{...base,requestElapsedMs:999},{...base,responseStartElapsedMs:1001,responseEndElapsedMs:1000},
    {...base,responseEndElapsedMs:55001}]){
    const rows=rbacRows();rows[0].networkTiming=networkTiming;
    const codes=idleCodes(idleRun(rows));assert.ok(codes.includes('IDLE_NETWORK_TIMING_UNPROVEN'));
    assert.ok(codes.includes('IDLE_RBAC_ORDER_INVALID'));
  }
  assert.ok(idleCodes(idleRun(rbacRows().map(({networkTiming,...row})=>row))).includes('IDLE_NETWORK_TIMING_UNPROVEN'),'old callback-only evidence remains unproved');
});
test('all idle issues are retained; legacy pathname-only evidence cannot become a retrospective PASS',()=>{
  const rows=[idleRow('/api/v1/seputar-jaminan/contacts',{method:'POST',originVerified:false,status:500,
    failure:'net::ERR_CONNECTION_RESET',finished:false})];
  const run=idleRun(rows,{pending:[0],consoleErrors:[{type:'error'}],pageErrors:[{name:'Error'}]});
  const codes=idleCodes(run);
  for(const code of ['IDLE_CONSOLE_ERROR','IDLE_PAGE_ERROR','IDLE_REQUEST_PENDING','IDLE_METHOD_INVALID',
    'IDLE_ORIGIN_UNPROVEN','IDLE_HTTP_STATUS','IDLE_REQUEST_FAILURE','IDLE_REQUEST_NOT_FINISHED','IDLE_SJ_DATA_POLLING'])
    assert.ok(codes.includes(code),code);
  assert.equal(run.records.length,1,'failure evidence is not deleted');
  assert.ok(idleCodes(idleRun([],{records:undefined,requests:['/api/v1/users/me']})).includes('IDLE_STRUCTURED_RECORDS_MISSING'));
  assert.ok(idleCodes(idleRun(rows,{requests:[]})).includes('IDLE_REQUEST_EVIDENCE_MISMATCH'));
});
test('serialized collector observes bounded edge responses and exports no credential, role ID or arbitrary query',async()=>{
  const {EventEmitter}=require('node:events');
  const roleId='11111111-1111-4111-8111-111111111111',origin='http://127.0.0.1:7111';
  const events=new EventEmitter(),originalNow=Date.now;let now=0,edge=false;
  const request=route=>{let issued=0;return {url:()=>origin+route,method:()=> 'GET',resourceType:()=> 'xhr',failure:()=>null,
    timing:()=>({startTime:issued,requestStart:0,responseStart:Math.max(0,now-issued-1),responseEnd:now-issued}),mark:()=>{issued=now;}};};
  const me=request('/api/v1/users/me'),menus=request('/api/v1/menus'),roles=request('/api/v1/role-menus?role_id='+roleId+'&page=1&limit=100');
  const respond=r=>{events.emit('response',{request:()=>r,status:()=>200});events.emit('requestfinished',r);};
  const page={on:(...args)=>events.on(...args),off:(...args)=>events.off(...args),evaluate:async()=>roleId,
    locator:()=>({first:()=>({waitFor:async()=>{}})}),waitForLoadState:async()=>{},
    waitForTimeout:async delay=>{if(!edge){edge=true;now=49990;me.mark();events.emit('request',me);now=50000;}
      else{now+=delay;if(now===50100){respond(me);menus.mark();roles.mark();events.emit('request',menus);events.emit('request',roles);respond(menus);respond(roles);}}}};
  Date.now=()=>now;
  try{
    // Serialize/evaluate the exact self-contained function used by the CLI.
    const collect=Function('return ('+captureIdleMeasurement.toString()+')')();
    const result=await collect(page,{selector:'table tbody tr',durationMs:50000,expectedOrigin:origin,bankShell:true});
    assert.deepEqual(idleMeasurementIssues('bank-contacts',result),[]);assert.equal(result.records.length,3);
    assert.equal(result.records[2].roleScoped,true);assert.ok(result.records.every(row=>row.queryContractVerified&&row.finished&&row.status===200));
    assert.equal(result.drainMs,400);assert.ok(!JSON.stringify(result).includes(roleId));
    assert.ok(!/private|never-export|role_id|7111/.test(JSON.stringify(result)));
    for(const name of ['request','response','requestfinished','requestfailed','console','pageerror'])assert.equal(events.listenerCount(name),0);
  }finally{Date.now=originalNow;}
});

test('serialized collector rejects extra, duplicated, missing or wrong shell query values without exporting them',async()=>{
  const {EventEmitter}=require('node:events');
  const roleId='11111111-1111-4111-8111-111111111111',origin='http://127.0.0.1:7111';
  const base='/api/v1/role-menus?role_id='+roleId+'&page=1&limit=100';
  const cases=[...['/api/v1/users/me','/api/v1/menus','/api/v1/notifications/unread-count'].map(path=>path+'?private=never-export'),
    base+'&private=never-export',base+'&page=1',base+'&limit=100',base+'&role_id='+roleId,
    base.replace('page=1','page=2'),base.replace('limit=100','limit=25'),
    base.replace('&page=1',''),base.replace('&limit=100',''),base.replace('role_id='+roleId+'&',''),
    base.replace(roleId,'22222222-2222-4222-8222-222222222222')];
  const originalNow=Date.now;let now=0;Date.now=()=>now;
  try{
    const collect=Function('return ('+captureIdleMeasurement.toString()+')')();
    for(const route of cases){
      now=0;const events=new EventEmitter();let emitted=false;
      const request={url:()=>origin+route,method:()=> 'GET',resourceType:()=> 'xhr',failure:()=>null};
      const page={on:(...args)=>events.on(...args),off:(...args)=>events.off(...args),evaluate:async()=>roleId,
        locator:()=>({first:()=>({waitFor:async()=>{}})}),waitForLoadState:async()=>{},waitForTimeout:async delay=>{
          if(!emitted){emitted=true;now=1000;events.emit('request',request);now=1100;
            events.emit('response',{request:()=>request,status:()=>200});events.emit('requestfinished',request);now=50000;}
          else now+=delay;
        }};
      const result=await collect(page,{selector:'table tbody tr',durationMs:50000,expectedOrigin:origin,bankShell:true});
      assert.equal(result.records[0].queryContractVerified,false,route);
      assert.ok(idleCodes(result).includes('IDLE_QUERY_CONTRACT_INVALID'));
      assert.ok(!/private|never-export|role_id|7111|11111111|22222222/.test(JSON.stringify(result)));
      for(const name of ['request','response','requestfinished','requestfailed','console','pageerror'])assert.equal(events.listenerCount(name),0);
    }
  }finally{Date.now=originalNow;}
});

test('prefetch proof exports only a boolean from exact recognized request headers',()=>{
  for(const headers of [{'next-router-prefetch':'1'},{purpose:'prefetch'},{'sec-purpose':'prefetch;prerender'},{Purpose:'Prefetch'}]){
    assert.equal(prefetchedFromHeaders(headers),true);
  }
  for(const headers of [{},{'next-router-prefetch':'0'},{'next-router-prefetch':'true'},{purpose:'not-prefetch'},
    {'sec-purpose':'navigate'},{rsc:'1',cookie:'not-exported'}, {'x-custom-prefetch':'1'}]){
    assert.equal(prefetchedFromHeaders(headers),false);
  }
});

const failure=(changes={})=>({path:'http://127.0.0.1:3111/dashboard/account/security',method:'GET',prefetched:true,
  observedInWindow:true,error:'net::ERR_ABORTED',origin:'http://127.0.0.1:3111',...changes});
test('only a proven same-origin dashboard prefetch aborted within the window is expected',()=>{
  for(const path of ['http://127.0.0.1:3111/dashboard','http://127.0.0.1:3111/dashboard/account/security',
    'http://127.0.0.1:3111/dashboard/informasi-debitur/master-debitur']){
    assert.deepEqual(classifyRequestFailure(failure({path})),{expected:true,reason:'PROVEN_DASHBOARD_PREFETCH_ABORTED'});
  }
});

test('ordinary aborts, missing proof, API/data routes, other origin/method and real network errors remain unexpected',()=>{
  for(const changes of [{prefetched:false},{prefetched:undefined},{method:'POST'},{error:'net::ERR_CONNECTION_RESET'},
    {path:'http://127.0.0.1:3111/api/v1/seputar-jaminan/contacts'},
    {path:'http://127.0.0.1:3111/dashboard/seputar-jaminan/publikasi'},
    {path:'http://127.0.0.1:4320/dashboard'},{path:'http://127.0.0.1:3111/dashboard-other'},
    {path:'invalid-url'},{observedInWindow:undefined}]){
    assert.equal(classifyRequestFailure(failure(changes)).expected,false,JSON.stringify(changes));
  }
});

test('a failure that started before listeners were attached remains explicit and is never inferred to be expected',()=>{
  assert.deepEqual(classifyRequestFailure(failure({observedInWindow:false})),{
    expected:false,reason:'OUTSIDE_MEASUREMENT_WINDOW',
  });
});

const browserRun=changes=>({repetition:1,errors:[],failures:[],pending:[],state:{overflow:false,publicMediaFailures:0,images:[]},
  responses:[],warnings:[],requests:[],...changes});
test('browser issue collection retains unexpected failures while proven prefetch and outside-window records are not charged',()=>{
  const proven={...failure(),...classifyRequestFailure(failure())};
  const outside={...failure({observedInWindow:false}),...classifyRequestFailure(failure({observedInWindow:false}))};
  const ordinary={...failure({prefetched:false}),...classifyRequestFailure(failure({prefetched:false}))};
  const run=browserRun({failures:[proven,outside,ordinary]});
  assert.deepEqual(browserMeasurementIssues('bank-contacts',run),[
    {surface:'bank-contacts',repetition:1,code:'BROWSER_REQUEST_FAILURE',count:1},
  ]);
  assert.equal(run.failures.length,3,'classification must not delete evidence');
  assert.deepEqual(browserMeasurementIssues('bank-contacts',browserRun({failures:[proven,outside]})),[]);
  assert.equal(browserMeasurementIssues('bank-contacts',browserRun({failures:[{error:'net::ERR_ABORTED'}]}))[0].count,1,
    'old evidence without capture flags is not retroactively accepted');
});

test('collection records all independent browser defects instead of stopping at its first error',()=>{
  const run=browserRun({errors:['Error'],pending:[{path:'http://127.0.0.1:4320/api/reviews'}],
    state:{overflow:true,publicMediaFailures:1,images:[{loaded:false}]},responses:[{status:500}],warnings:[{type:'error'}],
    requests:[{path:'http://127.0.0.1:4320/api/reviews'},{path:'http://127.0.0.1:4320/api/reviews'},
      {path:'http://127.0.0.1:4320/api/reviews/test-id'}]});
  assert.deepEqual(browserMeasurementIssues('control-reviews',run).map(issue=>issue.code),[
    'BROWSER_PAGE_ERROR','BROWSER_REQUEST_PENDING','BROWSER_HORIZONTAL_OVERFLOW','BROWSER_PUBLIC_MEDIA_FAILURE',
    'BROWSER_HTTP_ERROR','BROWSER_CONSOLE_ERROR','BROWSER_VISIBLE_IMAGE_NOT_LOADED','BROWSER_LIST_FETCH_COUNT','BROWSER_ROW_REQUEST_FAN_OUT',
  ]);
});

test('public measurements without observed media remain a failed measurement',()=>{
  assert.deepEqual(browserMeasurementIssues('sj-catalog',browserRun()),[
    {surface:'sj-catalog',repetition:1,code:'BROWSER_PUBLIC_MEDIA_NOT_OBSERVED'},
  ]);
});
