'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter, errorMonitor } = require('node:events');
const originalHttpEmit = http.Server.prototype.emit;
const { installHttpStreamDiagnostic, bootstrapHttpStreamDiagnostic } = require('./sj-performance-http-stream-diagnostic');
assert.equal(http.Server.prototype.emit, originalHttpEmit, 'normal import must remain inert');

function streamFixture(extra = {}) {
  const target = Object.create(EventEmitter.prototype), server = Object.assign(new EventEmitter(), { emit: undefined });
  Object.setPrototypeOf(server, target); delete server.emit;
  const request = Object.assign(new EventEmitter(), { method: 'GET', url: '/katalog?cursor=secret&_rsc=secret',
    headers: { host: '127.0.0.1:4411', rsc: '1', authorization: 'secret', cookie: 'secret' }, aborted: false, ...extra });
  const response = Object.assign(new EventEmitter(), { statusCode: 200, writableEnded: false, writableFinished: false,
    getHeader: key => { assert.equal(key, 'content-type'); return 'text/x-component; charset=utf-8'; } });
  return { target, server, request, response };
}
function diagnostic(fixture, extra = {}) {
  return installHttpStreamDiagnostic({ enabled: true, origin: 'http://127.0.0.1:4411', target: fixture.target, ...extra });
}

test('inactive import/installation leaves native hooks and streams untouched', () => {
  const f = streamFixture(), before = f.target.emit;
  const observer = installHttpStreamDiagnostic({ target: f.target });
  assert.equal(f.target.emit, before); assert.equal(f.server.emit('request', f.request, f.response), false);
  assert.deepEqual(observer.snapshot().events, []); assert.equal(observer.snapshot().active, false);
  assert.equal(observer.snapshot().startedAt, null);
  assert.equal(f.request.eventNames().length, 0); assert.equal(f.response.eventNames().length, 0); observer.close();
});

test('native Server emit keeps this, all arguments, return and original exceptions', () => {
  const f = streamFixture(); let actual;
  f.target.emit = function (...args) { actual = { receiver: this, args }; return 'native-result'; };
  const before = f.target.emit, observer = diagnostic(f);
  const extra = {}; assert.equal(f.server.emit('request', f.request, f.response, extra), 'native-result');
  assert.equal(actual.receiver, f.server); assert.deepEqual(actual.args, ['request', f.request, f.response, extra]);
  observer.close(); assert.equal(f.target.emit, before);
  const g = streamFixture(), error = Error('secret'); g.target.emit = () => { throw error; };
  const bad = diagnostic(g); assert.throws(() => g.server.emit('request', g.request, g.response), value => value === error); bad.close();
});

test('only same-origin catalog GET with exact RSC header is captured without private values', () => {
  const f = streamFixture(); let time = 50; const observer = diagnostic(f, { now: () => time });
  const values = [ { method: 'POST' }, { url: '/katalog/nested' }, { url: '/api/private' }, { url: '//secret.example/katalog' },
    { headers: { host: 'secret.example', rsc: '1' } }, { headers: { host: '127.0.0.1:4411', rsc: 'true' } },
    { headers: { host: '127.0.0.1:4411', rsc: '1', origin: 'https://secret.example' } },
    { headers: { host: '127.0.0.1:4411', rsc: '1', referer: 'https://secret.example/katalog' } } ];
  for (const value of values) { const stream = streamFixture(value); f.server.emit('request', stream.request, stream.response); assert.equal(stream.response.eventNames().length, 0); }
  f.request.headers = new Proxy({ host: '127.0.0.1:4411', rsc: '1', referer: 'http://127.0.0.1:4411/katalog?private=secret' },
    { get: (object, key) => { assert.ok(['host', 'rsc', 'origin', 'referer'].includes(key), 'no other headers may be read'); return object[key]; } });
  time = 55; f.server.emit('request', f.request, f.response); f.server.emit('request', f.request, f.response);
  const output = observer.snapshot(); assert.equal(output.events.length, 1); assert.equal(output.events[0].request, 1);
  assert.equal(output.events[0].elapsedMs, 5); assert.equal(output.events[0].mime, 'rsc');
  assert.doesNotMatch(JSON.stringify(output), /secret|127\.0\.0\.1|cursor|authorization|cookie|headers|body|payload/); observer.close();
});

test('normal finish is distinct from close; incomplete aborted close never becomes finish', () => {
  const f = streamFixture(), observer = diagnostic(f); f.server.emit('request', f.request, f.response);
  f.response.writableEnded = true; f.response.writableFinished = true; f.response.emit('finish'); f.response.emit('close');
  const g = streamFixture(); f.server.emit('request', g.request, g.response); g.request.aborted = true; g.request.emit('aborted'); g.response.emit('close');
  const output = observer.snapshot(); assert.deepEqual(output.events.map(row => row.kind),
    ['request', 'response_finish', 'response_close', 'request', 'request_aborted', 'response_close']);
  assert.equal(output.events[1].writableFinished, true); assert.equal(output.events[5].reqAborted, true);
  assert.equal(output.events[5].writableEnded, false); assert.equal(output.events[5].writableFinished, false);
  assert.equal(output.openRequests, 0); assert.equal(g.response.listenerCount('finish'), 0); observer.close();
});

