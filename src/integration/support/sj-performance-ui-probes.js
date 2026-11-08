'use strict';

// Opt-in read-only browser diagnostics. The parent must first prove ownership
// of the disposable three-UI run and authenticate these tabs through real UI.
// This helper neither creates a browser nor supplies credentials or test data.
const fs = require('node:fs');
const path = require('node:path');
const {prefetchedFromHeaders,classifyRequestFailure} = require('./sj-production-performance');
const {attachBrowserNetworkDiagnostic}=require('./sj-performance-network-diagnostic');
const {installBrowserCancellationDiagnostic}=require('./sj-performance-browser-cancel-diagnostic');

function classifyProbeFailure(row, origin) {
  const prefetch = classifyRequestFailure({...row,path:row.uri,origin});
  if (prefetch.expected) return prefetch;
  const list = ['/api/v1/seputar-jaminan/contacts','/api/v1/seputar-jaminan/publications','/api/reviews'];
  let url;try {url=new URL(row.uri);} catch {return prefetch;}
  const allowedOrigin=url.origin===origin||(origin==='http://127.0.0.1:3111'&&url.origin==='http://127.0.0.1:7111');
  if(allowedOrigin && row.error==='net::ERR_ABORTED' && row.method==='GET' && row.observedInWindow===true &&
    row.action==='rapid-filter' && row.superseded===true && list.includes(url.pathname)) {
    return {expected:true,reason:'PROVEN_SUPERSEDED_LIST_FILTER_ABORTED'};
  }
  return prefetch;
}
exports.classifyProbeFailure=classifyProbeFailure;

