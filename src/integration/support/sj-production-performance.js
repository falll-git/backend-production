// Opt-in measurement only on the existing ownership-proved three-UI run.
// No operational env, SQL business-state fixtures, shared cache, or public claims.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {assertContainer}=require('./sj-disposable-guard');
const {safeHarnessError}=require('./sj-harness-error');
const archiveDecisionInput=sourceId=>({kind:'change_request',sourceId,decision:'approve',reason:'Arsip publikasi disposable disetujui setelah pengukuran selesai.'});
exports.archiveDecisionInput=archiveDecisionInput;
const percentile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*q)-1)];
function summary(values){return {samples:values.length,minMs:Math.min(...values),medianMs:percentile(values,.5),p95Ms:percentile(values,.95),maxMs:Math.max(...values)};}
function stats(proof){
  assertContainer(proof,proof.pg);
  const sql=`SELECT COALESCE(json_agg(row_to_json(x)),'[]'::json) FROM (
    SELECT d.datname database,s.userid::text user_id,s.toplevel,s.queryid::text id,s.calls,s.total_exec_time ms,s.rows,
      CASE WHEN ltrim(s.query) LIKE 'SELECT%' THEN 'SELECT' WHEN ltrim(s.query) LIKE 'BEGIN%' THEN 'BEGIN'
        WHEN ltrim(s.query) LIKE 'COMMIT%' THEN 'COMMIT' ELSE 'OTHER' END kind
    FROM pg_stat_statements s JOIN pg_database d ON d.oid=s.dbid
    WHERE d.datname IN ('${proof.database}','ruwang_control_${proof.runId}','sj_central_${proof.runId}')
      AND s.query NOT LIKE '%pg_stat_statements%') x`;
  return JSON.parse(execFileSync('docker',['exec',proof.pg.id,'psql','-U','postgres','-d',proof.database,'-At','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:10000}));
}
function delta(before,after){
  const key=r=>[r.database,r.user_id,r.toplevel,r.id].join(':');
  const prior=new Map(before.map(r=>[key(r),r]));
  const rows=after.map(r=>{const p=prior.get(key(r));return {...r,calls:Number(r.calls)-(Number(p?.calls)||0),ms:Number(r.ms)-(Number(p?.ms)||0),rows:Number(r.rows)-(Number(p?.rows)||0)};}).filter(r=>r.calls>0);
  return {calls:rows.reduce((n,r)=>n+r.calls,0),executionMs:rows.reduce((n,r)=>n+r.ms,0),statements:rows};
}
exports.summary=summary;
exports.delta=delta;
const pollingClass=pathname=>pathname==='/api/v1/notifications/unread-count'?'expected-bank-shell-notifications':
  ['/api/v1/users/me','/api/v1/menus','/api/v1/role-menus'].includes(pathname)?'bank-shell-rbac-candidate':
    pathname.startsWith('/api/v1/seputar-jaminan/')?'sj-data':'unexpected';
exports.pollingClass=pollingClass;
// Classification is not acceptance: require a complete, successful, current-role
// group and bounded timings. Old pathname-only evidence cannot pass this guard.
function idleMeasurementIssues(name,idle){
  const issues=[],bank=name.startsWith('bank-'),records=Array.isArray(idle.records)?idle.records:[];
  const check=(valid,code,details={})=>{if(!valid)issues.push({surface:name,code,...details});};
  const duration=bank?50000:12000,drain=idle.drainTimeoutMs;
  check(idle.durationMs===duration,'IDLE_WINDOW_INVALID');
  check(Number.isFinite(drain)&&drain>=0&&drain<=5000,'IDLE_DRAIN_LIMIT_INVALID');
  check(Number.isFinite(idle.drainMs)&&idle.drainMs>=0&&idle.drainMs<=drain,'IDLE_DRAIN_TIMEOUT');
  check(Array.isArray(idle.records),'IDLE_STRUCTURED_RECORDS_MISSING');
  check(Array.isArray(idle.requests)&&idle.requests.length===records.length&&
    idle.requests.every((value,index)=>value===records[index].path),'IDLE_REQUEST_EVIDENCE_MISMATCH');
  check(Array.isArray(idle.consoleErrors)&&idle.consoleErrors.length===0,'IDLE_CONSOLE_ERROR');
  check(Array.isArray(idle.pageErrors)&&idle.pageErrors.length===0,'IDLE_PAGE_ERROR');
  check(Array.isArray(idle.pending)&&idle.pending.length===0,'IDLE_REQUEST_PENDING');
  if(bank)check(idle.roleContextAvailable===true,'IDLE_ROLE_CONTEXT_MISSING');
  const paths=['/api/v1/users/me','/api/v1/menus','/api/v1/role-menus'];
  const group=paths.map(path=>records.filter(row=>row.path===path));
  const complete=group.every(rows=>rows.length===1),none=group.every(rows=>rows.length===0);
  if(bank)check(none||complete,'IDLE_RBAC_GROUP_INCOMPLETE_OR_REPEATED',{counts:group.map(rows=>rows.length)});
  const notification=records.filter(row=>row.path==='/api/v1/notifications/unread-count');
  check(notification.length<=(bank?2:0),'IDLE_NOTIFICATION_COUNT',{count:notification.length});
  const me=complete?group[0][0]:null;
  const timingProven=row=>Boolean(row?.networkTiming&&
    ['startElapsedMs','requestElapsedMs','responseStartElapsedMs','responseEndElapsedMs'].every(key=>Number.isFinite(row.networkTiming[key]))&&
    row.networkTiming.startElapsedMs>=0&&row.networkTiming.requestElapsedMs>=row.networkTiming.startElapsedMs&&
    row.networkTiming.responseStartElapsedMs>=row.networkTiming.requestElapsedMs&&
    row.networkTiming.responseEndElapsedMs>=row.networkTiming.responseStartElapsedMs&&row.networkTiming.responseEndElapsedMs<=duration+drain);
  for(const [index,row] of records.entries()){
    check(row.method==='GET','IDLE_METHOD_INVALID',{index});
    check(['xhr','fetch'].includes(row.type),'IDLE_RESOURCE_TYPE_INVALID',{index});
    check(row.originVerified===true,'IDLE_ORIGIN_UNPROVEN',{index});
    check(row.queryContractVerified===true,'IDLE_QUERY_CONTRACT_INVALID',{index});
    check(row.status===200,'IDLE_HTTP_STATUS',{index,status:row.status??null});
    check(row.failure===null,'IDLE_REQUEST_FAILURE',{index});
    check(row.finished===true,'IDLE_REQUEST_NOT_FINISHED',{index});
    check(timingProven(row),'IDLE_NETWORK_TIMING_UNPROVEN',{index});
    const kind=pollingClass(row.path);
    check(bank&&['expected-bank-shell-notifications','bank-shell-rbac-candidate'].includes(kind),
      kind==='sj-data'?'IDLE_SJ_DATA_POLLING':'IDLE_UNEXPECTED_ROUTE',{index});
    if(row.path==='/api/v1/role-menus')check(row.roleScoped===true,'IDLE_ROLE_SCOPE_INVALID',{index});
    const inWindow=Number.isFinite(row.elapsedMs)&&row.elapsedMs>=0&&row.elapsedMs<=duration;
    // Only the two follow-up reads of an in-window users/me can begin in drain.
    const followup=bank&&complete&&paths.slice(1).includes(row.path)&&Number.isFinite(me.elapsedMs)&&
      me.elapsedMs>=0&&me.elapsedMs<=duration&&Number.isFinite(row.elapsedMs)&&
      timingProven(me)&&timingProven(row)&&row.networkTiming.requestElapsedMs>=me.networkTiming.responseEndElapsedMs&&row.elapsedMs<=duration+drain;
    check(inWindow||followup,'IDLE_REQUEST_TIME_OUT_OF_BOUNDS',{index});
    check(Number.isFinite(row.completedElapsedMs)&&row.completedElapsedMs>=row.elapsedMs&&
      row.completedElapsedMs<=duration+drain,'IDLE_COMPLETION_TIME_OUT_OF_BOUNDS',{index});
    if(bank&&complete&&paths.slice(1).includes(row.path))
      check(timingProven(me)&&timingProven(row)&&row.networkTiming.requestElapsedMs>=me.networkTiming.responseEndElapsedMs,'IDLE_RBAC_ORDER_INVALID',{index});
  }
  return issues;
}
exports.idleMeasurementIssues=idleMeasurementIssues;

// Self-contained so the same function is serialized to the real browser CLI.
// No token, role ID, query value, origin string or console business text exported.
async function captureIdleMeasurement(page,{selector,durationMs,expectedOrigin,bankShell,drainTimeoutMs=5000}){
  await page.locator(selector).first().waitFor();
  await page.waitForLoadState('networkidle');
  const roleId=bankShell?await page.evaluate(()=>{
    try{
      const raw=sessionStorage.getItem('ruang-arsip.session.user')||localStorage.getItem('ruang-arsip.session.persisted.user');
      const user=JSON.parse(raw||'null');return typeof user?.role_id==='string'&&user.role_id.length>0?user.role_id:null;
    }catch{return null;}
  }):null;
  const requests=[],records=[],consoleErrors=[],pageErrors=[],active=new Map(),started=Date.now();
  let lastEvent=started;
  // External event receipt timestamps are retained, but are not a shared
  // browser network clock. Read completed request.timing() for cross-request
  // ordering, without tolerance, body interception or an HTTP-200 fallback.
  const networkTiming=request=>{
    try{
      const t=request.timing();
      if(!t||!['startTime','requestStart','responseStart','responseEnd'].every(key=>Number.isFinite(t[key])&&t[key]>=0)||
        t.requestStart>t.responseStart||t.responseStart>t.responseEnd)return null;
      const origin=t.startTime-started;
      return {startElapsedMs:origin,requestElapsedMs:origin+t.requestStart,
        responseStartElapsedMs:origin+t.responseStart,responseEndElapsedMs:origin+t.responseEnd};
    }catch{return null;}
  };
  const onRequest=request=>{
    const type=request.resourceType();if(!['xhr','fetch'].includes(type))return;
    const url=new URL(request.url()),elapsedMs=Date.now()-started;
    const roleMenu=url.pathname==='/api/v1/role-menus';
    const roleScoped=roleMenu?Boolean(roleId&&url.searchParams.getAll('role_id').length===1&&url.searchParams.get('role_id')===roleId):null;
    // The actual shell has no query on the other three reads. This fixture's
    // single role-menu page uses exactly page=1, limit=100 and its current role.
    const queryContractVerified=roleMenu?roleScoped&&url.searchParams.size===3&&
      url.searchParams.getAll('page').length===1&&url.searchParams.get('page')==='1'&&
      url.searchParams.getAll('limit').length===1&&url.searchParams.get('limit')==='100':
      ['/api/v1/users/me','/api/v1/menus','/api/v1/notifications/unread-count'].includes(url.pathname)&&url.search==='';
    const row={path:url.pathname.replace(/\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}(?=\/|$)/gi,'/:id'),
      method:request.method(),type,elapsedMs,originVerified:url.origin===expectedOrigin&&!url.username&&!url.password,
      roleScoped,queryContractVerified,
      status:null,failure:null,finished:false,completedElapsedMs:null,networkTiming:null};
    requests.push(row.path);records.push(row);active.set(request,row);lastEvent=Date.now();
  };
  const onResponse=response=>{const row=active.get(response.request());if(row){row.status=response.status();lastEvent=Date.now();}};
  const onFinished=request=>{const row=active.get(request);if(row){row.finished=true;row.completedElapsedMs=Date.now()-started;row.networkTiming=networkTiming(request);active.delete(request);lastEvent=Date.now();}};
  const onFailed=request=>{const row=active.get(request);if(row){const value=request.failure()?.errorText;
    row.failure=typeof value==='string'&&/^net::ERR_[A-Z0-9_]+$/.test(value)?value:'REQUEST_FAILED';
    row.completedElapsedMs=Date.now()-started;active.delete(request);lastEvent=Date.now();}};
  const onConsole=message=>{if(message.type()==='error')consoleErrors.push({type:'error'});};
  const onError=error=>pageErrors.push({name:typeof error.name==='string'&&/^[A-Za-z]{1,40}$/.test(error.name)?error.name:'Error'});
  page.on('request',onRequest);page.on('response',onResponse);page.on('requestfinished',onFinished);
  page.on('requestfailed',onFailed);page.on('console',onConsole);page.on('pageerror',onError);
  try{
    await page.waitForTimeout(durationMs);
    const drainStarted=Date.now(),deadline=drainStarted+drainTimeoutMs;
    while(Date.now()<deadline){
      if(active.size===0&&Date.now()-lastEvent>=250)break;
      await page.waitForTimeout(Math.min(100,Math.max(0,deadline-Date.now())));
    }
    return {durationMs,drainTimeoutMs,drainMs:Date.now()-drainStarted,roleContextAvailable:bankShell?Boolean(roleId):null,
      requests,records,consoleErrors,pageErrors,pending:[...active.values()].map(row=>records.indexOf(row))};
  }finally{
    page.off('request',onRequest);page.off('response',onResponse);page.off('requestfinished',onFinished);
    page.off('requestfailed',onFailed);page.off('console',onConsole);page.off('pageerror',onError);
  }
}
exports.captureIdleMeasurement=captureIdleMeasurement;
// Session-window aggregation matches the installed web-vitals reference.
// The browser supplies only unexpected shifts; retain those numeric entries
// alongside this bounded lab value so the aggregation can be audited.
function clsSessionScore(shifts){
  let maximum=0,value=0,first=0,last=0;
  for(const shift of shifts){
    if(value>0&&shift.time-last<1000&&shift.time-first<5000)value+=shift.value;
    else{value=shift.value;first=shift.time;}
    last=shift.time;maximum=Math.max(maximum,value);
  }
  return maximum;
}
exports.clsSessionScore=clsSessionScore;
// Privacy-bounded attribution. No text, IDs, attributes, URLs or layout reads.
function layoutShiftRecord(entry){
  const knownClasses=new Set(['page-header__actions','setup-responsive-table','setup-table-scroll','dashboard-modal__body']);
  const rect=value=>value&&['x','y','width','height'].every(key=>Number.isFinite(value[key]))
    ? Object.fromEntries(['x','y','width','height'].map(key=>[key,value[key]])):null;
  const sources=Array.from(entry.sources||[]);
  return {value:entry.value,time:entry.startTime,sourcesTruncated:sources.length>5,sources:sources.slice(0,5).map(source=>{
    const node=source.node,tag=node?.tagName;
    return {tag:typeof tag==='string'&&/^[A-Z][A-Z0-9-]{0,31}$/.test(tag)?tag:null,
      nodeType:[1,3].includes(node?.nodeType)?node.nodeType:null,
      classes:typeof node?.className==='string'?node.className.split(/\s+/).filter(value=>knownClasses.has(value)):[],
      before:rect(source.previousRect),after:rect(source.currentRect)};
  })};
}
exports.layoutShiftRecord=layoutShiftRecord;
function prefetchedFromHeaders(headers){
  const values=Object.fromEntries(Object.entries(headers).map(([key,value])=>[key.toLowerCase(),value]));
  return values['next-router-prefetch']==='1'||['purpose','sec-purpose'].some(key=>
    typeof values[key]==='string'&&values[key].toLowerCase().split(';').some(token=>token.trim()==='prefetch'));
}
function classifyRequestFailure({path,method,prefetched,observedInWindow,error,origin}){
  if(observedInWindow===false)return {expected:false,reason:'OUTSIDE_MEASUREMENT_WINDOW'};
  if(error!=='net::ERR_ABORTED')return {expected:false,reason:'NETWORK_FAILURE'};
  if(prefetched!==true)return {expected:false,reason:'PREFETCH_NOT_PROVEN'};
  if(method!=='GET')return {expected:false,reason:'NOT_PREFETCH_GET'};
  let url;try{url=new URL(path);}catch{return {expected:false,reason:'INVALID_REQUEST_URL'};}
  const dashboard=url.pathname==='/dashboard'||url.pathname.startsWith('/dashboard/');
  const sj=url.pathname==='/dashboard/seputar-jaminan'||url.pathname.startsWith('/dashboard/seputar-jaminan/');
  const controlNavigation=['/monitoring/pengiriman','/monitoring/pemrosesan'].includes(url.pathname);
  if(url.origin!==origin||(!dashboard&&!controlNavigation)||sj)return {expected:false,reason:'NOT_EXPECTED_PREFETCH_ROUTE'};
  if(observedInWindow!==true)return {expected:false,reason:'MEASUREMENT_WINDOW_NOT_PROVEN'};
  return {expected:true,reason:controlNavigation?'PROVEN_CONTROL_NAVIGATION_PREFETCH_ABORTED':'PROVEN_DASHBOARD_PREFETCH_ABORTED'};
}
function browserMeasurementIssues(name,run){
  const issues=[],check=(pass,code,details={})=>{if(!pass)issues.push({surface:name,repetition:run.repetition,code,...details});};
  check(run.errors.length===0,'BROWSER_PAGE_ERROR',{count:run.errors.length});
  const unexpected=run.failures.filter(f=>f.observedInWindow!==false&&!f.expected);
  check(unexpected.length===0,'BROWSER_REQUEST_FAILURE',{count:unexpected.length});
  check(run.pending.length===0,'BROWSER_REQUEST_PENDING',{count:run.pending.length});
  check(run.state.overflow===false,'BROWSER_HORIZONTAL_OVERFLOW');
  check(run.state.publicMediaFailures===0,'BROWSER_PUBLIC_MEDIA_FAILURE',{count:run.state.publicMediaFailures});
  const httpErrors=run.responses.filter(r=>r.status>=400);
  check(httpErrors.length===0,'BROWSER_HTTP_ERROR',{count:httpErrors.length});
  const consoleErrors=run.warnings.filter(r=>r.type==='error');
  check(consoleErrors.length===0,'BROWSER_CONSOLE_ERROR',{count:consoleErrors.length});
  check(run.state.images.every(i=>i.loaded),'BROWSER_VISIBLE_IMAGE_NOT_LOADED');
  if(name.startsWith('sj-'))check(run.state.images.length>0,'BROWSER_PUBLIC_MEDIA_NOT_OBSERVED');
  if(name.startsWith('control-')){
    const list=run.requests.filter(r=>r.path.includes('/api/reviews')&&!/\/api\/reviews\//.test(r.path)).length;
    const perRow=run.requests.filter(r=>/\/api\/(?:reviews\/[^/]+|instances\/[^/]+\/reviews\/[^/]+)/.test(r.path)).length;
    check(list===1,'BROWSER_LIST_FETCH_COUNT',{count:list});
    check(perRow===0,'BROWSER_ROW_REQUEST_FAN_OUT',{count:perRow});
  }
  return issues;
}
exports.prefetchedFromHeaders=prefetchedFromHeaders;
exports.classifyRequestFailure=classifyRequestFailure;
exports.browserMeasurementIssues=browserMeasurementIssues;
// Serialized into the same browser-CLI collector. Navigation response events
// provide metadata only: body() can race a previous document being discarded,
// and Chromium's body retrieval may itself fetch a resource again. Resource
// Timing is captured separately and actual media bytes/cache/dimensions still
// require the explicit authenticated/public media probes below. Null is not
// a zero-byte measurement or proof of transport/media success.
function navigationResponseMetadata(response,key,observedInWindow){
  return {path:key(response.url()),status:response.status(),type:response.request().resourceType(),
    cache:response.headers()['cache-control']||null,mime:response.headers()['content-type']||null,
    observedInWindow:observedInWindow===true};
}
exports.navigationResponseMetadata=navigationResponseMetadata;
exports.run=async({proof,cross,out,cli,code,bankUi,publicUi,controlOrigin,publicApiOrigin,publications,httpApi,cycle,rpc,upload,renewHttpActors})=>{
  assert.equal(cross.performance,true);assertContainer(proof,proof.pg);assertContainer(proof,proof.redis);
  const result={at:new Date().toISOString(),runId:proof.runId,pass:false,
    scope:'Real production Next builds + actual owned bank/Control/SJ APIs. Local loopback, no CDN/VPS; API fixture config and runtime roles recorded by parent.',
    finalPerformanceGateEligible:cross.catalogCancelDiagnostic!==true,
    dataset:{categories:4,publications:publications.length,contactsCreated:32,longLabels:0,media:'1920x1080 high-entropy synthetic JPEG source; real scanner and delivery transforms'},
    browser:[],api:[],idle:[],media:[],pagination:[],uiProbes:null,measurementIssues:[],limitations:['Warm repeated browser navigations; no cold-cache/CDN claim. Bounded local sample; no capacity/SLA claim. 32 public assets, not 100 populated rows. PG deltas include all owned DB activity within each window, not route-exclusive traces. Observer is a diagnostic, not runtime elevated role. No source SQL/parameters exported. Request failures begun outside a measurement window remain recorded but are not charged to that window; no retrospective prefetch inference.']};
  const save=()=>fs.writeFileSync(path.join(out,'performance.json'),JSON.stringify(result,null,2));
  const stage=value=>{result.activeStage=value;result.lastProgressAt=new Date().toISOString();save();};
  stage('fixture-preparation');
  const contacts=[];
  for(let i=0;i<32;i++){
    const label=('Kontak pengukuran '+String(i).padStart(2,'0')+' '+(i%3===0?'nama panjang untuk pemeriksaan daftar dan pemulihan konteks':'tes')).slice(0,80);
    let contact=await httpApi('maker','post','/contacts',{label,phone_e164:'+62877000'+String(i).padStart(4,'0')},201);
    if(i%8!==0)contact=await httpApi('maker','post','/contacts/'+contact.id+'/submit',{expected_version:contact.lock_version});
    contacts.push(contact);if(label.length>60)result.dataset.longLabels++;
  }
  await cycle();save();
  // Collateral records are isolated source prerequisites only. Every SJ draft,
  // submission, decision and publication still passes actual API/worker logic.
  assert.equal(cross.performanceCollateralIds.length,28);
  const extra=[],extraMedia=[],taxonomy=await httpApi('maker','get','/taxonomy'),profile=await httpApi('maker','get','/profile');
  for(let i=0;i<28;i++){
    const base=await httpApi('maker','get','/publications/'+publications[i%4].id),v=base.published_version;
    assert.ok(v&&v.whatsapp_contact&&v.media.length);
    // SJ media are bound to sourcePublicationId. A new publication must have
    // its own upload/ingest, even when synthetic source pixels are identical.
    const photo=await upload('PUBLICATION_IMAGE');extraMedia.push(photo);
    const draft={source_type:'COLLATERAL',source_collateral_id:cross.performanceCollateralIds[i],asset_category:base.asset_category,
      taxonomy_item_id:taxonomy.categories.find(c=>c.code===base.asset_category).items[0].id,
      title:('Aset pengukuran '+String(i).padStart(2,'0')+' '+base.asset_category+' — data panjang untuk menguji kartu dan daftar tanpa kehilangan konteks').slice(0,160),
      description:v.description,city_regency:v.city_regency,province:v.province,
      whatsapp_contact_version_id:v.whatsapp_contact.version_id,profile_version_id:profile.current_version_id,attributes:v.attributes,
      media:[{media_asset_id:photo.id,sort_order:0,is_cover:true,alt_text:'Foto pengukuran disposable'}]};
    let created=await httpApi('maker','post','/publications',draft,201);
    extra.push(created);
  }
  assert.equal(new Set(extraMedia.map(m=>m.id)).size,28,'distinct upload per extra publication');
  await cycle();await cycle();
  for(const photo of extraMedia)assert.equal((await httpApi('maker','get','/media/'+photo.id+'/status')).state,'READY','actual scanner/ingest readiness');
  for(let i=0;i<extra.length;i++)extra[i]=await httpApi('maker','post','/publications/'+extra[i].id+'/submit',{expected_version:extra[i].lock_version});
  await cycle();await cycle();
  for(const item of extra)await rpc('decide',{kind:'publication',sourceId:item.id,decision:'approve'});
  await cycle();await cycle();
  for(const item of extra){const current=await httpApi('maker','get','/publications/'+item.id);if(current.sync_state!=='ACKNOWLEDGED'){result.fixtureFailure={state:current.sync_state,errorCode:current.last_sync_error_code};save();}assert.equal(current.sync_state,'ACKNOWLEDGED');}
  result.dataset.publications+=extra.length;result.dataset.distinctPublicationUploads=32;result.dataset.sourceMediaBytes=(await httpApi('maker','get','/publications/'+publications[3].id)).published_version.media.map(m=>m.size_bytes);save();
  // Install once per browser context, reset once per real navigation. Do not
  // accumulate observers across repetitions or replace errors with empty data.
  await code(`async(page)=>{await page.context().addInitScript(()=>{const layoutShiftRecord=${layoutShiftRecord.toString()};window.__sjPerf={shifts:[]};new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.__sjPerf.shifts.push(layoutShiftRecord(e));}).observe({type:'layout-shift',buffered:true});});return JSON.stringify({installed:true});}`);
  const routes=[
    {tab:0,name:'bank-contacts',url:bankUi+'/dashboard/seputar-jaminan/kontak',selector:'table tbody tr'},
    {tab:0,name:'bank-publications',url:bankUi+'/dashboard/seputar-jaminan/publikasi',selector:'table tbody tr'},
    {tab:1,name:'control-reviews',url:controlOrigin+'/reviews?state=all&limit=25',selector:'table tbody tr'},
    {tab:1,name:'control-monitoring',url:controlOrigin+'/monitoring?state=all&limit=25',selector:'table tbody tr'},
    {tab:2,name:'sj-catalog',url:publicUi+'/katalog',selector:'[data-asset-card]'},
    {tab:2,name:'sj-detail',url:publicUi+'/aset/'+publications[3].reference_code,selector:'h1'},
    {tab:2,name:'sj-home',url:publicUi+'/',selector:'[data-home-section="latest"] [data-asset-card]'},
  ];
  for(const target of routes){
    stage('browser-'+target.name);
    await cli('tab-select',String(target.tab));await cli('goto',target.url);await cli('snapshot');
    const before=stats(proof);
    const measured=await code(`async(page)=>{const runs=[];for(let i=0;i<5;i++){
      const requests=[],responses=[],failures=[],errors=[],warnings=[],media=[],active=new Map(),observedRequests=new WeakSet();
      const prefetchedFromHeaders=${prefetchedFromHeaders.toString()},classifyRequestFailure=${classifyRequestFailure.toString()};
      const navigationResponseMetadata=${navigationResponseMetadata.toString()};
      const key=u=>{const p=new URL(u),v=p.searchParams.get('variant');return p.origin+p.pathname+(['thumbnail','card','thumb'].includes(v)?'?variant='+v:'');};
      const requestRow=r=>({path:key(r.url()),method:r.method(),type:r.resourceType(),prefetched:prefetchedFromHeaders(r.headers()),started:Date.now()});
      const onReq=r=>{const row=requestRow(r);requests.push(row);active.set(r,row);observedRequests.add(r);};
      const done=r=>active.delete(r),fail=r=>{const observedInWindow=active.has(r),{started,...row}=active.get(r)||requestRow(r),error=r.failure()?.errorText;
        failures.push({...row,error,observedInWindow,...classifyRequestFailure({...row,error,observedInWindow,origin:${JSON.stringify(new URL(target.url).origin)}})});done(r);};
      const onResp=r=>{const row=navigationResponseMetadata(r,key,observedRequests.has(r.request()));responses.push(row);if(row.type==='image')media.push({...row,bytes:null,byteSource:'NOT_READ_BY_NAVIGATION_OBSERVER'});};
      const onErr=e=>errors.push(e.name);const onConsole=m=>{if(['warning','error'].includes(m.type()))warnings.push({type:m.type(),preload:m.text().includes('preload'),preloadPaths:m.text().includes('preload')?m.text().split(' ').flatMap(word=>{let candidate=word;while([34,39,41,46,44].includes(candidate.charCodeAt(candidate.length-1)))candidate=candidate.slice(0,-1);try{return candidate.startsWith('http')?[new URL(candidate).pathname]:[];}catch{return [];}}):[]});};
      page.on('request',onReq);page.on('requestfinished',done);page.on('requestfailed',fail);page.on('response',onResp);page.on('pageerror',onErr);page.on('console',onConsole);
      try{const started=Date.now();await page.setViewportSize({width:1440,height:900});await page.goto(${JSON.stringify(target.url)},{waitUntil:'domcontentloaded'});await page.locator(${JSON.stringify(target.selector)}).first().waitFor({timeout:30000});
        await page.evaluate(()=>document.fonts.ready);await page.waitForLoadState('networkidle',{timeout:15000});
        const state=await page.evaluate(()=>{const clsSessionScore=${clsSessionScore.toString()},shifts=window.__sjPerf?.shifts||[];const visible=el=>{const b=el.getBoundingClientRect();return b.width>0&&b.height>0&&b.right>0&&b.left<innerWidth&&b.bottom>0&&b.top<innerHeight&&getComputedStyle(el).visibility!=='hidden';};const n=performance.getEntriesByType('navigation')[0];return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,cls:clsSessionScore(shifts),shifts,ttfbMs:n.responseStart-n.requestStart,domMs:n.domContentLoadedEventEnd,resources:performance.getEntriesByType('resource').map(r=>({path:new URL(r.name).pathname,type:r.initiatorType,transferBytes:r.transferSize,encodedBytes:r.encodedBodySize,decodedBytes:r.decodedBodySize,durationMs:r.duration})),publicMediaFailures:[...document.querySelectorAll('[data-media-state]')].filter(el=>visible(el)&&!['loading','ready'].includes(el.dataset.mediaState)).length,images:[...document.images].filter(visible).map(img=>({path:new URL(img.currentSrc||img.src,location.href).pathname,variant:new URL(img.currentSrc||img.src,location.href).searchParams.get('variant')||'main',loaded:img.complete&&img.naturalWidth>0,displayWidth:Math.round(img.getBoundingClientRect().width),naturalWidth:img.naturalWidth}))};});
        const settledMs=Date.now()-started;
        if(i===4)await page.screenshot({path:${JSON.stringify(path.join(out,target.name+'-performance.png').split(path.sep).join('/'))},fullPage:true});
        runs.push({repetition:i+1,settledMs,state,media,requests:requests.map(({started,...r})=>r),responses,failures,errors,warnings,pending:[...active.values()].map(({started,...r})=>r)});
      }finally{page.off('request',onReq);page.off('requestfinished',done);page.off('requestfailed',fail);page.off('response',onResp);page.off('pageerror',onErr);page.off('console',onConsole);}
    }return JSON.stringify(runs);}`);
    result.browser.push({name:target.name,url:target.url,runs:measured,settled:summary(measured.map(r=>r.settledMs)),sql:delta(before,stats(proof))});
    for(const run of measured)result.measurementIssues.push(...browserMeasurementIssues(target.name,run));
    save();
  }
  // API sample distributions and SQL deltas with finite local concurrency.
  const controlGet=async url=>{await cli('tab-select','1');return code(`async(page)=>{const r=await page.request.get(${JSON.stringify(controlOrigin+url)});const data=await r.json();return JSON.stringify({status:r.status(),bytes:(await r.body()).length,cache:r.headers()['cache-control']||null,data:data.data});}`);};
  const publicGet=async url=>{await cli('tab-select','2');return code(`async(page)=>{const r=await page.request.get(${JSON.stringify(publicApiOrigin+url)});return JSON.stringify({status:r.status(),bytes:(await r.body()).length,cache:r.headers()['cache-control']||null,data:await r.json()});}`);};
  stage('bank-api-workloads');
  for(const [name,call] of [
    ['bank-contacts-10',()=>httpApi('maker','get','/contacts?paged=true&limit=10')],
    ['bank-contacts-50',()=>httpApi('maker','get','/contacts?paged=true&limit=50')],
  ]){
    const times=[],counts=[],concurrent=[],before=stats(proof);const once=async()=>{const t=performance.now();const data=await call();assert.ok(data.items.length>0);return {ms:performance.now()-t,count:data.items.length};};for(let i=0;i<10;i++){const s=await once();times.push(s.ms);counts.push(s.count);}for(let i=0;i<5;i++)concurrent.push(...await Promise.all(Array.from({length:4},once)));
    result.api.push({name,sequential:summary(times),returnedCounts:counts,concurrent:summary(concurrent.map(s=>s.ms)),concurrency:4,sql:delta(before,stats(proof))});save();
  }
  // Browser command overhead is deliberately excluded from HTTP latency.
  for(const [name,tab,origin,route] of [['control-list-10',1,controlOrigin,'/api/reviews?group=content&state=all&page=1&limit=10'],['control-list-50',1,controlOrigin,'/api/reviews?group=content&state=all&page=1&limit=50'],['sj-assets-1',2,publicApiOrigin,'/v1/public/assets?limit=1'],['sj-assets-100',2,publicApiOrigin,'/v1/public/assets?limit=100'],['sj-showcase',2,publicApiOrigin,'/v1/public/showcase']]){
    stage('api-'+name);
    await cli('tab-select',String(tab));const before=stats(proof);
    const samples=await code(`async(page)=>{const get=async()=>{const t=Date.now(),r=await page.request.get(${JSON.stringify(origin+route)}),body=await r.body();const data=JSON.parse(body.toString());return {ms:Date.now()-t,status:r.status(),bytes:body.length,returnedCount:(data.data||data).items?.length,cache:r.headers()['cache-control']||null};};const sequential=[];for(let i=0;i<10;i++)sequential.push(await get());const concurrent=[];for(let i=0;i<5;i++)concurrent.push(...await Promise.all(Array.from({length:4},get)));return JSON.stringify({sequential,concurrent});}`);
    result.api.push({name,...samples,sequentialSummary:summary(samples.sequential.map(s=>s.ms)),concurrentSummary:summary(samples.concurrent.map(s=>s.ms)),sql:delta(before,stats(proof)),concurrency:4});save();
    assert.ok([...samples.sequential,...samples.concurrent].every(s=>s.status===200),'bounded API read workload must succeed');
  }
  stage('pagination-bank');
  const bankFirst=await httpApi('maker','get','/contacts?paged=true&limit=10');assert.ok(bankFirst.page_info.next_cursor);
  const bankSecond=await httpApi('maker','get','/contacts?paged=true&limit=10&cursor='+encodeURIComponent(bankFirst.page_info.next_cursor));
  assert.ok(!bankFirst.items.some(a=>bankSecond.items.some(b=>a.id===b.id)));result.pagination.push({name:'bank-contacts',page1:bankFirst.items.length,page2:bankSecond.items.length,duplicates:0});
  stage('pagination-control');
  const c1=await controlGet('/api/reviews?group=content&state=all&page=1&limit=10'),c2=await controlGet('/api/reviews?group=content&state=all&page=2&limit=10');
  assert.equal(c1.status,200);assert.equal(c2.status,200);assert.equal(c1.data.items.length,10);assert.equal(c2.data.items.length,10);assert.ok(c1.data.count.value>10);assert.ok(!c1.data.items.some(a=>c2.data.items.some(b=>a.id===b.id)));assert.equal(c1.data.count.value,c2.data.count.value);result.pagination.push({name:'control',page1:c1.data.items.length,page2:c2.data.items.length,count:c1.data.count.value,duplicates:0});
  const p1=await publicGet('/v1/public/assets?limit=1');assert.ok(p1.data.next_cursor);const p2=await publicGet('/v1/public/assets?limit=1&cursor='+encodeURIComponent(p1.data.next_cursor));
  assert.equal(p2.status,200);assert.equal(p2.data.items.length,1);assert.notEqual(p1.data.items[0].reference_code,p2.data.items[0].reference_code);result.pagination.push({name:'sj',page1:1,page2:1,duplicates:0});save();
  for(const target of [routes[0],routes[1],routes[2],routes[3],routes[4]]){
    stage('idle-'+target.name);
    await cli('tab-select',String(target.tab));await cli('goto',target.url);await cli('snapshot');const before=stats(proof);
    const durationMs=target.tab===0?50000:12000;
    const options={selector:target.selector,durationMs,bankShell:target.tab===0,
      expectedOrigin:target.tab===0?'http://127.0.0.1:7111':new URL(target.url).origin,drainTimeoutMs:5000};
    const idle=await code(`async(page)=>{const captureIdleMeasurement=${captureIdleMeasurement.toString()};return JSON.stringify(await captureIdleMeasurement(page,${JSON.stringify(options)}));}`);
    const classified=idle.requests.map(path=>({path,kind:target.tab===0?pollingClass(path):'unexpected'}));
    const issues=idleMeasurementIssues(target.name,idle);
    result.idle.push({name:target.name,...idle,classified,issues,sql:delta(before,stats(proof))});
    result.measurementIssues.push(...issues);save();
  }
  // Measure the distinct public transfer, not assume bank thumbnail == SJ media.
  const asset=await publicGet('/v1/public/assets/'+publications[3].reference_code);assert.equal(asset.status,200);
  await cli('tab-select','2');
  stage('public-media');
  for(const item of asset.data.media){
    const u=new URL(item.url);assert.equal(u.origin,publicApiOrigin);
    for(const variant of ['main','card','thumb']){
      const mediaUrl=new URL(u);if(variant!=='main')mediaUrl.searchParams.set('variant',variant);
      const measured=await code(`async(page)=>{const rows=[];let firstBody;for(let i=0;i<3;i++){const started=Date.now(),r=await page.request.get(${JSON.stringify(mediaUrl.href)}),body=await r.body();firstBody??=body;rows.push({ms:Date.now()-started,status:r.status(),bytes:body.length,mime:r.headers()['content-type'],cache:r.headers()['cache-control']||null});}const dimensions=await page.evaluate(async bytes=>{const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/webp'}));const size={width:image.width,height:image.height};image.close();return size;},Array.from(firstBody));return JSON.stringify({rows,dimensions});}`);
      result.media.push({kind:'SJ-delivery',variant,...measured.dimensions,samples:measured.rows});save();assert.ok(measured.rows.every(r=>r.status===200&&r.mime==='image/webp'&&r.cache==='no-store'));if(variant!=='main')assert.ok(measured.dimensions.width<=(variant==='thumb'?320:960));
    }
  }
  // The private Control proxy owns an existing thumbnail contract. Compare
  // against original without copying credentials/cookies or weakening access.
  await cli('tab-select','1');const review=await rpc('prepare-review',{kind:'publication',sourceId:publications[3].id});
  const matched=await controlGet('/api/reviews?group=content&state=all&q='+encodeURIComponent(publications[3].reference_code)+'&limit=10');assert.equal(matched.status,200);
  const instanceId=matched.data.items.find(item=>item.id===review.reviewId)?.instanceId;assert.ok(instanceId,'media target identity from scoped server list');
  const detail=await controlGet('/api/instances/'+instanceId+'/reviews/'+review.reviewId);
  assert.equal(detail.status,200);assert.ok(detail.data.detail.media.length);
  const mediaPath='/api/instances/'+instanceId+'/reviews/'+review.reviewId+'/media/'+detail.data.detail.media[0].source_media_id;
  stage('control-private-media');
  for(const variant of ['original','thumbnail']){
    const url=controlOrigin+mediaPath+(variant==='thumbnail'?'?variant=thumbnail':'');
    const measured=await code(`async(page)=>{const rows=[];for(let i=0;i<3;i++){const started=Date.now(),r=await page.request.get(${JSON.stringify(url)});rows.push({ms:Date.now()-started,status:r.status(),bytes:(await r.body()).length,mime:r.headers()['content-type'],cache:r.headers()['cache-control']||null});}const anonymous=await page.context().browser().newContext();let denied;try{denied=(await anonymous.request.get(${JSON.stringify(url)})).status();}finally{await anonymous.close();}return JSON.stringify({rows,anonymousStatus:denied});}`);
    result.media.push({kind:'Control-private',variant,samples:measured.rows,anonymousStatus:measured.anonymousStatus});save();assert.ok(measured.rows.every(r=>r.status===200&&r.cache==='private, no-store, max-age=0'));assert.equal(measured.anonymousStatus,401);
  }
  stage('ui-probes');
  result.uiProbes=await require('./sj-performance-ui-probes').run({out,cli,code,bankUi,publicUi,controlOrigin});
  result.measurementIssues.push(...result.uiProbes.issues.map(issue=>({surface:issue.probe,code:issue.code,action:issue.action})));save();
  stage('repeated-catalog-transport');
  result.catalogTransportRepeats=await require('./sj-performance-ui-probes').runCatalogTransportRepeats({out,cli,code,publicUi});
  result.measurementIssues.push(...result.catalogTransportRepeats.issues.map(issue=>({surface:'repeated-catalog-transport',code:issue.code,action:issue.action,repetition:issue.repetition})));save();
  if(cross.catalogCancelDiagnostic===true){
    stage('separate-catalog-cancellation-diagnostic');
    result.limitations.push('Opt-in SJ server stream instrumentation is active; this run is diagnostic, not an uninstrumented final performance gate. Native browser wrappers are installed only after all eighteen measured probes and restored before fixture archive.');
    try{result.catalogCancellationDiagnostic=await require('./sj-performance-ui-probes').runCatalogCancellationDiagnostic({out,cli,code,publicUi});}
    catch(error){result.catalogCancellationDiagnostic={failure:safeHarnessError(error),mode:'separate instrumented reproduction, incomplete'};result.measurementIssues.push({surface:'catalog-cancellation-diagnostic',code:'DIAGNOSTIC_NOT_COMPLETED'});}
    save();
  }
  // Release shared contact/media dependencies through legitimate lifecycle so
  // the parent can finish its original revoke/hide journey without state SQL.
  const archives=[];
  result.fixtureArchive={expected:28,submitted:0,decisions:0,verified:0,stage:'renew-actors'};
  stage('lawful-fixture-archive');
  const archiveProgress=value=>{result.fixtureArchive.stage=value;result.fixtureArchive.lastProgressAt=new Date().toISOString();save();};
  try{
    assert.equal(extra.length,result.fixtureArchive.expected,'exact owned extra publication archive count');
    assert.equal(typeof renewHttpActors,'function','explicit owned API fixture renewal is required after the long read-only measurement phase');
    result.fixtureRenewalBeforeLifecycle=await renewHttpActors('before-lawful-performance-cleanup');save();
    result.fixtureControlSessionRenewal=await rpc('renew-performance-session',{reason:'before-lawful-performance-cleanup'});
    assert.equal(result.fixtureControlSessionRenewal.authenticated,true);
    assert.equal(result.fixtureControlSessionRenewal.sameOperator,true);
    assert.equal(result.fixtureControlSessionRenewal.retiredSessionRejected,true);
    assert.equal(result.fixtureControlSessionRenewal.sessionPolicyChanged,false);save();
    archiveProgress('submit');
    for(const item of extra){const current=await httpApi('maker','get','/publications/'+item.id);archives.push(await httpApi('maker','post','/publications/'+item.id+'/change-requests',{action:'ARCHIVE_PUBLICATION',expected_version:current.lock_version,reason:'Pengukuran disposable selesai; arsipkan publikasi tes.'},201));result.fixtureArchive.submitted++;archiveProgress('submit');}
    archiveProgress('cycle-before-decisions-1');await cycle();
    archiveProgress('cycle-before-decisions-2');await cycle();
    archiveProgress('decision');
    for(const item of archives){await rpc('decide',archiveDecisionInput(item.id));result.fixtureArchive.decisions++;archiveProgress('decision');}
    archiveProgress('cycle-after-decisions-1');await cycle();
    archiveProgress('cycle-after-decisions-2');await cycle();
    archiveProgress('verify');
    for(const item of extra){const current=await httpApi('maker','get','/publications/'+item.id);assert.equal(current.state,'ARCHIVED');assert.equal(current.sync_state,'ACKNOWLEDGED');result.fixtureArchive.verified++;archiveProgress('verify');}
    archiveProgress('complete');
  }catch(error){
    result.fixtureArchive.failure=safeHarnessError(error);
    try{save();}catch{if(error&&typeof error==='object')error.harnessDiagnosticWriteFailed=true;}
    throw error;
  }
  result.dataset.extraPublicationLifecycleCleanup=extra.length;
  save();
  assert.deepEqual(result.measurementIssues,[],'measured browser and UI issues remain failures after all diagnostics and legitimate fixture lifecycle cleanup');
  assert.equal(result.finalPerformanceGateEligible,true,'instrumented diagnostic runs are not eligible for the final uninstrumented performance gate');
  result.pass=true;result.finishedAt=new Date().toISOString();stage('complete');return {check:'bounded production-UI performance + actual paginated API/SQL/media measurements',pass:true,evidence:path.join(out,'performance.json'),browserSurfaces:result.browser.length,dataset:result.dataset};
};