test('errorMonitor records enums without consuming native unhandled errors or changing app handler', () => {
  const f = streamFixture(), observer = diagnostic(f); f.server.emit('request', f.request, f.response);
  const error = Object.assign(Error('secret message/path/credential'), { code: 'ECONNRESET' });
  assert.equal(f.response.listenerCount('error'), 0);
  assert.throws(() => f.response.emit('error', error), value => value === error);
  let passed; f.request.on('error', value => { passed = value; }); f.request.emit('error', error); assert.equal(passed, error);
  const other = Object.assign(Error('secret'), { code: 'secret-code' }); f.request.emit('error', other);
  assert.deepEqual(observer.snapshot().events.filter(row => row.error).map(row => row.error), ['ECONNRESET', 'ECONNRESET', 'OTHER_ERROR']);
  assert.doesNotMatch(JSON.stringify(observer.snapshot()), /secret|credential|message|path/); observer.close();
});

test('close removes only owned hooks, preserves app listeners and is idempotent', () => {
  const f = streamFixture(), app = () => {}; f.response.on('finish', app); const before = f.target.emit;
  const observer = diagnostic(f); f.server.emit('request', f.request, f.response); assert.equal(f.response.listenerCount('finish'), 2);
  const output = observer.close(); assert.equal(output.active, false); assert.equal(output.closed, true); assert.equal(output.restored, true);
  assert.equal(output.openRequests, 0); assert.equal(f.target.emit, before); assert.deepEqual(f.response.listeners('finish'), [app]);
  assert.equal(f.request.listenerCount(errorMonitor), 0); assert.equal(f.response.listenerCount(errorMonitor), 0);
  assert.deepEqual(observer.close(), output); f.response.emit('finish'); assert.deepEqual(observer.snapshot(), output);
});

test('uninstall never overwrites a foreign replacement wrapper', () => {
  const f = streamFixture(), observer = diagnostic(f); const foreign = () => false; f.target.emit = foreign;
  assert.equal(observer.close().restored, false); assert.equal(f.target.emit, foreign);
});

test('shutdown reports an un-restorable owned wrapper without throwing or removing application listeners', () => {
  const f = streamFixture(), app = () => {}; f.response.on('finish', app);
  const observer = diagnostic(f); f.server.emit('request', f.request, f.response);
  Object.defineProperty(f.target, 'emit', { configurable: false, writable: false });
  const output = observer.close(); assert.equal(output.restored, false); assert.equal(output.observationErrors, 1);
  assert.equal(output.openRequests, 0); assert.deepEqual(f.response.listeners('finish'), [app]);
  assert.equal(output.active, false); assert.equal(f.server.emit('request', f.request, f.response), false);
});

test('metadata events and tracked subscriptions are bounded, drops explicit', () => {
  const f = streamFixture(), observer = diagnostic(f, { maxEvents: 1000 });
  for (let i = 0; i < 205; i++) { const stream = streamFixture(); f.server.emit('request', stream.request, stream.response); }
  const output = observer.snapshot(); assert.equal(output.cap, 200); assert.equal(output.events.length, 200);
  assert.equal(output.openRequests, 200); assert.equal(output.dropped, 5); assert.equal(observer.close().openRequests, 0);
});

test('observer faults and invalid scalar facts cannot change native emit behavior', () => {
  const f = streamFixture(), observer = diagnostic(f, { now: () => NaN, onEvent: () => { throw Error('secret'); } });
  f.response.statusCode = Infinity; f.response.writableEnded = 'secret'; f.response.getHeader = () => 'secret/private';
  assert.equal(f.server.emit('request', f.request, f.response), false); const output = observer.snapshot();
  assert.equal(output.events[0].elapsedMs, null); assert.equal(output.events[0].status, null);
  assert.equal(output.events[0].writableEnded, null); assert.equal(output.events[0].mime, 'other'); assert.equal(output.observationErrors, 1);
  assert.doesNotMatch(JSON.stringify(output), /secret/); observer.close();
});

test('MIME values cannot escape their scalar enum through prototype names', () => {
  for (const value of ['__proto__', 'constructor', 'toString', 'secret/type']) {
    const f = streamFixture(), observer = diagnostic(f); f.response.getHeader = () => value;
    f.server.emit('request', f.request, f.response); assert.equal(observer.snapshot().events[0].mime, 'other');
    observer.close();
  }
});