// A document can already have reached networkidle before a client action starts.
// Drain the work observed after that action instead of treating that old state
// (or an old, already-true ready predicate) as proof of the new result.
async function waitForObservedWork({active,tasks,getRevision,timeoutMs=8000,quietMs=250,now=Date.now,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  const deadline=now()+timeoutMs;
  let revision=getRevision(),quietSince=now();
  for(;;) {
    if(now()>=deadline)throw Error('ObservedWorkDeadline');
    const current=getRevision();
    if(current!==revision){revision=current;quietSince=now();}
    if(active.size===0&&now()-quietSince>=quietMs) {
      const length=tasks.length;
      let timer;
      try{await Promise.race([Promise.all(tasks.slice()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ObservedWorkDeadline')),Math.max(1,deadline-now()));})]);}
      finally{clearTimeout(timer);}
      if(active.size===0&&revision===getRevision()&&length===tasks.length)return;
      revision=getRevision();quietSince=now();
    }
    await pause(Math.min(25,Math.max(1,deadline-now())));
  }
}
function responseQueryMatches(response,{origin,pathname,query={},present=[]}) {
  let url;try{url=new URL(response.url());}catch{return false;}
  if(response.request().method()!=='GET'||url.origin!==origin||url.pathname!==pathname)return false;
  return present.every(key=>Boolean(url.searchParams.get(key)))&&Object.entries(query).every(([key,value])=>value===null?!url.searchParams.has(key):url.searchParams.get(key)===String(value));
}
function validModalFocusCycle({controlCount,forward,reverse,bodyInsertion=null}) {
  if(!Number.isInteger(controlCount)||controlCount<1||controlCount>20)return false;
  let expected=Array.from({length:controlCount},(_,index)=>index);
  if(forward.includes(controlCount)) {
    if(!Number.isInteger(bodyInsertion)||bodyInsertion<0||bodyInsertion>controlCount)return false;
    expected.splice(bodyInsertion,0,controlCount);
  }
  // Traversals always start at the first real control, not the scroll body.
  const start=expected.indexOf(0);expected=[...expected.slice(start),...expected.slice(0,start)];
  const forwardExpected=[...expected,0],reverseExpected=[0,...expected.slice(1).reverse(),0];
  return forward.length===forwardExpected.length&&reverse.length===reverseExpected.length&&
    forward.every((value,index)=>value===forwardExpected[index])&&reverse.every((value,index)=>value===reverseExpected[index]);
}
exports.waitForObservedWork=waitForObservedWork;
exports.responseQueryMatches=responseQueryMatches;
exports.validModalFocusCycle=validModalFocusCycle;

function browserTools(page) {
  const started = Date.now();
  const issues = [], requests = [], responses = [], failures = [], actions = [], bodies = [], lifecycle = [], settles = [], navigationIntents = [];
  const active = new Map(), responseTasks = [], identities = new Map(),requestRows=new WeakMap();
  let networkDiagnostic=null;
  let phase = 'initial', phaseSequence = null, nextActionSequence = 0, intent = null, consoleErrors = 0, pageErrors = 0, revision=0;
  const elapsed = () => Date.now() - started;
  // Installed Next 16.3.8: SHA-256 truncated to 12 bytes/base64url, or the
  // legacy 32-bit base36 hash truncated to five characters. This is only
  // request correlation, never evidence that an aborted request succeeded.
  const validRscMarker = values => values.length === 1 &&
    (/^[A-Za-z0-9_-]{16}$/.test(values[0]) || /^[a-z0-9]{1,5}$/.test(values[0]));
  const networkTiming = request => {
    try {
      const value = request.timing();
      return Object.fromEntries(['requestStart','responseStart','responseEnd'].map(key =>
        [key, Number.isFinite(value?.[key]) ? value[key] : null]));
    } catch { return null; }
  };
  const safeError = error => ({
    errorName: ['Error','TimeoutError','AbortError','TypeError','RangeError'].includes(error?.name) ? error.name : 'OtherError',
    reason: ['ObservedWorkDeadline','ResponseDeadline','IntendedReadNotSuccessful','IntendedReadBodyInvalid','InvalidNavigationIntent'].includes(error?.message) ? error.message : 'UNCLASSIFIED_ERROR',
  });
  const safeFailure = value => /^net::ERR_[A-Z0-9_]{1,64}$/.test(value || '') ? value : 'REQUEST_FAILED';
  const mimeClass = headers => {
    const raw = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1];
    if (typeof raw !== 'string' || !raw) return 'unknown';
    const mime = raw.split(';',1)[0].trim().toLowerCase();
    if (mime === 'text/x-component') return 'rsc';
    if (mime === 'application/json') return 'json';
    if (['image/avif','image/webp','image/png','image/jpeg','image/gif','image/svg+xml','image/x-icon','image/vnd.microsoft.icon'].includes(mime)) return 'image';
    if (mime === 'text/html') return 'html';
    return 'other';
  };
  const safeUrl = raw => {
    const u = new URL(raw);
    const query = {};
    for (const key of ['state', 'category']) {
      if (u.searchParams.has(key)) {
        const value = u.searchParams.get(key);
        query[key] = /^[A-Z_]{1,40}$/.test(value) || value === 'all' || value === '' ? value : 'redacted';
      }
    }
    for (const key of ['page', 'limit']) {
      if (u.searchParams.has(key)) {
        const value = u.searchParams.get(key);
        query[key] = /^\d{1,5}$/.test(value) ? Number(value) : 'invalid';
      }
    }
    if(u.searchParams.get('variant')==='thumbnail')query.variant='thumbnail';
    if (u.searchParams.has('cursor')) query.cursorBoolean = Boolean(u.searchParams.get('cursor'));
    if (u.searchParams.has('search') || u.searchParams.has('q')) {
      query.searchLength = (u.searchParams.get('search') || u.searchParams.get('q') || '').length;
    }
    // Keep routes useful without exporting private record identifiers or raw
    // cursors, RSC keys, tokens, username searches, or request headers.
    const pathname = u.pathname
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
      .replace(/\/aset\/SJ-[^/]+/g, '/aset/:reference');
    return { uri: u.origin + pathname, query };
  };
  const destinationMatches = request => {
    if (!intent || intent.actionSequence !== phaseSequence) return null;
    const u = new URL(request.url()), target = intent.url;
    if (request.method() !== 'GET' || u.origin !== target.origin || u.pathname !== target.pathname) return false;
    const marker = u.searchParams.getAll('_rsc');
    if (marker.length > 0 && !validRscMarker(marker)) return false;
    const keys = new Set([...u.searchParams.keys(),...target.searchParams.keys()]);
    keys.delete('_rsc');
    for (const key of keys) {
      const actual = u.searchParams.getAll(key), expected = target.searchParams.getAll(key);
      if (actual.length > 1 || actual.length !== expected.length || actual.some((value,index) => value !== expected[index])) return false;
    }
    return true;
  };
  const requestFacts = request => {
    const headers = Object.fromEntries(Object.entries(request.headers()).map(([key,value]) => [key.toLowerCase(),value]));
    const u = new URL(request.url()), marker = u.searchParams.getAll('_rsc');
    return { action: phase, actionSequence: phaseSequence, method: request.method(), type: request.resourceType(),
      prefetched: prefetchedFromHeaders(headers), rscRequest: headers.rsc === '1',
      routerStateHeaderPresent: typeof headers['next-router-state-tree'] === 'string' && headers['next-router-state-tree'].length > 0,
      rscMarkerPresent: marker.length > 0, rscMarkerValid: validRscMarker(marker),
      intendedDestinationMatch: destinationMatches(request), intentActionSequence: intent?.actionSequence === phaseSequence ? phaseSequence : null,
      ...safeUrl(request.url()) };
  };
  const pending = () => [...active.entries()].map(([request,row]) =>
    ({ ...row, networkTiming:networkTiming(request), pendingAgeMs: elapsed() - row.startedElapsedMs }));
  const navigationIntent = raw => {
    const url = new URL(raw,page.url());
    if (url.origin !== new URL(page.url()).origin || url.pathname !== '/katalog' || url.username || url.password || url.hash || url.searchParams.has('_rsc') || phaseSequence === null) throw Error('InvalidNavigationIntent');
    if ([...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length > 1)) throw Error('InvalidNavigationIntent');
    // Raw destination/cursor remains private and is only compared at capture.
    intent = { url, actionSequence: phaseSequence };
    navigationIntents.push({ action: phase, actionSequence: phaseSequence, startedElapsedMs: elapsed(), ...safeUrl(url.href) });
  };
  const issue = (code, details = {}) => issues.push({ action: phase, actionSequence: phaseSequence, code, ...details });
  const onRequest = request => {
    revision++;
    const row = { ...requestFacts(request), sequence:requests.length, observedInWindow:true, startedElapsedMs:elapsed(), outcome:'pending', responseObserved:false };
    identities.set(row,request.url()); // comparison only; raw query is never exported.
    requests.push(row);
    requestRows.set(request,row);
    active.set(request, row);
  };
  const onFinished = request => {
    revision++;
    const captured = requestRows.get(request), row = captured || { ...requestFacts(request), sequence:null, observedInWindow:false, startedElapsedMs:null, responseObserved:false, intendedDestinationMatch:null, intentActionSequence:null };
    const finishedElapsedMs = elapsed();
    if (captured) Object.assign(captured,{finishedElapsedMs,outcome:'finished',networkTiming:networkTiming(request)});
    lifecycle.push({ ...row, outcome:'finished', finishedElapsedMs, eventAction:phase, eventActionSequence:phaseSequence });
    active.delete(request);
  };
  const onFailed = request => {
    revision++;
    const observedInWindow=active.has(request);
    const captured = requestRows.get(request), row = captured || { ...requestFacts(request), sequence:null, observedInWindow:false, startedElapsedMs:null, responseObserved:false, intendedDestinationMatch:null, intentActionSequence:null };
    const error = safeFailure(request.failure()?.errorText), failedElapsedMs = elapsed();
    const failure = { ...row, networkTiming:networkTiming(request), error, observedInWindow, capturedInWindow:Boolean(captured), kind:error === 'net::ERR_ABORTED' ? 'aborted' : 'network-error',
      outcome:'failed', failedElapsedMs, eventAction:phase, eventActionSequence:phaseSequence };
    if (captured) Object.assign(captured,{failedElapsedMs,outcome:'failed',networkTiming:networkTiming(request)});
    failures.push(failure);
    lifecycle.push({ ...failure });
    active.delete(request);
  };
  const onResponse = response => {
    revision++;
    const request = response.request(), row = requestRows.get(request);
    const responseElapsedMs = elapsed(), status = response.status(), mime = mimeClass(response.headers());
    const item = { ...(row || { ...requestFacts(request), sequence:null, observedInWindow:false, startedElapsedMs:null, intendedDestinationMatch:null, intentActionSequence:null }),
      status, mime, responseObserved:true, responseElapsedMs, eventAction:phase, eventActionSequence:phaseSequence, ...safeUrl(response.url()) };
    if (row) Object.assign(row,{responseObserved:true,responseElapsedMs,responseStatus:status,responseMime:mime});
    responses.push(item);
    const pathname = new URL(response.url()).pathname;
    if (mime==='rsc' && pathname==='/katalog' && typeof response.finished==='function') {
      // Observe transport completion only. Do not read/cancel/replace the RSC
      // body or treat status200/MIME/visible cards as a successful stream.
      responseTasks.push((async()=>{
        let deadline;
        try {
          const error=await Promise.race([response.finished(),new Promise((_,reject)=>{
            deadline=setTimeout(()=>reject(Error('ResponseDeadline')),8000);
          })]);
          item.transportCompletion={finished:error===null,error:error===null?null:safeFailure(error?.message),elapsedMs:elapsed()};
        } catch(error) {
          item.transportCompletion={finished:false,error:safeError(error).reason,elapsedMs:elapsed()};
        } finally {clearTimeout(deadline);}
      })());
    }
    if (request.method() !== 'GET' || !/\/(?:contacts|publications|reviews)$/.test(pathname)) return;
    responseTasks.push((async () => {
      let deadline;
      try {
        const body = await Promise.race([
          response.json(),
          new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('ResponseDeadline')), 8000); }),
        ]);
        const data = body?.data || body;
        if (!Array.isArray(data?.items)) return;
        const categories = {};
        for (const value of data.items) {
          const category = value.asset_category;
          if (typeof category === 'string' && /^[A-Z_]{1,40}$/.test(category)) categories[category] = (categories[category] || 0) + 1;
        }
        item.body = {
          itemCount: data.items.length,
          categories,
          state: typeof data.filters?.state === 'string' ? data.filters.state : undefined,
          page: Number.isInteger(data.page?.number) ? data.page.number : undefined,
          hasNextCursor: Boolean(data.page_info?.next_cursor || data.page?.nextCursor),
        };
        // IDs stay inside the browser command for overlap/duplicate checks.
        // Only counts and booleans leave this command.
        bodies.push({ ...item, ids: data.items.map(value => value.id).filter(value => typeof value === 'string'),mediaIds:data.items.map(value=>typeof value.cover?.id==='string'?value.cover.id:null) });
      } catch {
        item.bodyUnavailable = true;
      } finally { if (deadline) clearTimeout(deadline); }
    })());
  };
  const onConsole = message => { if (message.type() === 'error') consoleErrors++; };
  const onPageError = () => { pageErrors++; };
  page.on('request', onRequest);
  page.on('requestfinished', onFinished);
  page.on('requestfailed', onFailed);
  page.on('response', onResponse);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  const snapshot = async () => {
    const value = await page.locator('body').ariaSnapshot({ timeout: 8000 });
    return { inspected: true, lines: value.split('\n').length };
  };
  const settle = async ready => {
    const record = { action:phase, actionSequence:phaseSequence, startedElapsedMs:elapsed(), pendingBefore:pending(), stages:[] };
    let stage = 'not-started';
    const step = async (name,work) => {
      stage = name;
      const entry = { stage:name, startedElapsedMs:elapsed(), completed:false };
      record.stages.push(entry);
      try { await work(); entry.completed = true; }
      finally { entry.endedElapsedMs = elapsed(); }
    };
    try {
      if (ready) await step('ready-before',() => page.waitForFunction(ready, null, { timeout: 8000 }));
      await step('fonts',() => page.evaluate(() => Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 2000))])));
      await step('observed-work',() => waitForObservedWork({active,tasks:responseTasks,getRevision:()=>revision}));
      await step('animation-frames',() => page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
      if (ready) await step('ready-after',() => page.waitForFunction(ready, null, { timeout: 8000 }));
      record.settled = true;
      return true;
    } catch (error) {
      record.settled = false; record.failedStage = stage; Object.assign(record,safeError(error));
      issue('SETTLE_DEADLINE',{stage,...safeError(error)});
      return false;
    } finally {
      record.endedElapsedMs = elapsed(); record.pendingAfter = pending(); settles.push(record);
    }
  };
  const action = async (name, perform, ready) => {
    phase = name;
    phaseSequence = nextActionSequence++;
    const from = requests.length, time = Date.now(), startedElapsedMs = elapsed(), pendingBefore = pending();
    const observed = await snapshot();
    let completed = true;
    try { await perform(); } catch (error) {
      completed = false;
      issue('ACTION_NOT_COMPLETED', safeError(error));
    }
    const completedElapsedMs = elapsed();
    const settled = await settle(ready);
    const row = { action: name, actionSequence:phaseSequence, startedElapsedMs, completedElapsedMs, endedElapsedMs:elapsed(), pendingBefore, pendingAfter:pending(),
      completed, settled, durationMs: Date.now() - time, snapshot: observed, requests: requests.length - from, location: safeUrl(page.url()) };
    actions.push(row);
    return row;
  };
  const prepareViewport = async (width,height) => {
    await page.goto('about:blank',{waitUntil:'domcontentloaded'});
    if (!await settle()) throw Error('PreviousDocumentNotDrained');
    await page.setViewportSize({width,height});
  };
  const captureNetwork=async()=>{
    if(networkDiagnostic)throw Error('DuplicateNetworkDiagnostic');
    networkDiagnostic=await attachBrowserNetworkDiagnostic(page);
  };
  const closeNetwork=async()=>{if(networkDiagnostic)await networkDiagnostic.close();};
  const readAction = async(name,perform,contract,ready,before) => action(name,async()=>{
    if(before)await before();
    // Register BEFORE the click/filter change. Matching a previous request or a
    // response with only the same route is not sufficient for a new page.
    const from=requests.length;
    const expected=page.waitForResponse(response=>responseQueryMatches(response,contract)&&(requestRows.get(response.request())?.sequence??-1)>=from,{timeout:8000});
    const both=await Promise.all([perform(),expected]);
    const response=both[1];
    if(response.status()!==200)throw Error('IntendedReadNotSuccessful');
    const body=await response.json(),data=body?.data||body;
    if(!Array.isArray(data?.items))throw Error('IntendedReadBodyInvalid');
    await page.waitForFunction(ready,null,{timeout:8000});
  },ready);
  const lastBody = predicate => [...bodies].reverse().find(predicate);
  const requestCount=()=>requests.length;
  const publicationMediaProof=(from,expectedIndexes)=>{
    const pageBody=lastBody(row=>row.uri.endsWith('/publications')&&!row.query.cursorBoolean);
    const ids=pageBody?.mediaIds||[],counts=new Map();let unknown=0,nonThumbnail=0;
    for(const row of requests.slice(from)){
      if(row.method!=='GET')continue;
      const url=new URL(identities.get(row)),match=url.pathname.match(/^\/api\/v1\/seputar-jaminan\/media\/([^/]+)\/content$/);
      if(!match)continue;
      if(url.searchParams.get('variant')!=='thumbnail')nonThumbnail++;
      const index=ids.indexOf(match[1]);if(index<0){unknown++;continue;}counts.set(index,(counts.get(index)||0)+1);
    }
    return {coverCount:ids.filter(Boolean).length,requestCount:[...counts.values()].reduce((sum,count)=>sum+count,0),fetchedIndexes:[...counts.keys()],
      missing:expectedIndexes.filter(index=>!counts.has(index)).length,unexpected:[...counts.keys()].filter(index=>!expectedIndexes.includes(index)).length,
      duplicates:[...counts.values()].reduce((sum,count)=>sum+Math.max(0,count-1),0),unknown,nonThumbnail};
  };
  const tableState = selector => page.evaluate(selector => {
    const rows = [...document.querySelectorAll(selector + ' tbody tr')].filter(row => row.querySelectorAll('td').length > 1);
    const labels = rows.map(row => row.querySelector('td')?.textContent?.trim() || '');
    return { rows: rows.length, duplicateLabels: labels.length - new Set(labels).size, overflow: document.documentElement.scrollWidth > innerWidth };
  }, selector);
  const screenshot = async (file, ready) => {
    if (ready) {
      try { await page.waitForFunction(ready, null, { timeout: 8000 }); }
      catch { issue('SCREENSHOT_CONTENT_NOT_SETTLED'); return { captured: false }; }
    }
    const observed = await snapshot();
    await page.screenshot({ path: file, fullPage: true, timeout: 15000 });
    return { captured: true, file, snapshot: observed };
  };
  const finish = async extra => {
    await settle();
    for (const failure of failures) {
      const row=requests.find(value=>value.sequence===failure.sequence);
      failure.superseded=Boolean(row&&requests.some(newer=>newer.sequence>row.sequence&&newer.action==='rapid-filter'&&newer.method==='GET'&&newer.uri===row.uri&&identities.get(newer)!==identities.get(row)));
      Object.assign(failure,classifyProbeFailure(failure,new URL(page.url()).origin));
    }
    if (consoleErrors) issue('CONSOLE_ERROR', { count: consoleErrors });
    if (pageErrors) issue('PAGE_ERROR', { count: pageErrors });
    const unexpectedFailures = failures.filter(value => value.observedInWindow!==false && !value.expected).length;
    if (unexpectedFailures) issue('UNEXPECTED_REQUEST_FAILURE', { count: unexpectedFailures });
    const badResponses = responses.filter(value => value.status >= 400).length;
    if (badResponses) issue('HTTP_ERROR', { count: badResponses });
    const incompleteRsc=responses.filter(value=>value.transportCompletion?.finished===false).length;
    if(incompleteRsc)issue('RSC_TRANSPORT_NOT_COMPLETED',{count:incompleteRsc});
    const finalPending = pending();
    if (active.size) issue('REQUEST_STILL_PENDING', { count: active.size, pending:finalPending });
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth }));
    if (viewport.overflow) issue('HORIZONTAL_OVERFLOW');
    await closeNetwork();
    return { ...extra, startedAt:Number.isFinite(started)&&started>=0?started:null, durationMs: Date.now() - started, viewport, actions, requests, responses, failures, lifecycle, settles, navigationIntents, finalPending, consoleErrors, pageErrors, issues,
      ...(networkDiagnostic?{networkDiagnostic:networkDiagnostic.snapshot()}: {}) };
  };
  const dispose = () => {
    page.off('request', onRequest);
    page.off('requestfinished', onFinished);
    page.off('requestfailed', onFailed);
    page.off('response', onResponse);
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  };
  return { action, readAction, settle, prepareViewport, captureNetwork, closeNetwork, snapshot, issue, navigationIntent, lastBody, requestCount,publicationMediaProof,tableState, screenshot, finish, dispose, safeUrl };
}
exports.browserTools=browserTools;

