'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { attachBrowserNetworkDiagnostic } = require('./sj-performance-network-diagnostic');

function fixture() {
  const session = new EventEmitter();
  session.sent = []; session.detachCalls = 0;
  session.send = async name => { session.sent.push(name); };
  session.detach = async () => { session.detachCalls++; };
  const page = { url: () => 'http://127.0.0.1:4411/katalog', context: () => ({ newCDPSession: async () => session }) };
  return { page, session };
}
function request(id = 'secret-request', url = 'http://127.0.0.1:4411/katalog?cursor=secret-token&_rsc=secret') {
  return { requestId: id, frameId: 'secret-frame', loaderId: 'secret-loader', type: 'Fetch',
    request: { url, method: 'GET', headers: { Authorization: 'secret-token' }, postData: 'secret-body' },
    initiator: { type: 'script', stack: { callFrames: [
      { functionName: 'createFetch', url: 'secret-filesystem', scriptId: 'secret-script' },
      { functionName: 'secret-function', url: 'secret-stack' },
    ] } } };
}

test('captures only safe correlated scalar facts, not successful-request rules', async () => {
  const { page, session } = fixture(); let clock = 100;
  const diagnostic = await attachBrowserNetworkDiagnostic(page, { now: () => clock });
  clock = 110; session.emit('Network.requestWillBeSent', request());
  clock = 115; session.emit('Network.responseReceived', { requestId: 'secret-request', response: { status: 200,
    encodedDataLength: 15, headers: { Authorization: 'secret-token' }, mimeType: 'text/x-component' } });
  clock = 120; session.emit('Network.loadingFailed', { requestId: 'secret-request', canceled: true, errorText: 'net::ERR_ABORTED' });
  const output = diagnostic.snapshot();
  assert.equal(output.startedAt,100);
  assert.deepEqual(output.events.map(row => row.kind), ['request', 'response', 'failed']);
  assert.deepEqual(output.events.map(row => row.elapsedMs), [10, 15, 20]);
  assert.equal(output.events[0].request, 1); assert.equal(output.events[0].frame, 1); assert.equal(output.events[0].loader, 1);
  assert.deepEqual(output.events[0].initiator.functions, ['createFetch']);
  assert.equal(output.events[1].status, 200); assert.equal(output.events[2].canceled, true);
  assert.equal(output.events[2].error, 'net::ERR_ABORTED');
  assert.doesNotMatch(JSON.stringify(output), /secret|127\.0\.0\.1|cursor|Authorization|mimeType|success|expected/);
  assert.deepEqual(session.sent, ['Network.enable']);
  const receipt = await diagnostic.close(); assert.equal(receipt.closed, true); assert.equal(receipt.active, false); assert.equal(receipt.detached, true);
  for (const name of ['Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed']) assert.equal(session.listenerCount(name), 0);
});

test('rejects unrelated route, cross-origin document, malformed URL and unmatched terminal', async () => {
  const { page, session } = fixture(); const diagnostic = await attachBrowserNetworkDiagnostic(page);
  session.emit('Network.requestWillBeSent', request('a', 'http://127.0.0.1:4411/api/private?password=secret'));
  session.emit('Network.requestWillBeSent', { ...request('b', 'https://secret.example/login'), type: 'Document' });
  session.emit('Network.requestWillBeSent', request('c', 'invalid secret url'));
  session.emit('Network.loadingFailed', { requestId: 'a', errorText: 'net::ERR_ABORTED' });
  assert.deepEqual(diagnostic.snapshot().events, []); await diagnostic.close();
});

test('same-origin document paths are anonymous and redirect outside scope stops correlation', async () => {
  const { page, session } = fixture(); const diagnostic = await attachBrowserNetworkDiagnostic(page);
  session.emit('Network.requestWillBeSent', { ...request('a', 'http://127.0.0.1:4411/private/secret?password=secret'), type: 'Document' });
  session.emit('Network.requestWillBeSent', request('a', 'https://secret.example/'));
  session.emit('Network.loadingFinished', { requestId: 'a', encodedDataLength: 15 });
  assert.equal(diagnostic.snapshot().events.length, 1); assert.equal(diagnostic.snapshot().events[0].route, 'document');
  assert.doesNotMatch(JSON.stringify(diagnostic.snapshot()), /secret|private/); await diagnostic.close();
});

test('bounded to 200 events and counts drops without expanding identifier maps', async () => {
  const { page, session } = fixture(); const diagnostic = await attachBrowserNetworkDiagnostic(page, { maxEvents: 10000 });
  for (let i = 0; i < 205; i++) session.emit('Network.requestWillBeSent', request('secret-' + i));
  assert.equal(diagnostic.snapshot().cap, 200); assert.equal(diagnostic.snapshot().events.length, 200);
  assert.equal(diagnostic.snapshot().dropped, 5); await diagnostic.close();
});

