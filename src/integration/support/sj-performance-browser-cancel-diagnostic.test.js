'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { installBrowserCancellationDiagnostic } = require('./sj-performance-browser-cancel-diagnostic');

// Pure fake realm: no network/browser/server/DB and no mutation of Node native
// prototypes. These test wrapper semantics, not browser timing transparency.
function fixture() {
  let time = 100, epoch = 1800000000000, stack = '', fetchResult = {}, fetchError = null;
  const calls = [], targets = new WeakMap(), controllers = new WeakMap(), states = new WeakMap(), requests = new WeakMap();
  const cancelResult = { then: () => { throw Error('must not consume result'); } };
  const brand = (map, receiver) => { if (!map.has(receiver)) throw Error('NativeBrandError'); return map.get(receiver); };
  class EventTarget {
    constructor() { targets.set(this, new Map()); }
    addEventListener(name, listener) {
      const target = brand(targets, this); if (!target.has(name)) target.set(name, new Set()); target.get(name).add(listener);
    }
    removeEventListener(name, listener) { brand(targets, this).get(name)?.delete(listener); }
    dispatchEvent(event) { for (const listener of brand(targets, this).get(event.type) ?? []) listener.call(this, event); }
  }
  class AbortSignal extends EventTarget {
    constructor() { super(); states.set(this, false); }
    get aborted() { return brand(states, this); }
    get reason() { throw Error('must not inspect reason'); }
  }
  class AbortController {
    constructor() { controllers.set(this, new AbortSignal()); }
    get signal() { return brand(controllers, this); }
    abort(...args) {
      const signal = brand(controllers, this); calls.push({ kind: 'abort', receiver: this, args });
      if (!states.get(signal)) { states.set(signal, true); signal.dispatchEvent({ type: 'abort' }); }
      return cancelResult;
    }
  }
  class ReadableStream {
    cancel(...args) { calls.push({ kind: 'stream', receiver: this, args }); return cancelResult; }
    getReader() { throw Error('must not acquire reader'); }
  }
  class ReadableStreamDefaultReader {
    cancel(...args) { calls.push({ kind: 'reader', receiver: this, args }); return cancelResult; }
    read() { throw Error('must not read'); }
    releaseLock() { throw Error('must not release reader'); }
  }
  class ReadableStreamBYOBReader { cancel(...args) { calls.push({ kind: 'byob', receiver: this, args }); return cancelResult; } }
  class Request {
    constructor(url, method = 'GET', signal = null) { requests.set(this, { url, method, signal }); }
    get url() { return brand(requests, this).url; }
    get method() { return brand(requests, this).method; }
    get signal() { return brand(requests, this).signal; }
  }
  class DiagnosticError { get stack() { return stack; } }
  const realm = { URL, Request, AbortController, AbortSignal, EventTarget, ReadableStream, ReadableStreamDefaultReader,
    ReadableStreamBYOBReader, Error: DiagnosticError, location: { href: 'http://127.0.0.1:4411/katalog' },
    performance: { now: () => time }, Date: { now: () => epoch },
    fetch(...args) { calls.push({ kind: 'fetch', receiver: this, args }); if (fetchError) throw fetchError; return fetchResult; } };
  return { realm, calls, cancelResult, setTime: value => { time = value; }, setEpoch: value => { epoch = value; },
    setStack: value => { stack = value; },
    setFetchResult: value => { fetchResult = value; }, setFetchError: value => { fetchError = value; },
    listenerCount: signal => brand(targets, signal).get('abort')?.size ?? 0 };
}

test('preserves native receiver, arguments and return/promise identity without consuming bodies', () => {
  const f = fixture(), originals = { fetch: f.realm.fetch, stream: f.realm.ReadableStream.prototype.cancel,
    reader: f.realm.ReadableStreamDefaultReader.prototype.cancel, byob: f.realm.ReadableStreamBYOBReader.prototype.cancel };
  const diagnostic = installBrowserCancellationDiagnostic({}, f.realm);
  assert.equal(diagnostic.snapshot().startedAt, 1800000000000);
  const receiver = {}, init = { method: 'GET', headers: { Authorization: 'secret' } }, reason = { secret: 'reason' };
  const result = {}; Object.defineProperty(result, 'then', { get() { throw Error('must not inspect promise'); } });
  f.setFetchResult(result);
  assert.equal(f.realm.fetch.call(receiver, '/katalog?cursor=secret', init), result);
  assert.equal(new f.realm.ReadableStream().cancel(reason), f.cancelResult);
  assert.equal(new f.realm.ReadableStreamDefaultReader().cancel(reason), f.cancelResult);
  assert.equal(new f.realm.ReadableStreamBYOBReader().cancel(reason), f.cancelResult);
  assert.equal(f.calls[0].receiver, receiver); assert.deepEqual(f.calls[0].args, ['/katalog?cursor=secret', init]);
  for (const call of f.calls.slice(1)) assert.equal(call.args[0], reason);
  assert.deepEqual(diagnostic.snapshot().events.map(event => event.kind),
    ['fetch-call', 'stream-cancel-call', 'reader-cancel-call', 'byob-reader-cancel-call']);
  assert.doesNotMatch(JSON.stringify(diagnostic.snapshot()), /secret|Authorization|127\.0\.0\.1|cursor/);
  diagnostic.close();
  assert.equal(f.realm.fetch, originals.fetch); assert.equal(f.realm.ReadableStream.prototype.cancel, originals.stream);
  assert.equal(f.realm.ReadableStreamDefaultReader.prototype.cancel, originals.reader);
  assert.equal(f.realm.ReadableStreamBYOBReader.prototype.cancel, originals.byob);
});

test('correlates one signal reused by multiple catalog fetches and removes its exact listener', () => {
  const f = fixture(), controller = new f.realm.AbortController();
  const diagnostic = installBrowserCancellationDiagnostic({}, f.realm);
  f.realm.fetch('/katalog?cursor=secret', { signal: controller.signal });
  f.realm.fetch('/katalog', { signal: controller.signal });
  assert.equal(f.listenerCount(controller.signal), 1);
  f.setTime(110); assert.equal(controller.abort({ secret: true }), f.cancelResult);
  const events = diagnostic.snapshot().events;
  assert.deepEqual(events.map(event => event.kind), ['fetch-call', 'fetch-call', 'abort-controller-call', 'signal-abort']);
  assert.deepEqual(events[2].requests, [1, 2]); assert.deepEqual(events[3].requests, [1, 2]);
  assert.equal(events[2].signalAlreadyAborted, false); assert.equal(events[3].aborted, true); assert.equal(events[3].elapsedMs, 10);
  const copy = diagnostic.snapshot(); copy.events[2].requests.push(999); copy.events[0].callsites.push({ secret: true });
  assert.deepEqual(diagnostic.snapshot().events[2].requests, [1, 2]); assert.deepEqual(diagnostic.snapshot().events[0].callsites, []);
  const closed = diagnostic.close(); assert.equal(closed.closed, true); assert.equal(closed.active, false);
  assert.equal(closed.observedSignals, 0); assert.equal(closed.restoreFailures, 0); assert.equal(closed.listenerFailures, 0);
  assert.equal(f.listenerCount(controller.signal), 0); assert.deepEqual(diagnostic.close(), closed);
});