async function contactTyping(page, env, createTools) {
  const t = createTools(page);
  const ready = () => Boolean(document.querySelector('input[aria-label="Cari nama kontak"]') && document.querySelector('table[aria-label="Daftar kontak WhatsApp marketing"][aria-busy="false"]'));
  try {
    await t.settle(ready);
    const value = 'Kontak pengukuran';
    const input = page.getByRole('textbox', { name: 'Cari nama kontak', exact: true });
    await t.readAction('typing', async () => {
      await input.click({ timeout: 8000 });
      await input.pressSequentially(value, { delay: 100, timeout: 8000 });
    },{origin:'http://127.0.0.1:7111',pathname:'/api/v1/seputar-jaminan/contacts',query:{search:value,cursor:null}},ready);
    const state = await page.evaluate(expected => {
      const input = document.querySelector('input[aria-label="Cari nama kontak"]');
      const actual = input?.value || '';
      return {
        input: { value: expected.startsWith(actual) ? actual : 'unexpected-redacted', length: actual.length, complete: actual === expected },
        focused: input === document.activeElement,
        activeTag: document.activeElement?.tagName || null,
        searchLength: new URL(location.href).searchParams.get('search')?.length || 0,
      };
    }, value);
    if (!state.input.complete || state.searchLength !== value.length) t.issue('SEARCH_INPUT_NOT_PRESERVED', { expectedLength: value.length, actualLength: state.input.length, urlLength: state.searchLength });
    if (!state.focused) t.issue('SEARCH_FOCUS_LOST');
    const searched=t.lastBody(row=>row.uri.endsWith('/contacts')&&row.query.searchLength===value.length);
    if(!searched) t.issue('SEARCH_RESULT_NOT_OBSERVED');
    const table = await t.tableState('table[aria-label="Daftar kontak WhatsApp marketing"]');
    const screenshot = await t.screenshot(env.screenshot, ready);
    return await t.finish({ name: 'bank-contact-typing', state, table, screenshot });
  } finally { t.dispose(); }
}

async function contactAppend(page, env, createTools) {
  const t = createTools(page);
  const ready = () => Boolean(document.querySelector('input[aria-label="Cari nama kontak"]') && document.querySelector('table[aria-label="Daftar kontak WhatsApp marketing"][aria-busy="false"]'));
  try {
    await t.action('initial', () => page.goto(env.url, { waitUntil: 'domcontentloaded', timeout: 15000 }), ready);
    const before = await t.tableState('table[aria-label="Daftar kontak WhatsApp marketing"]');
    const first = t.lastBody(value => value.uri.endsWith('/contacts') && !value.query.cursorBoolean);
    await t.readAction('append', () => page.getByRole('button', { name: 'Muat kontak berikutnya', exact: true }).click({ timeout: 8000 }),
      {origin:'http://127.0.0.1:7111',pathname:'/api/v1/seputar-jaminan/contacts',query:{limit:20},present:['cursor']},
      ()=>document.querySelectorAll('table[aria-label="Daftar kontak WhatsApp marketing"] tbody tr td:first-child:not([colspan])').length===40&&document.querySelector('table[aria-label="Daftar kontak WhatsApp marketing"]')?.getAttribute('aria-busy')==='false');
    const after = await t.tableState('table[aria-label="Daftar kontak WhatsApp marketing"]');
    const second = t.lastBody(value => value.uri.endsWith('/contacts') && value.query.cursorBoolean);
    const idDuplicates = first && second ? first.ids.filter(id => second.ids.includes(id)).length : null;
    if (before.rows !== 20 || after.rows <= before.rows) t.issue('CONTACT_APPEND_COUNT', { before: before.rows, after: after.rows });
    if (!first || !second) t.issue('CONTACT_PAGE_BODY_MISSING');
    if (idDuplicates !== 0 || after.duplicateLabels !== 0) t.issue('CONTACT_PAGE_DUPLICATES', { ids: idDuplicates, labels: after.duplicateLabels });
    const screenshot = await t.screenshot(env.screenshot, ready);
    const result = await t.finish({ name: 'bank-contact-append', before, after, idDuplicates, screenshot });
    const reads = result.requests.filter(value => value.action === 'append' && value.method === 'GET');
    result.appendRequests = {
      contacts: reads.filter(value => value.uri.endsWith('/contacts')).length,
      contactsWithCursor: reads.filter(value => value.uri.endsWith('/contacts') && value.query.cursorBoolean).length,
      settings: reads.filter(value => value.uri.endsWith('/seputar-jaminan/settings')).length,
      details: reads.filter(value => /\/(?:contacts|publications)\/[^/]+$/.test(value.uri)).length,
    };
    if (result.appendRequests.contacts !== 1 || result.appendRequests.contactsWithCursor !== 1 || result.appendRequests.settings !== 0 || result.appendRequests.details !== 0) {
      result.issues.push({ action: 'append', code: 'CONTACT_APPEND_REQUEST_FAN_OUT', ...result.appendRequests });
    }
    return result;
  } finally { t.dispose(); }
}