function bootstrapFixture() {
  const root = path.resolve('C:/owned/ra-sj-02-unit'), token = 'private-unit-capability-' + 'x'.repeat(48), runId = 'a'.repeat(32);
  const proof = { kind: 'RA-SJ-02-disposable-v1', runId, root, parentPid: 43210, createdAt: '2026-10-11T00:00:00Z',
    tokenHash: crypto.createHash('sha256').update(token).digest('hex') };
  const files = new Map([[path.join(root, 'proof.json'), proof], [path.join(root, 'owner.json'), { runId, tokenHash: proof.tokenHash }],
    [path.join(root, 'report.json'), { runId, root, status: 'running' }]]);
  const calls = [], lines = [], host = new EventEmitter(); let pending = '';
  host.kill = (pid, signal) => { calls.push(['kill', pid, signal]); };
  const io = { lstatSync: file => ({ isSymbolicLink: () => false, isFile: () => files.has(file), isDirectory: () => file === root, size: 100 }),
    realpathSync: file => file, readFileSync: file => JSON.stringify(files.get(file)), existsSync: () => false,
    openSync: (...args) => { calls.push(['open', ...args]); return 9; },
    writeSync: (fd, bytes, offset, length) => {
      assert.equal(fd, 9); assert.ok(Buffer.isBuffer(bytes));
      pending += bytes.subarray(offset, offset + length).toString('utf8');
      let index; while ((index = pending.indexOf('\n')) !== -1) { lines.push(JSON.parse(pending.slice(0, index))); pending = pending.slice(index + 1); }
      return length;
    }, closeSync: fd => calls.push(['close', fd]) };
  const env = { SJ_TEST_HTTP_STREAM_DIAGNOSTIC_ENABLE: '1', SJ_TEST_HTTP_STREAM_DIAGNOSTIC_PROOF: path.join(root, 'proof.json'),
    SJ_TEST_HTTP_STREAM_DIAGNOSTIC_PATH: path.join(root, 'catalog-http-stream-diagnostic.jsonl'), SJ_TEST_HTTP_STREAM_DIAGNOSTIC_TOKEN: token,
    SJ_TEST_HTTP_STREAM_DIAGNOSTIC_ORIGIN: 'http://127.0.0.1:4411' };
  return { root, token, runId, proof, files, calls, lines, host, io, env };
}
test('inactive bootstrap performs no proof read, fd write, parent check or global install', () => {
  const f = streamFixture(); assert.equal(bootstrapHttpStreamDiagnostic({ env: {}, target: f.target,
    fs: new Proxy({}, { get: () => { throw Error('must not access filesystem'); } }) }), null);
  assert.equal(f.target.emit, EventEmitter.prototype.emit);
});

test('guarded bootstrap writes only allowlisted JSONL and normal exit removes hooks/owned fd', () => {
  const b = bootstrapFixture(), f = streamFixture(), before = f.target.emit;
  const beforeInstall = Date.now();
  const observer = bootstrapHttpStreamDiagnostic({ env: b.env, fs: b.io, process: b.host, target: f.target });
  const afterInstall = Date.now();
  assert.deepEqual(b.calls[0], ['kill', b.proof.parentPid, 0]); assert.deepEqual(b.calls[1], ['open', b.env.SJ_TEST_HTTP_STREAM_DIAGNOSTIC_PATH, 'wx', 0o600]);
  f.server.emit('request', f.request, f.response); f.response.writableEnded = true; f.response.writableFinished = true;
  f.response.emit('finish'); f.response.emit('close'); b.host.emit('exit', 0); observer.close();
  assert.equal(b.lines[0].kind, 'observer_started'); assert.equal(b.lines.at(-1).kind, 'observer_closed');
  assert.ok(Number.isFinite(b.lines[0].startedAt)); assert.ok(Number.isInteger(b.lines[0].startedAt));
  assert.ok(b.lines[0].startedAt >= beforeInstall && b.lines[0].startedAt <= afterInstall);
  assert.equal(b.lines[0].startedAt, observer.snapshot().startedAt);
  assert.equal(b.lines.at(-1).eventCount, 3); assert.equal(b.lines.at(-1).writeFailed, false);
  assert.equal(b.calls.filter(row => row[0] === 'close').length, 1); assert.equal(b.host.listenerCount('exit'), 0); assert.equal(f.target.emit, before);
  assert.doesNotMatch(JSON.stringify(b.lines), /private|secret|cursor|127\.0\.0\.1|C:\\|token|headers|body/);
});