test('native Request getters are supported without custom coercion and undefined init signal preserves request observation', () => {
  const f = fixture(), controller = new f.realm.AbortController();
  const diagnostic = installBrowserCancellationDiagnostic({}, f.realm);
  const request = new f.realm.Request('http://127.0.0.1:4411/katalog', 'GET', controller.signal);
  Object.defineProperty(request, 'url', { get() { throw Error('custom getter must not be read'); } });
  request.toString = () => { throw Error('must not coerce Request'); };
  f.realm.fetch(request, { signal: undefined }); controller.abort();
  assert.equal(diagnostic.snapshot().events[0].signalObserved, true);
  assert.equal(diagnostic.snapshot().events[2].kind, 'signal-abort'); diagnostic.close();
});

test('native URL input used by Next createFetch is observed without custom href/toString access', () => {
  const f = fixture(), controller = new f.realm.AbortController();
  const diagnostic = installBrowserCancellationDiagnostic({}, f.realm);
  const url = new URL('http://127.0.0.1:4411/katalog?cursor=secret');
  Object.defineProperty(url, 'href', { get() { throw Error('custom href must not be read'); } });
  url.toString = () => { throw Error('must not coerce URL'); };
  f.realm.fetch(url, { signal: controller.signal }); controller.abort();
  assert.equal(diagnostic.snapshot().events[0].signalObserved, true);
  assert.equal(diagnostic.snapshot().events[2].kind, 'signal-abort'); diagnostic.close();
});

test('does not invoke init accessors, custom input coercion, or inspect body/header/reason properties', () => {
  const f = fixture(); let getters = 0, coercions = 0;
  const diagnostic = installBrowserCancellationDiagnostic({}, f.realm);
  const init = { body: { get secret() { throw Error('body inspection'); } } };
  Object.defineProperty(init, 'method', { get() { getters++; return 'GET'; } });
  f.realm.fetch('/katalog', init);
  f.realm.fetch({ toString() { coercions++; return '/katalog'; } });
  assert.equal(getters, 0); assert.equal(coercions, 0); assert.deepEqual(diagnostic.snapshot().events, []);
  diagnostic.close();
});

test('captures only same-origin GET catalog calls; unknown init prototypes and credential URLs are omitted', () => {
  const f = fixture(), diagnostic = installBrowserCancellationDiagnostic({}, f.realm);
  for (const [url, init] of [['https://secret.example/katalog'], ['/private?password=secret'], ['/katalog', { method: 'POST' }],
    ['http://secret:password@127.0.0.1:4411/katalog'], ['/katalog', Object.create({ method: 'GET' })]]) f.realm.fetch(url, init);
  assert.deepEqual(diagnostic.snapshot().events, []);
  f.realm.fetch('/katalog', { method: 'get', signal: null });
  assert.equal(diagnostic.snapshot().events.length, 1); assert.equal(diagnostic.snapshot().events[0].signalPresent, false);
  diagnostic.close();
});

test('retains only a bounded same-origin static chunk fingerprint and numeric positions, never raw stacks/URLs', () => {
  const f = fixture(); f.setStack(['Error secret',
    ' at abort (http://127.0.0.1:4411/_next/static/chunks/app/katalog/page-secret.js?token=secret:12:7)',
    ' at foreign (https://secret.example/_next/static/chunks/abc.js:1:2)',
    ' at private (http://127.0.0.1:4411/private/secret.js:4:5)',
    ' at file (C:/secret/password.js:4:5)',
    ' at bad (http://secret:password@127.0.0.1:4411/_next/static/chunks/abc.js:1:2)',
    ' at duplicate (http://127.0.0.1:4411/_next/static/chunks/app/katalog/page-secret.js:12:7)',
  ].join('\n'));
  const diagnostic = installBrowserCancellationDiagnostic({}, f.realm); f.realm.fetch('/katalog');
  const sites = diagnostic.snapshot().events[0].callsites;
  assert.equal(sites.length, 1); assert.match(sites[0].chunkPathFingerprint, /^fnv1a64-[0-9a-f]{16}$/);
  assert.equal(sites[0].line, 12); assert.equal(sites[0].column, 7);
  assert.doesNotMatch(JSON.stringify(diagnostic.snapshot()), /secret|password|127\.0\.0\.1|https?:|\.js|stack|token/);
  diagnostic.close();
});

test('preserves native exceptions exactly and diagnostic inspection errors cannot replace them', () => {
  const f = fixture(), diagnostic = installBrowserCancellationDiagnostic({}, f.realm), nativeError = { secret: true };
  f.setFetchError(nativeError);
  const init = new Proxy({}, { getPrototypeOf() { throw Error('diagnostic trap'); } });
  assert.throws(() => f.realm.fetch('/katalog', init), error => error === nativeError);
  assert.throws(() => f.realm.AbortController.prototype.abort.call({}), /^Error: NativeBrandError$/);
  diagnostic.close();
});

test('already-aborted signal is identified without reading reason or inventing a new abort event', () => {
  const f = fixture(), controller = new f.realm.AbortController(); controller.abort('secret reason');
  const diagnostic = installBrowserCancellationDiagnostic({}, f.realm);
  f.realm.fetch('/katalog', { signal: controller.signal }); controller.abort('secret reason');
  assert.equal(diagnostic.snapshot().events[0].signalAlreadyAborted, true);
  assert.equal(diagnostic.snapshot().events[1].signalAlreadyAborted, true);
  assert.deepEqual(diagnostic.snapshot().events.map(event => event.kind), ['fetch-call', 'abort-controller-call']);
  diagnostic.close();
});

test('unassociated abort/cancel calls are explicitly not attributed to a catalog body', () => {
  const f = fixture(), diagnostic = installBrowserCancellationDiagnostic({}, f.realm);
  new f.realm.AbortController().abort('secret'); new f.realm.ReadableStreamDefaultReader().cancel('secret');
  for (const event of diagnostic.snapshot().events) {
    assert.equal(event.scope, 'unassociated'); assert.equal('request' in event, false); assert.equal('requests' in event, false);
  }
  assert.doesNotMatch(JSON.stringify(diagnostic.snapshot()), /secret|success|expected/); diagnostic.close();
});