async function bankPublications(page, env, createTools) {
  const t = createTools(page);
  const ready = () => Boolean(document.querySelector('table[aria-label="Daftar publikasi Seputar Jaminan"] tbody tr td:not([colspan])'));
  try {
    await t.settle(ready);
    const category = page.getByRole('combobox', { name: 'Filter kategori', exact: true });
    const available = await category.locator('option').evaluateAll(options => options.map(option => ({ value: option.value, label: option.textContent?.trim() })));
    const sequence = ['LAND', 'VEHICLE', 'BUILDING', 'LAND'];
    const required = { LAND: 'Tanah', VEHICLE: 'Kendaraan', BUILDING: 'Bangunan' };
    for (const [value, label] of Object.entries(required)) {
      if (!available.some(option => option.value === value && option.label === label)) t.issue('CATEGORY_CONTRACT_MISMATCH', { value });
    }
    await t.readAction('rapid-filter',()=>category.selectOption(sequence.at(-1),{timeout:8000}),
      {origin:'http://127.0.0.1:7111',pathname:'/api/v1/seputar-jaminan/publications',query:{category:'LAND',cursor:null}},
      ()=>new URL(location.href).searchParams.get('category')==='LAND'&&document.querySelector('select[aria-label="Filter kategori"]')?.value==='LAND'&&document.querySelectorAll('table[aria-label="Daftar publikasi Seputar Jaminan"] tbody tr td:first-child:not([colspan])').length===8,
      async () => {
      for (const value of sequence.slice(0,-1)) {
        await t.snapshot();
        await category.selectOption(value, { timeout: 8000 });
      }
    });
    const filtered = await page.evaluate(() => ({
      selected: document.querySelector('select[aria-label="Filter kategori"]')?.value,
      categoryInUrl: new URL(location.href).searchParams.get('category'),
      categories: [...document.querySelectorAll('table[aria-label="Daftar publikasi Seputar Jaminan"] tbody tr')]
        .filter(row => row.querySelectorAll('td').length > 1).map(row => row.querySelectorAll('td')[1]?.textContent?.trim()),
    }));
    const finalBody = t.lastBody(value => value.uri.endsWith('/publications') && value.query.category === 'LAND');
    const bodyCount = finalBody?.body.itemCount ?? null;
    if (filtered.selected !== 'LAND' || filtered.categoryInUrl !== 'LAND' || !filtered.categories.length || filtered.categories.some(value => value !== 'Tanah')) t.issue('LATEST_CATEGORY_NOT_RENDERED');
    if (!finalBody || Object.keys(finalBody.body.categories).some(value => value !== 'LAND') || bodyCount !== filtered.categories.length) t.issue('LATEST_CATEGORY_BODY_MISMATCH');
    await t.readAction('clear-filter', () => category.selectOption('', { timeout: 8000 }),
      {origin:'http://127.0.0.1:7111',pathname:'/api/v1/seputar-jaminan/publications',query:{category:null,cursor:null}},
      ()=>!new URL(location.href).searchParams.has('category')&&document.querySelectorAll('table[aria-label="Daftar publikasi Seputar Jaminan"] tbody tr td:first-child:not([colspan])').length===20);
    const first = t.lastBody(value => value.uri.endsWith('/publications') && !value.query.category && !value.query.cursorBoolean);
    const before = await t.tableState('table[aria-label="Daftar publikasi Seputar Jaminan"]');
    await t.readAction('next-page', () => page.getByRole('button', { name: 'publikasi berikutnya', exact: true }).click({ timeout: 8000 }),
      {origin:'http://127.0.0.1:7111',pathname:'/api/v1/seputar-jaminan/publications',query:{category:null},present:['cursor']},
      ()=>new URL(location.href).searchParams.has('cursor')&&document.querySelectorAll('table[aria-label="Daftar publikasi Seputar Jaminan"] tbody tr td:first-child:not([colspan])').length===12);
    const second = t.lastBody(value => value.uri.endsWith('/publications') && value.query.cursorBoolean);
    const next = await t.tableState('table[aria-label="Daftar publikasi Seputar Jaminan"]');
    const nextLocation = t.safeUrl(page.url());
    const idDuplicates = first && second ? first.ids.filter(id => second.ids.includes(id)).length : null;
    if (before.rows !== 20 || !next.rows || !nextLocation.query.cursorBoolean || idDuplicates !== 0) t.issue('PUBLICATION_CURSOR_INVALID', { firstRows: before.rows, nextRows: next.rows, idDuplicates });
    await t.readAction('first-page', () => page.getByRole('button', { name: 'Kembali ke awal', exact: true }).click({ timeout: 8000 }),
      {origin:'http://127.0.0.1:7111',pathname:'/api/v1/seputar-jaminan/publications',query:{category:null,cursor:null}},
      ()=>!new URL(location.href).searchParams.has('cursor')&&document.querySelectorAll('table[aria-label="Daftar publikasi Seputar Jaminan"] tbody tr td:first-child:not([colspan])').length===20);
    const returned = await t.tableState('table[aria-label="Daftar publikasi Seputar Jaminan"]');
    if (returned.rows !== before.rows || t.safeUrl(page.url()).query.cursorBoolean) t.issue('PUBLICATION_CONTEXT_NOT_RESTORED');
    const screenshot = await t.screenshot(env.screenshot, ready);
    return await t.finish({ name: 'bank-publication-filters-and-cursor', sequence, filtered: { selected: filtered.selected, categoryInUrl: filtered.categoryInUrl, rows: filtered.categories.length, categoryLabels: [...new Set(filtered.categories)] }, bodyCount, before, next, nextLocation, returned, idDuplicates, screenshot });
  } finally { t.dispose(); }
}

async function controlReviews(page, env, createTools) {
  const t = createTools(page);
  const ready = () => document.querySelector('#sj-list')?.getAttribute('aria-busy')==='false' && Boolean(document.querySelector('table tbody tr td:not([colspan])'));
  try {
    await t.settle(ready);
    const status = page.getByRole('combobox', { name: 'Status pengajuan', exact: true });
    const sequence = ['IN_REVIEW', 'APPROVED', 'all'];
    const available = await status.locator('option').evaluateAll(options => options.map(option => option.value));
    if (sequence.some(value => !available.includes(value))) t.issue('REVIEW_STATE_CONTRACT_MISMATCH');
    await t.readAction('rapid-filter',()=>status.selectOption(sequence.at(-1),{timeout:8000}),
      {origin:new URL(env.url).origin,pathname:'/api/reviews',query:{state:'all',page:1,limit:10}},ready,
      async () => {
      for (const value of sequence.slice(0,-1)) {
        await t.snapshot();
        await status.selectOption(value, { timeout: 8000 });
      }
    });
    const selected = await status.inputValue();
    const first = t.lastBody(value => value.uri.endsWith('/api/reviews') && value.query.state === 'all' && (value.query.page || 1) === 1);
    const before = await t.tableState('table');
    const current = t.safeUrl(page.url());
    if (selected !== 'all' || current.query.state !== 'all' || !first || first.body.state !== 'all' || before.rows !== 10) t.issue('LATEST_REVIEW_STATE_NOT_RENDERED', { selected, rows: before.rows, bodyState: first?.body.state || null });
    await t.readAction('next-page', () => page.getByRole('button', { name: 'Halaman berikutnya', exact: true }).click({ timeout: 8000 }),
      {origin:new URL(env.url).origin,pathname:'/api/reviews',query:{state:'all',page:2,limit:10}},ready);
    const next = await t.tableState('table');
    const nextLocation = t.safeUrl(page.url());
    const second = t.lastBody(value => value.uri.endsWith('/api/reviews') && value.query.page === 2);
    const idDuplicates = first && second ? first.ids.filter(id => second.ids.includes(id)).length : null;
    if (next.rows !== 10 || nextLocation.query.page !== 2 || idDuplicates !== 0) t.issue('REVIEW_PAGINATION_INVALID', { rows: next.rows, idDuplicates });
    await t.readAction('previous-page', () => page.getByRole('button', { name: 'Halaman sebelumnya', exact: true }).click({ timeout: 8000 }),
      {origin:new URL(env.url).origin,pathname:'/api/reviews',query:{state:'all',page:1,limit:10}},ready);
    const returned = await t.tableState('table');
    if (returned.rows !== before.rows || (t.safeUrl(page.url()).query.page || 1) !== 1) t.issue('REVIEW_CONTEXT_NOT_RESTORED');
    const screenshot = await t.screenshot(env.screenshot, ready);
    return await t.finish({ name: 'control-review-filters-and-pagination', sequence, selected, before, next, nextLocation, returned, idDuplicates, screenshot });
  } finally { t.dispose(); }
}