test('wrong target/identity/capability/stale run/symlink/origin denied before fd or hook mutation', () => {
  const mutations = [
    b => { b.proof.kind = 'operational'; }, b => { b.files.get(path.join(b.root, 'owner.json')).runId = 'b'.repeat(32); },
    b => { b.env.SJ_TEST_HTTP_STREAM_DIAGNOSTIC_TOKEN = 'z'.repeat(40); }, b => { b.proof.parentPid = 0; },
    b => { b.env.SJ_TEST_HTTP_STREAM_DIAGNOSTIC_PATH = path.join(path.dirname(b.root), 'http-stream-diagnostic.jsonl'); },
    b => { b.env.SJ_TEST_HTTP_STREAM_DIAGNOSTIC_PATH = path.join(b.root, '.env'); },
    b => { b.env.SJ_TEST_HTTP_STREAM_DIAGNOSTIC_PROOF = path.join(b.root, 'foreign-proof.json'); },
    b => { b.files.get(path.join(b.root, 'report.json')).status = 'failed'; },
    b => { b.files.get(path.join(b.root, 'report.json')).finishedAt = '2026-10-11T00:01:00Z'; },
    b => { b.io.existsSync = () => true; }, b => { b.io.realpathSync = () => path.resolve('C:/foreign'); },
    b => { b.io.lstatSync = () => ({ isSymbolicLink: () => true }); },
    b => { b.host.kill = () => { throw Error('secret ESRCH'); }; },
    b => { b.env.SJ_TEST_HTTP_STREAM_DIAGNOSTIC_ORIGIN = 'https://secret.example'; },
  ];
  for (const mutate of mutations) { const b = bootstrapFixture(), f = streamFixture(), before = f.target.emit; mutate(b);
    assert.throws(() => bootstrapHttpStreamDiagnostic({ env: b.env, fs: b.io, process: b.host, target: f.target }), /^Error: HTTPStreamDiagnostic(?:TargetNotOwned|OriginInvalid)$/);
    assert.equal(b.calls.some(row => row[0] === 'open'), false); assert.equal(f.target.emit, before); assert.deepEqual(b.lines, []);
  }
});

test('unavailable output fails before installing; later fd fault remains explicit, not app error', () => {
  const b = bootstrapFixture(), f = streamFixture(), before = f.target.emit; b.io.openSync = () => { throw Error('secret file'); };
  assert.throws(() => bootstrapHttpStreamDiagnostic({ env: b.env, fs: b.io, process: b.host, target: f.target }), /^Error: HTTPStreamDiagnosticOutputUnavailable$/);
  assert.equal(f.target.emit, before);
  const c = bootstrapFixture(), g = streamFixture(), observer = bootstrapHttpStreamDiagnostic({ env: c.env, fs: c.io, process: c.host, target: g.target });
  c.io.writeSync = () => { throw Error('secret disk'); }; assert.equal(g.server.emit('request', g.request, g.response), false);
  assert.equal(observer.snapshot().writeFailed, true); observer.close(); assert.equal(observer.snapshot().active, false);
});

test('short fd writes are completed into intact safe JSONL without repeated row data', () => {
  const b = bootstrapFixture(), f = streamFixture(), nativeWrite = b.io.writeSync; let calls = 0;
  b.io.writeSync = (fd, bytes, offset, length) => { calls++; return nativeWrite(fd, bytes, offset, Math.min(length, 7)); };
  const observer = bootstrapHttpStreamDiagnostic({ env: b.env, fs: b.io, process: b.host, target: f.target });
  f.server.emit('request', f.request, f.response); observer.close();
  assert.deepEqual(b.lines.map(row => row.kind), ['observer_started', 'request', 'observer_closed']);
  assert.equal(b.lines.at(-1).writeFailed, false); assert.equal(observer.snapshot().writeFailed, false); assert.ok(calls > 3);
  assert.doesNotMatch(JSON.stringify(b.lines), /secret|cursor|token|127\.0\.0\.1/);
});

test('invalid fd byte counts fail installation before the native hook and later faults stay explicit', () => {
  for (const result of [0, -1, NaN, undefined, 0.5, Infinity, 99999]) {
    const b = bootstrapFixture(), f = streamFixture(), before = f.target.emit;
    b.io.writeSync = () => result;
    assert.throws(() => bootstrapHttpStreamDiagnostic({ env: b.env, fs: b.io, process: b.host, target: f.target }),
      /^Error: HTTPStreamDiagnosticInstallFailed$/);
    assert.equal(f.target.emit, before); assert.equal(b.host.listenerCount('exit'), 0);
    assert.equal(b.calls.filter(row => row[0] === 'close').length, 1);
    const c = bootstrapFixture(), g = streamFixture();
    const observer = bootstrapHttpStreamDiagnostic({ env: c.env, fs: c.io, process: c.host, target: g.target });
    c.io.writeSync = () => result; assert.equal(g.server.emit('request', g.request, g.response), false);
    assert.equal(observer.snapshot().writeFailed, true); observer.close(); assert.equal(observer.snapshot().active, false);
  }
});