test('event and signal tracking are bounded; closed diagnostics stop recording and remove listeners', () => {
  const f = fixture(), diagnostic = installBrowserCancellationDiagnostic({ maxEvents: 10000 }, f.realm), controllers = [];
  for (let index = 0; index < 205; index++) {
    const controller = new f.realm.AbortController(); controllers.push(controller);
    f.realm.fetch('/katalog?secret=' + index, { signal: controller.signal });
  }
  assert.equal(diagnostic.snapshot().cap, 200); assert.equal(diagnostic.snapshot().events.length, 200);
  assert.equal(diagnostic.snapshot().observedSignals, 200); assert.equal(diagnostic.snapshot().dropped, 5);
  const closed = diagnostic.close(); for (const controller of controllers) assert.equal(f.listenerCount(controller.signal), 0);
  f.realm.fetch('/katalog'); controllers[0].abort(); assert.deepEqual(diagnostic.snapshot(), closed);
});

test('cleanup restores exact property descriptors only when the installed wrapper still owns them', () => {
  const f = fixture(), before = Object.getOwnPropertyDescriptor(f.realm, 'fetch');
  const diagnostic = installBrowserCancellationDiagnostic({}, f.realm), foreign = function () { return 'foreign'; };
  f.realm.fetch = foreign;
  const closed = diagnostic.close(); assert.equal(closed.restoreFailures, 1); assert.equal(f.realm.fetch, foreign);
  const g = fixture(), original = Object.getOwnPropertyDescriptor(g.realm, 'fetch');
  const second = installBrowserCancellationDiagnostic({}, g.realm); second.close();
  assert.deepEqual(Object.getOwnPropertyDescriptor(g.realm, 'fetch'), original); assert.equal(before.writable, true);
});

test('cleanup preserves foreign descriptor-attribute changes rather than overwriting them', () => {
  const f = fixture(), diagnostic = installBrowserCancellationDiagnostic({}, f.realm);
  Object.defineProperty(f.realm, 'fetch', { enumerable: false });
  assert.equal(diagnostic.close().restoreFailures, 1);
  assert.equal(Object.getOwnPropertyDescriptor(f.realm, 'fetch').enumerable, false);
});

test('partial install failure restores prior wrappers and exposes only a static error code', () => {
  const f = fixture(), originalFetch = f.realm.fetch, originalAbort = f.realm.AbortController.prototype.abort;
  Object.defineProperty(f.realm.ReadableStream.prototype, 'cancel', { value: function () {}, writable: false, configurable: false });
  assert.throws(() => installBrowserCancellationDiagnostic({}, f.realm), /^Error: BrowserCancelDiagnosticInstallFailed$/);
  assert.equal(f.realm.fetch, originalFetch); assert.equal(f.realm.AbortController.prototype.abort, originalAbort);
});

test('unsupported realm or credential origin is rejected before patches are installed', () => {
  const f = fixture(), original = f.realm.fetch;
  f.realm.location.href = 'http://secret:password@127.0.0.1:4411/katalog';
  assert.throws(() => installBrowserCancellationDiagnostic({}, f.realm), /^Error: BrowserCancelDiagnosticUnsupported$/);
  assert.equal(f.realm.fetch, original);
});

test('self-contained factory survives serialization without module closures', () => {
  const isolated = Function('return (' + installBrowserCancellationDiagnostic.toString() + ')')();
  const f = fixture(), diagnostic = isolated({}, f.realm);
  f.realm.fetch('/katalog'); assert.equal(diagnostic.snapshot().events[0].kind, 'fetch-call');
  assert.equal(diagnostic.close().restoreFailures, 0);
});

test('duplicate installation is rejected before creating nested wrappers', () => {
  const f = fixture(), original = f.realm.fetch, diagnostic = installBrowserCancellationDiagnostic({}, f.realm);
  const wrapped = f.realm.fetch;
  assert.throws(() => installBrowserCancellationDiagnostic({}, f.realm), /^Error: BrowserCancelDiagnosticAlreadyInstalled$/);
  assert.equal(f.realm.fetch, wrapped); assert.equal(diagnostic.close().restoreFailures, 0);
  assert.equal(f.realm.fetch, original);
});

test('foreign fetch replacement cannot hide remaining owned prototype wrappers from duplicate refusal', () => {
  const f = fixture(), originalAbort = f.realm.AbortController.prototype.abort;
  const originalStream = f.realm.ReadableStream.prototype.cancel;
  const originalReader = f.realm.ReadableStreamDefaultReader.prototype.cancel;
  const originalByob = f.realm.ReadableStreamBYOBReader.prototype.cancel;
  const first = installBrowserCancellationDiagnostic({}, f.realm), foreign = function () { return 'foreign'; };
  f.realm.fetch = foreign;
  const before = [f.realm.fetch, f.realm.AbortController.prototype.abort, f.realm.ReadableStream.prototype.cancel,
    f.realm.ReadableStreamDefaultReader.prototype.cancel, f.realm.ReadableStreamBYOBReader.prototype.cancel];
  assert.throws(() => installBrowserCancellationDiagnostic({}, f.realm), /^Error: BrowserCancelDiagnosticAlreadyInstalled$/);
  assert.deepEqual([f.realm.fetch, f.realm.AbortController.prototype.abort, f.realm.ReadableStream.prototype.cancel,
    f.realm.ReadableStreamDefaultReader.prototype.cancel, f.realm.ReadableStreamBYOBReader.prototype.cancel], before);
  const closed = first.close(); assert.equal(closed.restoreFailures, 1); assert.equal(f.realm.fetch, foreign);
  assert.equal(f.realm.AbortController.prototype.abort, originalAbort);
  assert.equal(f.realm.ReadableStream.prototype.cancel, originalStream);
  assert.equal(f.realm.ReadableStreamDefaultReader.prototype.cancel, originalReader);
  assert.equal(f.realm.ReadableStreamBYOBReader.prototype.cancel, originalByob);
});

test('invalid clocks and failed stack inspection are normalized without native behavior changes', () => {
  const f = fixture(); f.realm.performance.now = () => NaN;
  f.setEpoch(Infinity);
  f.realm.Error = class { get stack() { throw Error('secret'); } };
  const diagnostic = installBrowserCancellationDiagnostic({ maxEvents: 1 }, f.realm); f.realm.fetch('/katalog');
  assert.equal(diagnostic.snapshot().startedAt, null);
  assert.equal(diagnostic.snapshot().events[0].elapsedMs, null); assert.deepEqual(diagnostic.snapshot().events[0].callsites, []);
  f.realm.fetch('/katalog'); assert.equal(diagnostic.snapshot().dropped, 1); diagnostic.close();
});