async function sjCatalog(page, env, createTools) {
  const t = createTools(page);
  const ready = () => document.querySelector('section[aria-label="Pencarian dan hasil katalog"]')?.getAttribute('aria-busy') !== 'true' && Boolean(document.querySelector('[data-asset-card]'));
  const cards = () => page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-asset-card]')];
    const ids = nodes.map(node => node.getAttribute('data-asset-id'));
    return { ids, rows: nodes.length, duplicateIds: ids.length - new Set(ids).size, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  try {
    await t.captureNetwork();
    await t.settle(ready);
    const first = await cards();
    const navigate=async name=>{
      const link=page.getByRole('link',{name,exact:true}),href=await link.getAttribute('href');
      const target=new URL(href,env.url);
      if(target.origin!==new URL(env.url).origin||target.pathname!=='/katalog')throw Error('CatalogDestinationInvalid');
      t.navigationIntent(target.href);
      await Promise.all([page.waitForURL(url=>url.origin===target.origin&&url.pathname===target.pathname&&url.search===target.search,{timeout:8000}),link.click({timeout:8000})]);
    };
    await t.action('next-page', () => navigate('Lihat aset berikutnya'),
      ()=>Boolean(new URL(location.href).searchParams.get('cursor'))&&document.querySelectorAll('[data-asset-card]').length===8);
    const second = await cards();
    const nextLocation = t.safeUrl(page.url());
    const idDuplicates = first.ids.filter(id => second.ids.includes(id)).length;
    if (first.rows !== 24 || second.rows !== 8 || idDuplicates !== 0 || second.duplicateIds || !nextLocation.query.cursorBoolean) t.issue('PUBLIC_CATALOG_CURSOR_INVALID', { firstRows: first.rows, nextRows: second.rows, idDuplicates });
    await t.action('first-page', () => navigate('Kembali ke halaman pertama'),
      ()=>!new URL(location.href).searchParams.has('cursor')&&document.querySelectorAll('[data-asset-card]').length===24);
    const returned = await cards();
    if (returned.rows !== first.rows || t.safeUrl(page.url()).query.cursorBoolean || returned.ids.some((id, index) => id !== first.ids[index])) t.issue('PUBLIC_CATALOG_CONTEXT_NOT_RESTORED');
    const screenshot = await t.screenshot(env.screenshot, ready);
    // Never export the temporary comparison IDs.
    const safeCards = ({ rows, duplicateIds, overflow }) => ({ rows, duplicateIds, overflow });
    return await t.finish({ name: 'sj-catalog-cursor', before: safeCards(first), next: safeCards(second), nextLocation, returned: safeCards(returned), idDuplicates, screenshot });
  } finally { try{await t.closeNetwork();}finally{t.dispose();} }
}

async function publicationThumbnailVisibility(page,env,createTools){
  const t=createTools(page),viewports=[];
  const ready=()=>{
    const rows=[...document.querySelectorAll('table[aria-label="Daftar publikasi Seputar Jaminan"] tbody tr')].filter(row=>row.querySelectorAll('td').length>1);
    return rows.length===20&&document.querySelectorAll('[data-sj-thumbnail]').length===20;
  };
  const geometry=()=>{
    const visible=el=>{
      const r=el.getBoundingClientRect();let left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
      for(let parent=el.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
        const style=getComputedStyle(parent),box=parent.getBoundingClientRect();
        if(/hidden|auto|scroll|clip/.test(style.overflowX)){left=Math.max(left,box.left);right=Math.min(right,box.right);}
        if(/hidden|auto|scroll|clip/.test(style.overflowY)){top=Math.max(top,box.top);bottom=Math.min(bottom,box.bottom);}
      }
      return r.width>0&&r.height>0&&right>left&&bottom>top;
    };
    const thumbnails=[...document.querySelectorAll('[data-sj-thumbnail]')],indexes=[],loaded=[];
    thumbnails.forEach((el,index)=>{if(visible(el)){indexes.push(index);const image=el.querySelector('img');if(image?.complete&&image.naturalWidth>0)loaded.push(index);}});
    return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,rows:document.querySelectorAll('table[aria-label="Daftar publikasi Seputar Jaminan"] tbody tr td:first-child:not([colspan])').length,
      thumbnailCount:thumbnails.length,visibleIndexes:indexes,loadedIndexes:loaded,longTitles:[...document.querySelectorAll('table[aria-label="Daftar publikasi Seputar Jaminan"] .setup-table-primary-text')].filter(el=>(el.textContent?.trim().length||0)>60).length};
  };
  const waitVisibleImages=()=>page.waitForFunction(()=>{
    const visible=[...document.querySelectorAll('[data-sj-thumbnail]')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;});
    return visible.length>0&&visible.every(el=>{const image=el.querySelector('img');return image?.complete&&image.naturalWidth>0;});
  },null,{timeout:8000});
  const screenshot=async(name,width)=>{await t.snapshot();const file=env.screenshot.replace('.png','-'+name+'-'+width+'.png');await page.screenshot({path:file,fullPage:false,timeout:15000});return file;};
  try{
    await page.emulateMedia({reducedMotion:'reduce'});
    for(const width of [360,390,768,1024,1440]){
      // Release the old document before resizing: old mounted observers must not
      // be attributed to the following fresh document's initial viewport.
      await t.prepareViewport(width,900);const from=t.requestCount();let loadingScreenshot=null;
      await t.action('thumbnail-initial-'+width,async()=>{
        await page.goto(env.url,{waitUntil:'domcontentloaded',timeout:15000});
        if(await page.getByText('Memuat publikasi…',{exact:true}).isVisible())loadingScreenshot=await screenshot('loading',width);
      },ready);
      await waitVisibleImages();await t.settle(ready);
      const initial=await page.evaluate(geometry),initialProof=t.publicationMediaProof(from,initial.visibleIndexes);
      if(initial.width!==width||initial.height!==900||initial.overflow||initial.rows!==20||initial.thumbnailCount!==20||!initial.longTitles||
        initial.visibleIndexes.length===0||initial.visibleIndexes.length>=20||initial.loadedIndexes.length!==initial.visibleIndexes.length||
        initialProof.coverCount!==20||initialProof.missing||initialProof.unexpected||initialProof.duplicates||initialProof.unknown||initialProof.nonThumbnail)t.issue('THUMBNAIL_INITIAL_VISIBILITY_INVALID',{width,initial,proof:initialProof});
      const initialScreenshot=await screenshot('initial',width);
      await t.action('thumbnail-scroll-'+width,()=>page.locator('[data-sj-thumbnail]').last().scrollIntoViewIfNeeded({timeout:8000}),ready);
      await waitVisibleImages();await t.settle(ready);const scrolled=await page.evaluate(geometry),expected=[...new Set([...initial.visibleIndexes,...scrolled.visibleIndexes])],scrollProof=t.publicationMediaProof(from,expected);
      if(!scrolled.visibleIndexes.includes(19)||scrolled.loadedIndexes.length!==scrolled.visibleIndexes.length||scrolled.overflow||scrollProof.missing||scrollProof.unexpected||scrollProof.duplicates||scrollProof.unknown||scrollProof.nonThumbnail||scrollProof.requestCount<=initialProof.requestCount)t.issue('THUMBNAIL_SCROLL_LOAD_INVALID',{width,scrolled,proof:scrollProof});
      const scrollScreenshot=await screenshot('scrolled',width);
      await t.action('thumbnail-return-'+width,()=>page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'})),ready);
      await waitVisibleImages();await t.settle(ready);const returned=await page.evaluate(geometry),returnProof=t.publicationMediaProof(from,expected);
      if(returned.visibleIndexes.some(index=>!initial.visibleIndexes.includes(index))||returned.loadedIndexes.length!==returned.visibleIndexes.length||returned.overflow||returnProof.requestCount!==scrollProof.requestCount||returnProof.duplicates||returnProof.missing||returnProof.unexpected)t.issue('THUMBNAIL_REENTRY_REQUEST_DUPLICATE',{width,returned,proof:returnProof});
      const returnScreenshot=await screenshot('returned',width);
      viewports.push({width,loadingScreenshot,initial,initialProof,initialScreenshot,scrolled,scrollProof,scrollScreenshot,returned,returnProof,returnScreenshot});
    }
    return await t.finish({name:'bank-publication-thumbnail-visibility',mode:'actual-UI-read-only; authenticated media GETs; no response double',viewports});
  }finally{await page.emulateMedia({reducedMotion:null});t.dispose();}
}

async function contactViewports(page, env, createTools) {
  const t=createTools(page),viewports=[];
  const ready=()=>Boolean(document.querySelector('table[aria-label="Daftar kontak WhatsApp marketing"][aria-busy="false"] tbody tr td:not([colspan])'));
  try {
    await page.emulateMedia({reducedMotion:'reduce'});
    for(const width of [360,390,768,1024,1440]) {
      // Resize only a released document. Resizing the previous app first can
      // expose its desktop links and start prefetches during the next reload.
      // Keep draining/failed-request assertions; do not discard old traffic.
      await t.prepareViewport(width,900);
      await t.action('viewport-'+width,()=>page.goto(env.url,{waitUntil:'domcontentloaded'}),ready);
      const table=await t.tableState('table[aria-label="Daftar kontak WhatsApp marketing"]');
      const observed=await page.evaluate(()=>({width:innerWidth,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,overflow:document.documentElement.scrollWidth>innerWidth}));
      if(observed.width!==width||observed.overflow||!observed.reducedMotion||!table.rows)t.issue('CONTACT_VIEWPORT_INVALID',{width,...observed});
      const file=env.screenshot.replace('.png','-'+width+'.png');
      const screenshot=await t.screenshot(file,ready);
      const input=page.getByRole('textbox',{name:'Cari nama kontak',exact:true});
      await input.focus();await input.press('Tab');
      const tabMoved=await page.evaluate(()=>document.activeElement?.tagName==='BUTTON');
      if(!tabMoved)t.issue('CONTACT_TAB_ORDER_INVALID',{width});
      const trigger=page.getByRole('button',{name:/^Aksi kontak /}).first();
      await trigger.click();await t.snapshot();
      await page.getByRole('menuitem',{name:'Lihat detail',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'Detail kontak WhatsApp',exact:true});
      await dialog.waitFor();await dialog.getByText('Identitas kontak',{exact:true}).waitFor();await t.settle();
      let trapped=true;
      for(let i=0;i<6;i++){await page.keyboard.press('Tab');trapped&&=await dialog.evaluate(el=>el.contains(document.activeElement));}
      const modalState=await dialog.evaluate(el=>{const b=el.getBoundingClientRect();return {insideViewport:b.left>=0&&b.right<=innerWidth,scrollPossible:el.scrollHeight>=el.clientHeight};});
      await page.screenshot({path:env.screenshot.replace('.png','-detail-'+width+'.png'),fullPage:true});
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
      const restored=await trigger.evaluate(el=>document.activeElement===el);
      if(!trapped||!restored||!modalState.insideViewport)t.issue('CONTACT_MODAL_FOCUS_OR_BOUNDS',{width,trapped,restored,...modalState});
      await page.getByRole('button',{name:'Tambah kontak',exact:true}).click();
      const form=page.getByRole('dialog',{name:'Tambah kontak WhatsApp',exact:true});await form.waitFor();await t.snapshot();
      await page.screenshot({path:env.screenshot.replace('.png','-create-'+width+'.png'),fullPage:true});
      await page.keyboard.press('Escape');await form.waitFor({state:'hidden'});
      const createFocus=await page.getByRole('button',{name:'Tambah kontak',exact:true}).evaluate(el=>document.activeElement===el);
      if(!createFocus)t.issue('CONTACT_CREATE_FOCUS_NOT_RESTORED',{width});
      viewports.push({...observed,table,screenshot,tabMoved,detail:{trapped,restored,...modalState},createFocus});
    }
    return await t.finish({name:'bank-contact-five-viewports',mode:'actual-UI-read-only',viewports});
  } finally {await page.emulateMedia({reducedMotion:null});t.dispose();}
}