test('normalizes nonfinite, negative, invalid status/error and unknown initiator', async () => {
  const { page, session } = fixture(); const diagnostic = await attachBrowserNetworkDiagnostic(page, { now: () => NaN });
  session.emit('Network.requestWillBeSent', { ...request(), initiator: { type: 'secret', stack: { callFrames: [{ functionName: 'secret' }] } } });
  session.emit('Network.responseReceived', { requestId: 'secret-request', response: { status: Infinity, encodedDataLength: -1 } });
  session.emit('Network.loadingFailed', { requestId: 'secret-request', canceled: 'secret', errorText: 'secret password internal URL' });
  const output = diagnostic.snapshot(); assert.equal(output.events[0].elapsedMs, null);
  assert.equal(output.startedAt,null);
  assert.deepEqual(output.events[0].initiator, { kind: 'other', functions: [] });
  assert.equal(output.events[1].status, null); assert.equal(output.events[1].bytes, null);
  assert.equal(output.events[2].canceled, false); assert.equal(output.events[2].error, 'OTHER_NETWORK_ERROR');
  assert.doesNotMatch(JSON.stringify(output), /secret|password|internal/); await diagnostic.close();
});

test('clock anchors preserve zero and reject negative or nonfinite source clocks without a host fallback',async()=>{
  for(const value of [0,-1,Infinity,NaN]){
    const {page}=fixture(),diagnostic=await attachBrowserNetworkDiagnostic(page,{now:()=>value});
    assert.equal(diagnostic.snapshot().startedAt,value===0?0:null);
    await diagnostic.close();
  }
});

test('finished outcome records bytes but does not replace failed outcome', async () => {
  const { page, session } = fixture(); const diagnostic = await attachBrowserNetworkDiagnostic(page);
  session.emit('Network.requestWillBeSent', request());
  session.emit('Network.loadingFailed', { requestId: 'secret-request', errorText: 'net::ERR_FAILED' });
  session.emit('Network.loadingFinished', { requestId: 'secret-request', encodedDataLength: 0 });
  assert.deepEqual(diagnostic.snapshot().events.slice(1).map(row => row.kind), ['failed', 'finished']);
  assert.equal(diagnostic.snapshot().events[2].bytes, 0); await diagnostic.close();
});

test('async close is idempotent, waits for detach, and rejects private detach errors safely', async () => {
  const { page, session } = fixture(); let release;
  session.detach = () => { session.detachCalls++; return new Promise(resolve => { release = resolve; }); };
  const diagnostic = await attachBrowserNetworkDiagnostic(page);
  const first = diagnostic.close(), second = diagnostic.close();
  assert.equal(diagnostic.snapshot().active, false); assert.equal(diagnostic.snapshot().closed, false);
  release(); await Promise.all([first, second]); assert.equal(session.detachCalls, 1);
  const bad = fixture(); bad.session.detach = async () => { throw Error('secret credential'); };
  const failed = await attachBrowserNetworkDiagnostic(bad.page);
  await assert.rejects(failed.close(), /^Error: CDPDiagnosticDetachFailed$/);
  assert.equal(failed.snapshot().closed, true); assert.equal(failed.snapshot().detached, false);
});

test('setup failure detaches and removes every listener without leaking error contents', async () => {
  const { page, session } = fixture(); session.send = async () => { throw Error('secret credential'); };
  await assert.rejects(attachBrowserNetworkDiagnostic(page), /^Error: CDPDiagnosticAttachFailed$/);
  assert.equal(session.detachCalls, 1); assert.equal(session.eventNames().length, 0);
});

test('serialized attach function works without module closures', async () => {
  const isolated = Function('return (' + attachBrowserNetworkDiagnostic.toString() + ')')();
  const { page, session } = fixture(); const diagnostic = await isolated(page);
  session.emit('Network.requestWillBeSent', request()); assert.equal(diagnostic.snapshot().events.length, 1);
  const copy = diagnostic.snapshot(); copy.events[0].initiator.functions.push('secret');
  assert.deepEqual(diagnostic.snapshot().events[0].initiator.functions, ['createFetch']);
  await diagnostic.close();
});

test('removed correlation does not reuse anonymous request identifiers', async () => {
  const { page, session } = fixture(); const diagnostic = await attachBrowserNetworkDiagnostic(page);
  session.emit('Network.requestWillBeSent', request('a'));
  session.emit('Network.requestWillBeSent', request('a', 'https://secret.example'));
  session.emit('Network.requestWillBeSent', request('b'));
  assert.deepEqual(diagnostic.snapshot().events.map(row => row.request), [1, 2]);
  await diagnostic.close();
});

test('invalid scoped origin and session creation failure report enums only', async () => {
  const { page } = fixture();
  await assert.rejects(attachBrowserNetworkDiagnostic({ ...page, url: () => 'http://secret:password@example.com' }), /^Error: CDPDiagnosticOriginInvalid$/);
  await assert.rejects(attachBrowserNetworkDiagnostic({ ...page, url: () => 'secret-invalid-url' }), /^Error: CDPDiagnosticOriginInvalid$/);
  await assert.rejects(attachBrowserNetworkDiagnostic({ ...page, context: () => ({ newCDPSession: async () => { throw Error('secret credential'); } }) }), /^Error: CDPDiagnosticAttachFailed$/);
});