// Isolated native Promise realm plus branded primitive doubles. No global Node
// Response/Stream/Promise prototype is patched and no stream/network is opened.
function ownershipFixture({ byob = true } = {}) {
  const f = fixture(), PromiseClass = vm.runInNewContext('Promise');
  const states = new WeakMap(), nativeCalls = [];
  const state = receiver => { if (!states.has(receiver)) throw Error('NativeBrandError'); return states.get(receiver); };
  const perform = (receiver, kind, args) => {
    const current = state(receiver), row = { receiver, kind, args };
    nativeCalls.push(row);
    if (current.errors?.[kind]) throw current.errors[kind];
    row.result = current.results?.[kind]; return row.result;
  };
  class Reader {
    constructor() { states.set(this, { results: { read: PromiseClass.resolve({ done: false }), cancel: PromiseClass.resolve(), closed: PromiseClass.resolve(), releaseLock: undefined } }); }
    read(...args) { return perform(this, 'read', args); }
    cancel(...args) { return perform(this, 'cancel', args); }
    releaseLock(...args) { return perform(this, 'releaseLock', args); }
    get closed() { return perform(this, 'closed', []); }
  }
  // Separate native-own descriptors, not inherited copies.
  class ByobReader {
    constructor() { states.set(this, { results: { read: PromiseClass.resolve({ done: false }), cancel: PromiseClass.resolve(), closed: PromiseClass.resolve(), releaseLock: undefined } }); }
    read(...args) { return perform(this, 'read', args); }
    cancel(...args) { return perform(this, 'cancel', args); }
    releaseLock(...args) { return perform(this, 'releaseLock', args); }
    get closed() { return perform(this, 'closed', []); }
  }
  class Stream {
    constructor(reader = new Reader()) { states.set(this, { results: { getReader: reader, cancel: PromiseClass.resolve(), tee: [] } }); }
    getReader(...args) { return perform(this, 'getReader', args); }
    cancel(...args) { return perform(this, 'cancel', args); }
    tee(...args) { return perform(this, 'tee', args); }
  }
  class Response {
    constructor(body = new Stream()) { states.set(this, { results: { body, clone: null } }); }
    get body() { return perform(this, 'body', []); }
    clone(...args) { return perform(this, 'clone', args); }
  }
  Object.assign(f.realm, { Promise: PromiseClass, Response, ReadableStream: Stream, ReadableStreamDefaultReader: Reader });
  if (byob) f.realm.ReadableStreamBYOBReader = ByobReader; else delete f.realm.ReadableStreamBYOBReader;
  const setResult = (receiver, kind, value) => { state(receiver).results[kind] = value; };
  const setError = (receiver, kind, value) => { state(receiver).errors = { ...state(receiver).errors, [kind]: value }; };
  const deferred = () => { let resolve, reject; const promise = new PromiseClass((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
  const flush = async () => { await PromiseClass.resolve(); await PromiseClass.resolve(); };
  const associate = async (diagnostic, response = new Response(), path = '/katalog') => {
    const promise = PromiseClass.resolve(response); f.setFetchResult(promise);
    assert.equal(f.realm.fetch(path), promise); await flush(); return response;
  };
  return { ...f, PromiseClass, nativeCalls, state, setResult, setError, deferred, flush, associate };
}

test('ownership is explicit opt-in; default mode adds no response/read wrappers or reactions', async () => {
  const f = ownershipFixture(), response = new f.realm.Response(), body = response.body;
  f.nativeCalls.length = 0;
  const before = Object.getOwnPropertyDescriptors(f.realm.Response.prototype);
  const readerBefore = f.realm.ReadableStreamDefaultReader.prototype.read;
  const diagnostic = installBrowserCancellationDiagnostic({}, f.realm);
  const promise = f.PromiseClass.resolve(response); f.setFetchResult(promise);
  assert.equal(f.realm.fetch('/katalog'), promise); await f.flush();
  assert.deepEqual(f.nativeCalls, []); assert.deepEqual(Object.getOwnPropertyDescriptors(f.realm.Response.prototype), before);
  assert.equal(f.realm.ReadableStreamDefaultReader.prototype.read, readerBefore);
  assert.equal('responses' in diagnostic.snapshot(), false); assert.equal(response.body, body);
  diagnostic.close();
});

test('concurrent fetches keep native promise/object identity and independent response/body/reader lineage', async () => {
  const f = ownershipFixture(), first = new f.realm.Response(), second = new f.realm.Response();
  const a = f.deferred(), b = f.deferred(), receiver = {};
  const diagnostic = installBrowserCancellationDiagnostic({ trackResponseStreams: true }, f.realm);
  f.setFetchResult(a.promise); assert.equal(f.realm.fetch.call(receiver, '/katalog?token=secret-a'), a.promise);
  f.setFetchResult(b.promise); assert.equal(f.realm.fetch('/katalog?token=secret-b'), b.promise);
  b.resolve(second); await f.flush(); a.resolve(first); await f.flush();
  assert.deepEqual(f.nativeCalls, []); // Observer never obtains a body itself.
  const firstStream = first.body, secondStream = second.body;
  const options = {}; Object.defineProperty(options, 'mode', { get() { throw Error('must not inspect reader options'); } });
  const firstReader = firstStream.getReader(options), secondReader = secondStream.getReader();
  assert.equal(firstStream, f.state(first).results.body); assert.equal(firstReader, f.state(firstStream).results.getReader);
  assert.equal(f.nativeCalls[2].args[0], options); assert.equal(f.calls[0].receiver, receiver);
  const output = diagnostic.snapshot();
  assert.deepEqual(output.responses.map(row => row.requests), [[2], [1]]);
  assert.deepEqual(output.readers.map(row => row.requests), [[1], [2]]);
  assert.notEqual(firstReader, secondReader); assert.deepEqual(output.readers.map(row => row.stream), [1, 2]);
  assert.equal(output.readers.some(row => 'closedAccesses' in row), false);
  assert.doesNotMatch(JSON.stringify(output), /secret|token|127\.0\.0\.1|https?:|password/);
  const copy = diagnostic.snapshot(); copy.responses[0].requests.push(99);
  assert.deepEqual(diagnostic.snapshot().responses[0].requests, [2]); diagnostic.close();
});

test('clone and tee add only actual directed lineage edges without acquiring or reading bodies', async () => {
  const f = ownershipFixture(), diagnostic = installBrowserCancellationDiagnostic({ trackResponseStreams: true }, f.realm);
  const response = await f.associate(diagnostic), cloned = new f.realm.Response();
  f.setResult(response, 'clone', cloned); assert.equal(response.clone('native-extra'), cloned);
  assert.deepEqual(f.nativeCalls.map(row => row.kind), ['clone']);
  const body = cloned.body, branches = [new f.realm.ReadableStream(), new f.realm.ReadableStream()];
  f.setResult(body, 'tee', branches); assert.equal(body.tee('native-extra'), branches);
  const left = branches[0].getReader(), right = branches[1].getReader();
  assert.equal(f.nativeCalls.filter(row => row.kind === 'read' || row.kind === 'closed').length, 0);
  const output = diagnostic.snapshot();
  assert.deepEqual(output.responses.map(row => row.requests), [[1], [1]]);
  assert.equal(output.responses[1].cloneOf, 1); assert.equal(output.streams[0].response, 2);
  assert.deepEqual(output.streams.slice(1).map(row => row.teeOf), [1, 1]);
  assert.deepEqual(output.readers.map(row => row.requests), [[1], [1]]); assert.notEqual(left, right);
  assert.equal(output.events.find(row => row.kind === 'response-clone').cloneOf, 1);
  assert.deepEqual(output.events.filter(row => row.kind === 'stream-tee-branch').map(row => row.teeOf), [1, 1]);
  diagnostic.close();
});

test('unrelated/null-body objects stay unassociated; BYOB receiver/arguments/returns remain native', async () => {
  const f = ownershipFixture(), diagnostic = installBrowserCancellationDiagnostic({ trackResponseStreams: true }, f.realm);
  const nullResponse = await f.associate(diagnostic, new f.realm.Response(null)); assert.equal(nullResponse.body, null);
  const unrelated = await f.associate(diagnostic, new f.realm.Response(), '/private?secret=canary');
  const foreign = unrelated.body.getReader(); await foreign.cancel('secret-reason');
  assert.equal(diagnostic.snapshot().readers.length, 0);
  const byob = new f.realm.ReadableStreamBYOBReader(), response = new f.realm.Response(new f.realm.ReadableStream(byob));
  await f.associate(diagnostic, response); assert.equal(response.body.getReader({ mode: 'byob' }), byob);
  const buffer = new Uint8Array([1,2]), promise = f.PromiseClass.resolve({ done: false, value: buffer });
  f.setResult(byob, 'read', promise); assert.equal(byob.read(buffer, { min: 1 }), promise); await f.flush();
  const read = f.nativeCalls.find(row => row.kind === 'read'); assert.equal(read.receiver, byob); assert.equal(read.args[0], buffer);
  assert.equal(diagnostic.snapshot().readers[0].kind, 'byob'); assert.equal(diagnostic.snapshot().readers[0].doneFalse, 1);
  assert.equal(diagnostic.snapshot().events.find(row => row.kind === 'response-body-access').bodyNull, true);
  assert.equal(diagnostic.snapshot().events.find(row => row.kind === 'reader-cancel-call').scope, 'unassociated');
  diagnostic.close();
});

test('read done, closed, releaseLock and cancel outcomes are distinct and never inspect payload/reason getters', async () => {
  const f = ownershipFixture(), diagnostic = installBrowserCancellationDiagnostic({ trackResponseStreams: true }, f.realm);
  const response = await f.associate(diagnostic), reader = response.body.getReader(); let valueAccess = 0, reasonAccess = 0;
  const result = done => Object.defineProperty({ done }, 'value', { get() { valueAccess++; throw Error('secret-body'); } });
  for (const done of [false, true]) { const promise = f.PromiseClass.resolve(result(done)); f.setResult(reader, 'read', promise); assert.equal(reader.read('native-extra'), promise); await f.flush(); }
  const closed = f.state(reader).results.closed; assert.equal(reader.closed, closed); assert.equal(reader.closed, closed); await f.flush();
  assert.equal(reader.releaseLock('native-extra'), undefined);
  const reason = {}; Object.defineProperty(reason, 'name', { get() { reasonAccess++; throw Error('secret-reason'); } });
  const cancel = f.PromiseClass.reject(reason); f.setResult(reader, 'cancel', cancel); assert.equal(reader.cancel(reason), cancel); await f.flush();
  const output = diagnostic.snapshot(), row = output.readers[0];
  assert.equal(row.readCalls, 2); assert.equal(row.readResolved, 2); assert.equal(row.doneFalse, 1); assert.equal(row.doneTrue, 1);
  assert.equal(row.closedAccesses, 2); assert.equal(row.closedFulfilled, 1); assert.equal(row.releaseLockReturned, 1);
  assert.equal(row.cancelCalls, 1); assert.equal(row.cancelRejected, 1); assert.equal('cancelFulfilled' in row, false);
  assert.equal(valueAccess, 0); assert.equal(reasonAccess, 0); assert.equal(f.nativeCalls.filter(row => row.kind === 'closed').length, 2);
  assert.doesNotMatch(JSON.stringify(output), /secret|native-extra/); diagnostic.close();
});

test('read/accessor unknown and promise rejection cannot manufacture EOF or leak error detail', async () => {
  const f = ownershipFixture(), diagnostic = installBrowserCancellationDiagnostic({ trackResponseStreams: true }, f.realm);
  const response = await f.associate(diagnostic), reader = response.body.getReader(); let accessed = 0;
  const unknown = {}; Object.defineProperty(unknown, 'done', { get() { accessed++; return true; } });
  f.setResult(reader, 'read', f.PromiseClass.resolve(unknown)); await reader.read(); await f.flush();
  const error = new TypeError('secret-password-internal-path');
  const rejected = f.PromiseClass.reject(error); f.setResult(reader, 'read', rejected); assert.equal(reader.read(), rejected); await f.flush();
  const closed = f.PromiseClass.reject(error); f.setResult(reader, 'closed', closed); assert.equal(reader.closed, closed); await f.flush();
  const row = diagnostic.snapshot().readers[0]; assert.equal(row.readUnknown, 1); assert.equal(row.readRejected, 1); assert.equal(row.closedRejected, 1);
  assert.equal('doneTrue' in row, false); assert.equal(accessed, 0);
  assert.equal(diagnostic.snapshot().events.find(row => row.kind === 'reader-read-rejected').error, 'TypeError');
  assert.doesNotMatch(JSON.stringify(diagnostic.snapshot()), /secret|password|internal-path/); diagnostic.close();
});

test('native synchronous throw identity/call count is preserved; errors add no false clone/tee/reader edges', async () => {
  const f = ownershipFixture(), diagnostic = installBrowserCancellationDiagnostic({ trackResponseStreams: true }, f.realm);
  const response = await f.associate(diagnostic), body = response.body, reader = body.getReader(), error = { canary: 'secret' };
  for (const [receiver, kind, args] of [[response,'clone',[]],[body,'tee',[]],[body,'getReader',[]],[reader,'read',[1]],[reader,'cancel',[error]],[reader,'releaseLock',[]]]) {
    f.setError(receiver, kind, error); const count = f.nativeCalls.length;
    assert.throws(() => receiver[kind](...args), value => value === error); assert.equal(f.nativeCalls.length, count + 1);
    assert.equal(f.nativeCalls.at(-1).receiver, receiver); assert.deepEqual(f.nativeCalls.at(-1).args, args);
  }
  const output = diagnostic.snapshot(); assert.equal(output.responses.length, 1); assert.equal(output.streams.length, 1); assert.equal(output.readers.length, 1);
  assert.equal(output.readers[0].readThrew, 1); assert.equal(output.readers[0].cancelThrew, 1); assert.equal(output.readers[0].releaseLockThrew, 1);
  assert.equal('doneTrue' in output.readers[0], false); assert.equal('cancelFulfilled' in output.readers[0], false);
  f.setError(response, 'body', error); assert.throws(() => response.body, value => value === error);
  assert.doesNotMatch(JSON.stringify(output), /secret|canary/); diagnostic.close();
});

test('unsupported/custom promises and species are refused without custom then/constructor/getter access', async () => {
  const f = ownershipFixture(), diagnostic = installBrowserCancellationDiagnostic({ trackResponseStreams: true }, f.realm); let getters = 0;
  const custom = {}; Object.defineProperty(custom, 'then', { get() { getters++; throw Error('secret'); } });
  f.setFetchResult(custom); assert.equal(f.realm.fetch('/katalog'), custom);
  const native = f.PromiseClass.resolve(new f.realm.Response());
  Object.defineProperty(native, 'constructor', { get() { getters++; throw Error('secret'); } });
  f.setFetchResult(native); assert.equal(f.realm.fetch('/katalog'), native);
  const original = Object.getOwnPropertyDescriptor(f.PromiseClass, Symbol.species);
  Object.defineProperty(f.PromiseClass, Symbol.species, { configurable: true, get() { getters++; throw Error('secret'); } });
  const later = new f.PromiseClass(resolve => resolve(new f.realm.Response())); f.setFetchResult(later); assert.equal(f.realm.fetch('/katalog'), later);
  Object.defineProperty(f.PromiseClass, Symbol.species, original); await f.flush();
  assert.equal(getters, 0); assert.equal(diagnostic.snapshot().unsupportedPromises, 3); assert.equal(diagnostic.snapshot().responses.length, 0);
  diagnostic.close();
});

test('ownership and event caps remain explicit while sequential reads beyond 200 retain their actual EOF', async () => {
  const f = ownershipFixture(), diagnostic = installBrowserCancellationDiagnostic({ trackResponseStreams: true }, f.realm);
  const shared = new f.realm.Response();
  for (let index = 0; index < 18; index++) await f.associate(diagnostic, shared);
  const body = shared.body, reader = body.getReader();
  for (let index = 0; index < 205; index++) { reader.read(); await f.flush(); }
  f.setResult(reader, 'read', f.PromiseClass.resolve({ done: true }));
  await reader.read(); await f.flush();
  const output = diagnostic.snapshot(); assert.equal(output.lineageCap, 16); assert.equal(output.responses[0].requests.length, 16);
  assert.equal(output.responses[0].lineageTruncated, true); assert.equal(output.streams[0].lineageTruncated, true); assert.ok(output.ownershipDropped >= 2);
  // The cap bounds simultaneous pending observers, not the lifetime number of
  // chunks. No EOF is fabricated or lost just because a response is long.
  assert.equal(output.promiseObservations, 224); assert.equal(output.pendingPromiseObservations, 0);
  assert.equal(output.promiseObservationDrops, 0); assert.equal(output.readers[0].readCalls, 206);
  assert.equal(output.readers[0].doneFalse, 205); assert.equal(output.readers[0].doneTrue, 1);
  assert.equal('readUnobserved' in output.readers[0], false); assert.ok(output.events.length <= 200); diagnostic.close();
  const limited = ownershipFixture(), small = installBrowserCancellationDiagnostic({ trackResponseStreams: true, maxEvents: 2 }, limited.realm);
  await limited.associate(small); await limited.associate(small);
  assert.equal(small.snapshot().events.length, 2); assert.ok(small.snapshot().dropped > 0); small.close();
});

test('only simultaneous pending reactions are capped; dropped reads are explicit and settlement frees capacity', async () => {
  const f = ownershipFixture(), diagnostic = installBrowserCancellationDiagnostic({ trackResponseStreams: true }, f.realm);
  const response = await f.associate(diagnostic), reader = response.body.getReader();
  const pending = f.deferred(); f.setResult(reader, 'read', pending.promise);
  for (let index = 0; index < 205; index++) assert.equal(reader.read(), pending.promise);
  const saturated = diagnostic.snapshot();
  assert.equal(saturated.pendingPromiseObservations, saturated.cap);
  assert.equal(saturated.promiseObservations, 201); // One fetch plus 200 read observers.
  assert.equal(saturated.promiseObservationDrops, 5);
  assert.equal(saturated.readers[0].readCalls, 205); assert.equal(saturated.readers[0].readUnobserved, 5);
  assert.equal('readResolved' in saturated.readers[0], false); assert.equal('doneTrue' in saturated.readers[0], false);
  pending.resolve({ done: false }); await f.flush();
  const settled = diagnostic.snapshot();
  assert.equal(settled.pendingPromiseObservations, 0); assert.equal(settled.readers[0].readResolved, 200);
  assert.equal(settled.readers[0].doneFalse, 200); assert.equal('doneTrue' in settled.readers[0], false);
  f.setResult(reader, 'read', f.PromiseClass.resolve({ done: true }));
  await reader.read(); await f.flush();
  const final = diagnostic.snapshot();
  assert.equal(final.pendingPromiseObservations, 0); assert.equal(final.promiseObservations, 202);
  assert.equal(final.promiseObservationDrops, 5); assert.equal(final.readers[0].readUnobserved, 5);
  assert.equal(final.readers[0].readResolved, 201); assert.equal(final.readers[0].doneTrue, 1);
  assert.equal(diagnostic.close().restoreFailures, 0);
});

test('exact descriptors restore, foreign replacements persist, optional BYOB absence is supported', async () => {
  const f = ownershipFixture({ byob: false }), proto = f.realm.Response.prototype;
  const before = Object.getOwnPropertyDescriptors(proto), diagnostic = installBrowserCancellationDiagnostic({ trackResponseStreams: true }, f.realm);
  await f.associate(diagnostic); const closed = diagnostic.close(); assert.equal(closed.restoreFailures, 0);
  assert.deepEqual(Object.getOwnPropertyDescriptors(proto), before); assert.deepEqual(diagnostic.close(), closed);
  const second = installBrowserCancellationDiagnostic({ trackResponseStreams: true }, f.realm), foreign = function () { return null; };
  Object.defineProperty(proto, 'body', { configurable: true, enumerable: false, get: foreign });
  assert.equal(second.close().restoreFailures, 1); assert.equal(Object.getOwnPropertyDescriptor(proto, 'body').get, foreign);
});

test('ownership partial installation rollback and saved references never acquire guessed lineage', async () => {
  const f = ownershipFixture(), originalFetch = f.realm.fetch, originalBody = Object.getOwnPropertyDescriptor(f.realm.Response.prototype, 'body');
  Object.defineProperty(f.realm.ReadableStreamDefaultReader.prototype, 'closed', { configurable: false, get() { throw Error('secret'); } });
  assert.throws(() => installBrowserCancellationDiagnostic({ trackResponseStreams: true }, f.realm), /^Error: BrowserCancelDiagnosticInstallFailed$/);
  assert.equal(f.realm.fetch, originalFetch); assert.deepEqual(Object.getOwnPropertyDescriptor(f.realm.Response.prototype, 'body'), originalBody);
  const g = ownershipFixture(), savedBody = Object.getOwnPropertyDescriptor(g.realm.Response.prototype, 'body').get;
  const diagnostic = installBrowserCancellationDiagnostic({ trackResponseStreams: true }, g.realm), response = await g.associate(diagnostic);
  const body = Reflect.apply(savedBody, response, []); body.getReader().cancel('secret');
  assert.equal(diagnostic.snapshot().streams.length, 0); assert.equal(diagnostic.snapshot().readers.length, 0);
  assert.equal(diagnostic.snapshot().events.find(row => row.kind === 'reader-cancel-call').scope, 'unassociated'); diagnostic.close();
});

test('pending settlements after close do not record or reattach; observer exceptions add no unhandled rejection', async () => {
  const f = ownershipFixture(), pending = f.deferred(), diagnostic = installBrowserCancellationDiagnostic({ trackResponseStreams: true }, f.realm);
  f.setFetchResult(pending.promise); assert.equal(f.realm.fetch('/katalog'), pending.promise);
  const closed = diagnostic.close(); pending.resolve(new f.realm.Response()); await f.flush(); assert.deepEqual(diagnostic.snapshot(), closed);
  const g = ownershipFixture(), second = installBrowserCancellationDiagnostic({ trackResponseStreams: true }, g.realm), response = await g.associate(second), reader = response.body.getReader();
  const unhandled = [], listener = reason => unhandled.push(reason); process.on('unhandledRejection', listener);
  try {
    const value = new Proxy({}, { getOwnPropertyDescriptor() { throw Error('secret-observer-error'); } });
    const promise = g.PromiseClass.resolve(value); g.setResult(reader, 'read', promise); assert.equal(reader.read(), promise);
    await g.flush(); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(unhandled, []);
    const output = second.snapshot(); assert.equal(output.readers[0].readResolved, 1); assert.equal('doneTrue' in output.readers[0], false);
    assert.doesNotMatch(JSON.stringify(output), /secret/);
  } finally { process.off('unhandledRejection', listener); second.close(); }
});

test('serialized ownership factory is self-contained and never patches global Node primitives', async () => {
  const isolated = Function('return (' + installBrowserCancellationDiagnostic.toString() + ')')(), f = ownershipFixture();
  const originalThen = Promise.prototype.then, diagnostic = isolated({ trackResponseStreams: true }, f.realm);
  const response = await f.associate(diagnostic), reader = response.body.getReader(); await reader.read(); await f.flush();
  assert.equal(diagnostic.snapshot().readers[0].doneFalse, 1); assert.equal(Promise.prototype.then, originalThen);
  assert.equal(diagnostic.close().restoreFailures, 0);
});

test('epoch and elapsed clocks remain independent; invalid anchors do not invent timestamps', () => {
  const f = fixture(); f.setEpoch(-1);
  const diagnostic = installBrowserCancellationDiagnostic({}, f.realm);
  f.setTime(99); f.realm.fetch('/katalog');
  assert.equal(diagnostic.snapshot().startedAt, null);
  assert.equal(diagnostic.snapshot().events[0].elapsedMs, null);
  f.setEpoch(1800000005000); f.setTime(110); f.realm.fetch('/katalog');
  assert.equal(diagnostic.snapshot().startedAt, null);
  assert.equal(diagnostic.snapshot().events[1].elapsedMs, 10);
  diagnostic.close();
  const g = fixture(); delete g.realm.Date;
  const withoutEpoch = installBrowserCancellationDiagnostic({}, g.realm);
  g.setTime(105); g.realm.fetch('/katalog');
  assert.equal(withoutEpoch.snapshot().startedAt, null);
  assert.equal(withoutEpoch.snapshot().events[0].elapsedMs, 5); withoutEpoch.close();
});

test('actual Node Response and stream primitives retain ownership, errors, EOF and descriptors in an isolated subprocess', () => {
  // This is native web-primitive regression evidence, not HTTP transport or a
  // browser E2E: fetch is an explicit Promise double and opens no network.
  // Prototype hooks live only in the child process and never affect this runner.
  const parentDescriptors = [Object.getOwnPropertyDescriptor(globalThis, 'fetch'),
    Object.getOwnPropertyDescriptor(Response.prototype, 'body'),
    Object.getOwnPropertyDescriptor(ReadableStreamDefaultReader.prototype, 'read')];
  const code = String.raw`
    'use strict';
    const assert = require('node:assert/strict');
    const { installBrowserCancellationDiagnostic } = require(process.argv[1]);
    (async () => {
      globalThis.location = { href: 'http://127.0.0.1:4411/katalog' };
      let fetchResult;
      globalThis.fetch = function () { return fetchResult; };
      const targets = [[globalThis,'fetch'], [AbortController.prototype,'abort'], [Response.prototype,'body'], [Response.prototype,'clone'],
        [ReadableStream.prototype,'getReader'], [ReadableStream.prototype,'tee'], [ReadableStream.prototype,'cancel'],
        [ReadableStreamDefaultReader.prototype,'read'], [ReadableStreamDefaultReader.prototype,'closed'],
        [ReadableStreamDefaultReader.prototype,'cancel'], [ReadableStreamDefaultReader.prototype,'releaseLock'],
        [ReadableStreamBYOBReader.prototype,'read'], [ReadableStreamBYOBReader.prototype,'closed'],
        [ReadableStreamBYOBReader.prototype,'cancel'], [ReadableStreamBYOBReader.prototype,'releaseLock']];
      const descriptors = targets.map(([target,key]) => Object.getOwnPropertyDescriptor(target,key));
      const diagnostic = installBrowserCancellationDiagnostic({ trackResponseStreams: true });
      const fetchResponse = async response => {
        fetchResult = Promise.resolve(response);
        assert.equal(fetch('/katalog'), fetchResult);
        const actual = await fetchResult; assert.equal(actual, response); return actual;
      };
      const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
      try {
        let produced = 0;
        const long = await fetchResponse(new Response(new ReadableStream({ pull(controller) {
          if (produced++ < 240) controller.enqueue(new Uint8Array([produced % 255])); else controller.close();
        }})));
        const body = long.body; assert.equal(long.body, body);
        const reader = body.getReader(), closedPromise = reader.closed; assert.equal(reader.closed, closedPromise);
        for (;;) { if ((await reader.read()).done) break; }
        await closedPromise; await flush(); reader.releaseLock();
        const first = diagnostic.snapshot(), longRow = first.readers[0];
        assert.equal(longRow.readCalls, 241); assert.equal(longRow.doneFalse, 240); assert.equal(longRow.doneTrue, 1);
        assert.equal(longRow.closedAccesses, 2); assert.equal(longRow.closedFulfilled, 1);
        assert.equal(longRow.releaseLockReturned, 1); assert.equal(first.pendingPromiseObservations, 0);
        assert.equal(first.promiseObservationDrops, 0); assert.equal(first.promiseObservations, 243);

        // Native clone replaces the original body with an actual tee branch.
        const original = await fetchResponse(new Response(new Uint8Array([1,2,3]))), beforeCloneBody = original.body;
        const clone = original.clone(), originalBody = original.body, cloneBody = clone.body;
        assert.notEqual(originalBody, beforeCloneBody); assert.notEqual(cloneBody, originalBody);
        for (const source of [originalBody,cloneBody]) {
          const current = source.getReader(); for (;;) { if ((await current.read()).done) break; } current.releaseLock();
        }
        await flush();
        const cloneSnapshot = diagnostic.snapshot(), cloned = cloneSnapshot.responses.find(row => row.cloneOf);
        assert.equal(cloned.cloneOf, 2); assert.deepEqual(cloned.requests, [2]);
        const branches = cloneSnapshot.streams.filter(row => row.teeOf);
        assert.equal(branches.length, 2); assert.deepEqual(branches.map(row => row.requests), [[2],[2]]);
        const cloneBodyEvent = cloneSnapshot.events.find(row => row.kind === 'response-body-access' && row.response === cloned.response);
        assert.ok(cloneBodyEvent); assert.ok(branches.some(row => row.stream === cloneBodyEvent.stream));
        assert.deepEqual(cloneSnapshot.readers.slice(1).map(row => row.requests), [[2],[2]]);

        const bytes = await fetchResponse(new Response(new ReadableStream({ type:'bytes', start(controller) {
          controller.enqueue(new Uint8Array([4,5])); controller.close();
        }})));
        const byob = bytes.body.getReader({ mode:'byob' }), view = new Uint8Array(4);
        const byobRead = byob.read(view), chunk = await byobRead; assert.equal(chunk.done, false);
        assert.deepEqual([...chunk.value], [4,5]); assert.equal(view.byteLength, 0); // Native BYOB detaches the input.
        assert.equal((await byob.read(new Uint8Array(4))).done, true); byob.releaseLock(); await flush();
        const byobRow = diagnostic.snapshot().readers.find(row => row.kind === 'byob');
        assert.equal(byobRow.doneFalse, 1); assert.equal(byobRow.doneTrue, 1); assert.equal(byobRow.releaseLockReturned, 1);

        let faultController;
        const failing = await fetchResponse(new Response(new ReadableStream({ start(controller) { faultController=controller; } })));
        const faultReader = failing.body.getReader(), failure = new TypeError('private-fault-canary');
        const pendingRead = faultReader.read(), pendingClosed = faultReader.closed; faultController.error(failure);
        await assert.rejects(pendingRead, error => error === failure);
        await assert.rejects(pendingClosed, error => error === failure); await flush();
        const faultRow = diagnostic.snapshot().readers.at(-1);
        assert.equal(faultRow.readRejected, 1); assert.equal(faultRow.closedRejected, 1); assert.equal('doneTrue' in faultRow, false);
        faultReader.releaseLock();

        let cancellationReason;
        const cancellable = await fetchResponse(new Response(new ReadableStream({ cancel(reason) { cancellationReason=reason; } })));
        const cancelReader = cancellable.body.getReader(), reason = { privateReason:'private-cancel-canary' };
        const cancelPromise = cancelReader.cancel(reason); await cancelPromise; await flush();
        assert.equal(cancellationReason, reason);
        const cancelRow = diagnostic.snapshot().readers.at(-1);
        assert.equal(cancelRow.cancelCalls, 1); assert.equal(cancelRow.cancelFulfilled, 1);
        assert.equal('doneTrue' in cancelRow, false); // Cancellation fulfillment is not read EOF.
        cancelReader.releaseLock();

        const unlocked = await fetchResponse(new Response(new ReadableStream()));
        await unlocked.body.cancel(reason); await flush();
        const streamRow = diagnostic.snapshot().streams.at(-1);
        assert.equal(streamRow.cancelCalls, 1); assert.equal(streamRow.cancelFulfilled, 1);
        assert.doesNotMatch(JSON.stringify(diagnostic.snapshot()), /private-fault-canary|private-cancel-canary/);
      } finally {
        const result = diagnostic.close(); assert.equal(result.restoreFailures, 0);
        for (let index=0; index<targets.length; index++) assert.deepEqual(Object.getOwnPropertyDescriptor(...targets[index]),descriptors[index]);
      }
      process.stdout.write('native-web-primitives-pass\n');
    })().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode=1; });
  `;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'].includes(key.toUpperCase())));
  const child = spawnSync(process.execPath, ['-e', code, require.resolve('./sj-performance-browser-cancel-diagnostic')],
    { encoding:'utf8', env, windowsHide:true, timeout:15000, maxBuffer:1024*1024 });
  assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'native-web-primitives-pass\n'); assert.equal(child.stderr, '');
  assert.deepEqual([Object.getOwnPropertyDescriptor(globalThis, 'fetch'),
    Object.getOwnPropertyDescriptor(Response.prototype, 'body'),
    Object.getOwnPropertyDescriptor(ReadableStreamDefaultReader.prototype, 'read')], parentDescriptors);
});