async function contactFaultStates(page, env) {
  // Controlled browser response faults ONLY. Never a real-service integration
  // PASS and never a dummy runtime fallback. Exact GET handlers removed finally.
  const issues=[],viewports=[],faults=[],pageErrors=[];
  const pageError=e=>pageErrors.push(e.name);page.on('pageerror',pageError);
  const ready=()=>document.querySelector('table[aria-label="Daftar kontak WhatsApp marketing"]')?.getAttribute('aria-busy')==='false';
  const contactRoute=u=>u.origin==='http://127.0.0.1:7111'&&u.pathname==='/api/v1/seputar-jaminan/contacts';
  const settingsRoute=u=>u.origin==='http://127.0.0.1:7111'&&u.pathname==='/api/v1/seputar-jaminan/settings';
  for(const width of [360,390,768,1024,1440]) {
    let release,entered,deadline;const gate=new Promise(resolve=>{release=resolve;}),caught=new Promise(resolve=>{entered=resolve;});
    let contactFault=true,settingsFault=true;
    const handler=async route=>{
      if(route.request().method()!=='GET')return route.continue();
      const search=new URL(route.request().url()).searchParams.get('search');
      if(search==='pengukuran-tertunda') {
        const response=await route.fetch();entered(response.status());await gate;return route.fulfill({response});
      }
      if(search==='pengukuran-gagal'&&contactFault){contactFault=false;faults.push({width,kind:'contacts',status:503});return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,message:'Gangguan baca khusus tes.'})});}
      return route.continue();
    };
    const settingsHandler=async route=>{
      if(route.request().method()==='GET'&&settingsFault){settingsFault=false;faults.push({width,kind:'settings',status:503});return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,message:'Gangguan pengaturan khusus tes.'})});}
      return route.continue();
    };
    try {
      await page.setViewportSize({width,height:900});await page.goto(env.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(ready);await page.waitForLoadState('networkidle');
      const input=page.getByRole('textbox',{name:'Cari nama kontak',exact:true});
      const identity=await input.elementHandle();await input.focus();await page.route(contactRoute,handler);await input.fill('pengukuran-tertunda');
      const status=await Promise.race([caught,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('DelayedReadNotObserved')),8000);})]);
      clearTimeout(deadline);
      if(status!==200)throw Error('RealReadBeforeDelayFailed');
      await page.waitForFunction(()=>document.querySelector('table[aria-label="Daftar kontak WhatsApp marketing"]')?.getAttribute('aria-busy')==='true');
      const loading=await identity.evaluate(el=>({connected:el.isConnected,focused:el===document.activeElement,value:el.value}));
      if(!loading.connected||!loading.focused||loading.value!=='pengukuran-tertunda')throw Error('LoadingInputNotPreserved');
      await page.screenshot({path:env.screenshot.replace('.png','-loading-'+width+'.png'),fullPage:true});release();
      await page.waitForFunction(ready);await page.getByText('Tidak ada kontak yang cocok',{exact:true}).waitFor();
      await input.fill('pengukuran-gagal');await page.getByText('Kontak WhatsApp belum dapat dimuat',{exact:true}).waitFor();
      const error=await identity.evaluate(el=>({connected:el.isConnected,focused:el===document.activeElement,value:el.value}));
      if(!error.connected||!error.focused||error.value!=='pengukuran-gagal')throw Error('ErrorInputNotPreserved');
      await page.screenshot({path:env.screenshot.replace('.png','-error-'+width+'.png'),fullPage:true});
      await page.getByRole('button',{name:'Muat ulang',exact:true}).click();await page.waitForFunction(ready);await page.getByText('Tidak ada kontak yang cocok',{exact:true}).waitFor();
      await page.screenshot({path:env.screenshot.replace('.png','-empty-'+width+'.png'),fullPage:true});
      const cleared=page.waitForResponse(r=>r.request().method()==='GET'&&contactRoute(new URL(r.url()))&&!new URL(r.url()).searchParams.get('search'));
      await input.fill('');const clearedResponse=await cleared;
      if(clearedResponse.status()!==200||(await clearedResponse.json()).data.items.length===0)throw Error('ClearedContactQueryNotRestored');
      await page.waitForFunction(()=>document.querySelector('table[aria-label="Daftar kontak WhatsApp marketing"][aria-busy="false"] tbody tr td:not([colspan])'));
      await page.waitForLoadState('networkidle');await page.route(settingsRoute,settingsHandler);
      await page.getByRole('button',{name:'Muat ulang',exact:true}).click();await page.getByText('Tindakan kontak belum dapat diperiksa',{exact:true}).waitFor();
      await page.waitForFunction(()=>document.querySelector('table[aria-label="Daftar kontak WhatsApp marketing"][aria-busy="false"] tbody tr td:not([colspan])'));
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const disabled=await page.getByRole('button',{name:'Tambah kontak',exact:true}).isDisabled();if(!disabled)throw Error('SettingsFailureNotFailClosed');
      await page.screenshot({path:env.screenshot.replace('.png','-partial-'+width+'.png'),fullPage:true});
      await page.getByRole('button',{name:'Muat ulang',exact:true}).click();await page.waitForFunction(ready);await page.getByRole('button',{name:'Tambah kontak',exact:true}).waitFor();
      await page.waitForFunction(()=>!document.querySelector('button')?.disabled&&![...document.querySelectorAll('[role="alert"]')].some(el=>el.textContent.includes('Tindakan kontak belum dapat diperiksa')));
      const recovered=await page.getByRole('button',{name:'Tambah kontak',exact:true}).isEnabled();if(!recovered)throw Error('SettingsRetryNotRecovered');
      await identity.dispose();viewports.push({width,loading:{connected:loading.connected,focused:loading.focused},error:{connected:error.connected,focused:error.focused},empty:true,partialDisabled:disabled,recovered});
    } catch(error) {issues.push({width,code:'CONTACT_FAULT_STATE_FAILED',errorName:error.name,reason:error.message});}
    finally {clearTimeout(deadline);release();await page.unroute(contactRoute,handler);await page.unroute(settingsRoute,settingsHandler);}
  }
  page.off('pageerror',pageError);if(pageErrors.length)issues.push({code:'FAULT_PAGE_ERROR',count:pageErrors.length});
  return {name:'bank-contact-fault-states',mode:'browser-response-test-double; actual application UI, NOT real-service fault integration',viewports,faults,pageErrors,issues};
}

async function contactModalAccess(page,env,createTools){
  // Each size is a separate bounded command. Only read/open/focus/scroll/close;
  // never invoke a save, submit or other business mutation.
  const t=createTools(page),dialogs=[];
  const ready=()=>Boolean(document.querySelector('table[aria-label="Daftar kontak WhatsApp marketing"][aria-busy="false"] tbody tr td:not([colspan])'));
  const inspect=async(dialog,kind)=>{
    const geometry=await dialog.evaluate(async el=>{
      const body=el.querySelector('.dashboard-modal__body');if(!body)throw Error('ModalBodyMissing');
      const visible=node=>{if(!node)return false;const b=node.getBoundingClientRect(),style=getComputedStyle(node);
        if(b.width<=0||b.height<=0||b.left<0||b.top<0||b.right>innerWidth+1||b.bottom>innerHeight+1||style.visibility==='hidden')return false;
        const hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return Boolean(hit&&(hit===node||node.contains(hit)));};
      const b=el.getBoundingClientRect(),maximum=Math.max(0,body.scrollHeight-body.clientHeight);
      body.scrollTop=0;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const top=body.scrollTop;
      body.scrollTop=maximum;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const bottom=body.scrollTop;
      const last=[...body.querySelectorAll('*')].reverse().find(node=>{const r=node.getBoundingClientRect();return r.width>2&&r.height>2&&!node.closest('.sr-only')&&getComputedStyle(node).visibility!=='hidden';});
      const lastRect=last?.getBoundingClientRect(),bodyRect=body.getBoundingClientRect();
      return {width:innerWidth,height:innerHeight,bounds:{left:b.left,right:b.right,top:b.top,bottom:b.bottom},insideViewport:b.left>=0&&b.right<=innerWidth+1&&b.top>=0&&b.bottom<=innerHeight+1,
        body:{clientHeight:body.clientHeight,scrollHeight:body.scrollHeight,maximum,top,bottom,horizontalOverflow:body.scrollWidth>body.clientWidth+1,
          scrollWorked:maximum<=1||bottom>top+1,lastContentVisible:Boolean(lastRect&&lastRect.top>=bodyRect.top-1&&lastRect.bottom<=bodyRect.bottom+1)},
        chrome:{header:visible(el.querySelector('.dashboard-modal__header')),close:visible(el.querySelector('button[aria-label="Tutup modal"]')),footer:visible(el.querySelector('.dashboard-modal__footer'))}};
    });
    if(!geometry.insideViewport||geometry.body.horizontalOverflow||!geometry.body.scrollWorked||!geometry.body.lastContentVisible||Object.values(geometry.chrome).some(value=>!value))t.issue('MODAL_SCROLL_OR_VISIBLE_CHROME',{kind,...geometry});
    const tabbables=dialog.locator('button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
    const nodes=await tabbables.elementHandles(),enabled=[];
    for(const node of nodes){if(await node.evaluate(el=>el.tabIndex>=0&&el.getClientRects().length>0&&!el.closest('[aria-hidden="true"],[inert]')&&el.getAttribute('aria-disabled')!=='true'&&getComputedStyle(el).visibility!=='hidden'))enabled.push(node);}
    if(!enabled.length||enabled.length>20)throw Error('UnexpectedModalFocusCount');
    const body=await dialog.locator('.dashboard-modal__body').elementHandle();
    const bodyMayReceiveNativeTab=await body.evaluate(el=>el.scrollHeight>el.clientHeight+1&&!el.closest('[aria-hidden="true"],[inert]')&&getComputedStyle(el).visibility!=='hidden');
    // Chromium can natively make an overflowing read-only scroll container a
    // Tab stop even without a tabindex attribute. It is not an unknown control
    // or an escaped focus if (and only if) the exact body is observed to receive
    // focus and actual overflow is proven. All explicit controls stay mandatory.
    let bodyInsertion=null;
    if(bodyMayReceiveNativeTab){bodyInsertion=0;for(const node of enabled){if(await node.evaluate((el,body)=>Boolean(el.compareDocumentPosition(body)&Node.DOCUMENT_POSITION_FOLLOWING),body))bodyInsertion++;}}
    const focus=[],cycles={forward:[],reverse:[]};
    for(const direction of ['forward','reverse']){
      await enabled[0].evaluate(el=>el.focus());
      for(let i=0;i<=enabled.length+1;i++){
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        let index=-1;for(let n=0;n<enabled.length;n++){if(await enabled[n].evaluate(el=>document.activeElement===el)){index=n;break;}}
        if(index<0&&bodyMayReceiveNativeTab&&await body.evaluate(el=>document.activeElement===el))index=enabled.length;
        const state=await dialog.evaluate(el=>{
          const active=document.activeElement,b=active?.getBoundingClientRect(),hit=b?document.elementFromPoint(b.left+b.width/2,b.top+b.height/2):null;
          const rect=value=>Number.isFinite(value)?Math.max(-10000,Math.min(10000,Math.round(value*10)/10)):null;
          const target=active===el.querySelector('.dashboard-modal__body')?'modal-scroll-body':active===el.querySelector('button[aria-label="Tutup modal"]')?'modal-close':el.querySelector('.dashboard-modal__footer')?.contains(active)?'modal-footer':el.querySelector('.dashboard-modal__body')?.contains(active)?'modal-body-control':'outside-dialog';
          return {inside:el.contains(active),visible:Boolean(b&&b.left>=0&&b.right<=innerWidth+1&&b.top>=0&&b.bottom<=innerHeight+1&&hit&&(hit===active||active.contains(hit))),
            target,tag:active?.tagName||null,tabIndex:active?.tabIndex??null,bounds:b?{left:rect(b.left),right:rect(b.right),top:rect(b.top),bottom:rect(b.bottom)}:null};
        });
        cycles[direction].push(index);focus.push({direction,index,...state});
        if(index<0||!state.inside||!state.visible)t.issue('MODAL_KEYBOARD_CONTROL_INACCESSIBLE',{kind,direction,index,...state});
        if(i>0&&index===0)break;
        await page.keyboard.press(direction==='forward'?'Tab':'Shift+Tab');
      }
    }
    const cycleValid=validModalFocusCycle({controlCount:enabled.length,...cycles,bodyInsertion});
    if(!cycleValid)t.issue('MODAL_NATIVE_TAB_ORDER_OR_WRAP',{kind,controlCount:enabled.length,bodyInsertion,...cycles});
    await body.dispose();
    for(const node of nodes)await node.dispose();
    await dialog.locator('.dashboard-modal__body').evaluate(el=>{el.scrollTop=el.scrollHeight;});await t.settle();
    const screenshot=env.screenshot.replace('.png','-'+kind+'-'+env.width+'x'+env.height+'.png');await page.screenshot({path:screenshot,fullPage:true});
    dialogs.push({kind,geometry,focus,cycles,cycleValid,bodyMayReceiveNativeTab,screenshot});
  };
  try{
    await page.emulateMedia({reducedMotion:'reduce'});
    await t.prepareViewport(env.width,env.height);
    await page.goto(env.url,{waitUntil:'domcontentloaded'});await t.settle(ready);
    const trigger=page.getByRole('button',{name:/^Aksi kontak Kontak pengukuran .*nama panjang/}).first();
    const label=await trigger.getAttribute('aria-label');if(!label||label.replace('Aksi kontak ','').length<60)throw Error('LongContactFixtureNotObserved');
    await trigger.click();await t.snapshot();await page.getByRole('menuitem',{name:'Lihat detail',exact:true}).click();
    const detail=page.getByRole('dialog',{name:'Detail kontak WhatsApp',exact:true});await detail.waitFor();await detail.getByText('Identitas kontak',{exact:true}).waitFor();await t.settle();await inspect(detail,'detail');
    await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});const detailFocus=await trigger.evaluate(el=>document.activeElement===el);if(!detailFocus)t.issue('MODAL_DETAIL_FOCUS_NOT_RESTORED');
    const add=page.getByRole('button',{name:'Tambah kontak',exact:true});await add.click();const form=page.getByRole('dialog',{name:'Tambah kontak WhatsApp',exact:true});await form.waitFor();await t.settle();await inspect(form,'create');
    await page.keyboard.press('Escape');await form.waitFor({state:'hidden'});const createFocus=await add.evaluate(el=>document.activeElement===el);if(!createFocus)t.issue('MODAL_CREATE_FOCUS_NOT_RESTORED');
    return await t.finish({name:'bank-contact-modal-access',mode:'actual-UI-read-only',width:env.width,height:env.height,longLabelLength:label.replace('Aksi kontak ','').length,dialogs,detailFocus,createFocus});
  }finally{await page.emulateMedia({reducedMotion:null});t.dispose();}
}

exports.run = async ({ out, cli, code, bankUi, publicUi, controlOrigin, save }) => {
  if (!path.isAbsolute(out) || !fs.statSync(out).isDirectory()) throw new Error('Existing absolute evidence directory required');
  for (const origin of [bankUi, publicUi, controlOrigin]) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
      throw new Error('Existing local disposable preview origins required');
    }
  }
  if (typeof cli !== 'function' || typeof code !== 'function') throw new Error('Existing authenticated browser wrappers required');
  const report = { startedAt: new Date().toISOString(), mode: 'actual-UI-read-only', probes: [], issues: [], pass: false };
  const persist = async () => {
    fs.writeFileSync(path.join(out, 'ui-probes.json'), JSON.stringify(report, null, 2));
    if (save) await save(report);
  };
  await persist();
  const probes = [
    { name: 'bank-contact-typing', tab: 0, url: bankUi + '/dashboard/seputar-jaminan/kontak', run: contactTyping },
    { name: 'bank-contact-append', tab: 0, url: bankUi + '/dashboard/seputar-jaminan/kontak', run: contactAppend },
    { name: 'bank-publication-filters-and-cursor', tab: 0, url: bankUi + '/dashboard/seputar-jaminan/publikasi', run: bankPublications },
    { name: 'bank-publication-thumbnail-visibility', tab: 0, url: bankUi + '/dashboard/seputar-jaminan/publikasi', run: publicationThumbnailVisibility },
    { name: 'control-review-filters-and-pagination', tab: 1, url: controlOrigin + '/reviews?state=all&limit=10&page=1', run: controlReviews },
    { name: 'sj-catalog-cursor', tab: 2, url: publicUi + '/katalog', run: sjCatalog },
    { name: 'bank-contact-five-viewports', tab: 0, url: bankUi + '/dashboard/seputar-jaminan/kontak', run: contactViewports },
    { name: 'bank-contact-fault-states', tab: 0, url: bankUi + '/dashboard/seputar-jaminan/kontak', run: contactFaultStates },
    ...[360,390,768,1024,1440].flatMap(width=>[480,600].map(height=>({name:'bank-contact-modal-'+width+'x'+height,tab:0,url:bankUi+'/dashboard/seputar-jaminan/kontak',width,height,run:contactModalAccess}))),
  ];
  for (const probe of probes) {
    try {
      await cli('tab-select', String(probe.tab));
      await cli('goto', probe.url);
      await cli('snapshot');
      const env = { url: probe.url, screenshot: path.join(out, probe.name + '-probe.png').split(path.sep).join('/'),width:probe.width,height:probe.height };
      const result = await code(`async(page)=>{const attachBrowserNetworkDiagnostic=${attachBrowserNetworkDiagnostic.toString()};const prefetchedFromHeaders=${prefetchedFromHeaders.toString()},classifyRequestFailure=${classifyRequestFailure.toString()},classifyProbeFailure=${classifyProbeFailure.toString()},waitForObservedWork=${waitForObservedWork.toString()},responseQueryMatches=${responseQueryMatches.toString()},validModalFocusCycle=${validModalFocusCycle.toString()};const createTools=${browserTools.toString()};const probe=${probe.run.toString()};return JSON.stringify(await probe(page,${JSON.stringify(env)},createTools));}`);
      report.probes.push(result);
      report.issues.push(...result.issues.map(issue => ({ probe: probe.name, ...issue })));
    } catch (error) {
      // Persist the incomplete probe before continuing. Parent gate enforcement
      // happens only after all diagnostics and legitimate fixture cleanup.
      const issue = { probe: probe.name, code: 'PROBE_NOT_COMPLETED', errorName: error?.name || 'Error' };
      report.probes.push({ name: probe.name, completed: false, issues: [issue] });
      report.issues.push(issue);
    }
    await persist();
  }
  const modalProofs=report.probes.filter(probe=>probe.name==='bank-contact-modal-access');
  if(modalProofs.length!==10||!modalProofs.some(probe=>probe.dialogs?.some(dialog=>dialog.geometry.body.maximum>1&&dialog.geometry.body.scrollWorked)))report.issues.push({probe:'bank-contact-modal-access',code:'ACTUAL_MODAL_SCROLL_NOT_PROVEN'});
  report.pass = report.issues.length === 0;
  report.finishedAt = new Date().toISOString();
  await persist();
  return report;
};

function catalogTransportRepeatCode(env) {
  return `async(page)=>{const attachBrowserNetworkDiagnostic=${attachBrowserNetworkDiagnostic.toString()};const prefetchedFromHeaders=${prefetchedFromHeaders.toString()},classifyRequestFailure=${classifyRequestFailure.toString()},classifyProbeFailure=${classifyProbeFailure.toString()},waitForObservedWork=${waitForObservedWork.toString()},responseQueryMatches=${responseQueryMatches.toString()},validModalFocusCycle=${validModalFocusCycle.toString()};const createTools=${browserTools.toString()};const probe=${sjCatalog.toString()};return JSON.stringify(await probe(page,${JSON.stringify(env)},createTools));}`;
}
exports.catalogTransportRepeatCode=catalogTransportRepeatCode;
exports.runCatalogTransportRepeats=async({out,cli,code,publicUi})=>{
  if(!path.isAbsolute(out)||!fs.statSync(out).isDirectory()||publicUi!=='http://127.0.0.1:4411'||typeof cli!=='function'||typeof code!=='function')throw Error('Existing owned SJ browser wrappers and evidence required');
  const file=path.join(out,'catalog-transport-repeats.json');
  const report={startedAt:new Date().toISOString(),mode:'actual read-only catalog navigation; no native fetch/stream wrappers',probes:[],issues:[],pass:false};
  fs.writeFileSync(file,JSON.stringify(report,null,2),{flag:'wx'});
  const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
  for(let repetition=1;repetition<=3;repetition++){
    const attempt={repetition,completed:false};report.probes.push(attempt);save();
    try{
      await cli('tab-select','2');await cli('goto',publicUi+'/katalog');await cli('snapshot');
      const captured=await code(catalogTransportRepeatCode({url:publicUi+'/katalog',screenshot:path.join(out,'catalog-transport-repeat-'+repetition+'.png').split(path.sep).join('/')}));
      Object.assign(attempt,captured,{repetition,completed:true});
      report.issues.push(...captured.issues.map(issue=>({repetition,...issue})));
    }catch(error){report.issues.push({repetition,code:'CATALOG_REPEAT_NOT_COMPLETED',errorName:['Error','TimeoutError','TypeError'].includes(error?.name)?error.name:'OtherError'});}
    save();
  }
  report.pass=report.probes.every(p=>p.completed)&&report.issues.length===0;report.finishedAt=new Date().toISOString();save();return report;
};

// This opt-in instrumented reproduction is separate from the eighteen measured
// probes. Native wrappers are observable; its timings are NOT performance gates.
async function closeBrowserCancellationDiagnosticHandle(handle){
  try{return await handle.evaluate(value=>value.close());}
  finally{await handle.dispose();}
}
exports.closeBrowserCancellationDiagnosticHandle=closeBrowserCancellationDiagnosticHandle;
function catalogCancellationDiagnosticCode(env) {
  return `async(page)=>{
    const attachBrowserNetworkDiagnostic=${attachBrowserNetworkDiagnostic.toString()};
    const prefetchedFromHeaders=${prefetchedFromHeaders.toString()},classifyRequestFailure=${classifyRequestFailure.toString()},classifyProbeFailure=${classifyProbeFailure.toString()},waitForObservedWork=${waitForObservedWork.toString()},responseQueryMatches=${responseQueryMatches.toString()},validModalFocusCycle=${validModalFocusCycle.toString()};
    const createTools=${browserTools.toString()},probe=${sjCatalog.toString()};
    const env=${JSON.stringify(env)};
    const result={mode:'instrumented-cancellation-diagnostic-only',performanceGate:'NOT RUN',completed:false};
    const closeHandle=${closeBrowserCancellationDiagnosticHandle.toString()};
    const lease=await page.evaluateHandle(()=>{
      const install=${installBrowserCancellationDiagnostic.toString()};
      return install({maxEvents:200,trackResponseStreams:true});
    });
    try{result.probe=await probe(page,env,createTools);result.completed=true;}
    catch(error){result.failure={name:['Error','TimeoutError','TypeError'].includes(error?.name)?error.name:'OtherError',reason:'DIAGNOSTIC_PROBE_NOT_COMPLETED'};}
    finally{result.native=await closeHandle(lease);}
    return JSON.stringify(result);
  }`;
}
exports.catalogCancellationDiagnosticCode=catalogCancellationDiagnosticCode;

exports.runCatalogCancellationDiagnostic=async({out,cli,code,publicUi})=>{
  if(!path.isAbsolute(out)||!fs.statSync(out).isDirectory())throw Error('Existing absolute evidence directory required');
  if(publicUi!=='http://127.0.0.1:4411'||typeof cli!=='function'||typeof code!=='function')throw Error('Existing owned SJ diagnostic wrappers required');
  const report={startedAt:new Date().toISOString(),mode:'separate instrumented reproduction; NOT final performance evidence',repetitions:[]};
  const file=path.join(out,'catalog-cancel-diagnostic.json');
  const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
  fs.writeFileSync(file,JSON.stringify(report,null,2),{flag:'wx'});
  for(let repetition=1;repetition<=3;repetition++){
    // Persist the attempt before touching the page. Context loss or a failing
    // close/evaluation must not erase the failed repetition from this artifact.
    const attempt={repetition,phase:'prepare-browser',captureState:'running'};
    report.repetitions.push(attempt);save();
    try{
    await cli('tab-select','2');await cli('goto',publicUi+'/katalog');await cli('snapshot');
    const env={url:publicUi+'/katalog',screenshot:path.join(out,'catalog-cancel-diagnostic-'+repetition+'.png').split(path.sep).join('/')};
    attempt.phase='capture-and-restore';save();
    const captured=await code(catalogCancellationDiagnosticCode(env));
    Object.assign(attempt,captured,{repetition});save();
    if(captured.native?.closed!==true||captured.native.active!==false||captured.native.restoreFailures!==0||captured.native.listenerFailures!==0)throw Error('DiagnosticNativeRestorationNotProven');
    // A restored old/default installer is not evidence of response ownership.
    // Preserve incomplete capture before refusing another instrumented repeat;
    // none of these metadata checks waive a failed transport or prove EOF.
    if(captured.native.version!==1||captured.native.capture!=='native-call-observation-only'||captured.native.trackResponseStreams!==true||
      !Number.isFinite(captured.native.startedAt)||captured.native.startedAt<0||
      !['responses','streams','readers','events'].every(key=>Array.isArray(captured.native[key]))||
      !Number.isInteger(captured.native.pendingPromiseObservations)||captured.native.pendingPromiseObservations<0||
      !Number.isInteger(captured.native.cap)||captured.native.cap<1||captured.native.cap>200||
      captured.native.pendingPromiseObservations>captured.native.cap)throw Error('DiagnosticOwnershipCaptureNotProven');
    attempt.phase='capture-recorded';attempt.captureState='recorded';save();
    }catch(error){
      attempt.captureState='failed';
      const known=['DiagnosticNativeRestorationNotProven','DiagnosticOwnershipCaptureNotProven'].includes(error?.message);
      attempt.failure={errorName:['Error','TimeoutError','TypeError'].includes(error?.name)?error.name:'OtherError',
        reason:known?error.message:attempt.phase==='prepare-browser'?'DIAGNOSTIC_PREPARATION_FAILED':'DIAGNOSTIC_CAPTURE_OR_RESTORATION_FAILED'};
      save();
      if(known)throw error;
      throw Error('DiagnosticRepetitionNotCompleted');
    }
  }
  report.finishedAt=new Date().toISOString();fs.writeFileSync(file,JSON.stringify(report,null,2));
  return {evidence:file,repetitions:report.repetitions.length,mode:report.mode};
};
