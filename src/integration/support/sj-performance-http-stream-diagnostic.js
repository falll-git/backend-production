'use strict';

// Test-only, opt-in metadata observer. Never patches response.write/end, reads
// bodies/cookies/credentials, performs requests or changes application outcomes.
// Node24: EventEmitter.emit keeps native return/throws; errorMonitor does not
// consume an unhandled error. Instrumentation overhead is NOT noninterference.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { errorMonitor } = require('node:events');
const { performance } = require('node:perf_hooks');

const fail = code => { throw Error('HTTPStreamDiagnostic' + code); };
function localOrigin(value) {
  let url; try { url = new URL(value); } catch { fail('OriginInvalid'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || !url.port || Number(url.port) < 1024) fail('OriginInvalid');
  return url;
}
const boolean = value => typeof value === 'boolean' ? value : null;
const errorCode = error => {
  let code; try { code = error?.code; } catch { return 'OTHER_ERROR'; }
  return ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ABORT_ERR', 'ERR_STREAM_PREMATURE_CLOSE',
    'ERR_STREAM_DESTROYED', 'ERR_HTTP_HEADERS_SENT', 'ERR_HTTP_REQUEST_TIMEOUT'].includes(code) ? code : 'OTHER_ERROR';
};
function mime(response) {
  const raw = response.getHeader('content-type');
  if (raw == null) return 'none';
  if (typeof raw !== 'string') return 'other';
  const type = raw.split(';', 1)[0].trim().toLowerCase();
  if (type === 'text/x-component') return 'rsc';
  if (type === 'text/html') return 'html';
  if (type === 'application/json') return 'json';
  if (type === 'text/plain') return 'text';
  return 'other';
}

function installHttpStreamDiagnostic(options = {}) {
  const target = options.target || http.Server.prototype;
  const events = [], subscriptions = new Set(), requests = new WeakSet();
  const cap = Number.isInteger(options.maxEvents) && options.maxEvents > 0 ? Math.min(options.maxEvents, 200) : 200;
  const now = typeof options.now === 'function' ? options.now : () => performance.now();
  let active = false, closed = false, dropped = 0, observationErrors = 0, nextRequest = 1, restored = false;
  let started = 0, startedAt = null, original, descriptor, wrapper;
  const snapshot = () => ({ version: 1, capture: 'scoped-http-stream-metadata', cap, active, closed, startedAt,
    dropped, observationErrors, openRequests: subscriptions.size, restored, events: events.map(row => ({ ...row })) });
  const safely = callback => { try { return callback(); } catch { observationErrors++; return undefined; } };
  const elapsed = () => { const value = now() - started; return Number.isFinite(value) && value >= 0 ? value : null; };
  const push = row => {
    if (!active) return;
    if (events.length >= cap) { dropped++; return; }
    const event = { elapsedMs: elapsed(), ...row }; events.push(event);
    if (typeof options.onEvent === 'function') safely(() => options.onEvent({ ...event }));
  };
  const close = () => {
    if (closed) return snapshot();
    active = false; closed = true;
    for (const subscription of [...subscriptions]) subscription.remove();
    safely(() => {
      if (wrapper && target.emit === wrapper) {
        if (descriptor) Object.defineProperty(target, 'emit', descriptor); else delete target.emit;
        restored = true;
      }
    });
    return snapshot();
  };
  // No global hook or filesystem work unless explicitly opted in.
  if (options.enabled !== true) return { snapshot, close };
  const origin = localOrigin(options.origin);
  original = target.emit; descriptor = Object.getOwnPropertyDescriptor(target, 'emit');
  if (typeof original !== 'function' || (descriptor && !descriptor.configurable && !descriptor.writable)) fail('EmitterInvalid');
  const selected = request => {
    if (!request || request.method !== 'GET' || request.headers?.rsc !== '1') return false;
    if (request.headers.host !== origin.host || typeof request.url !== 'string' || !request.url.startsWith('/') || request.url.startsWith('//')) return false;
    let url; try { url = new URL(request.url, origin); } catch { return false; }
    if (url.origin !== origin.origin || url.pathname !== '/katalog' || url.username || url.password) return false;
    if (request.headers.origin != null && request.headers.origin !== origin.origin) return false;
    if (request.headers.referer != null) {
      try { const referer = new URL(request.headers.referer); if (referer.origin !== origin.origin || referer.username || referer.password) return false; }
      catch { return false; }
    }
    return true;
  };
  const observe = (request, response) => {
    if (!active || !selected(request) || requests.has(request)) return;
    if (events.length >= cap) { dropped++; return; }
    if (!response || typeof response.on !== 'function' || typeof response.off !== 'function' || typeof response.getHeader !== 'function' ||
        typeof request.on !== 'function' || typeof request.off !== 'function') fail('StreamInvalid');
    requests.add(request);
    const ordinal = nextRequest++;
    const facts = () => ({ request: ordinal, route: 'catalog', method: 'GET', rsc: true,
      status: Number.isInteger(response.statusCode) && response.statusCode >= 100 && response.statusCode <= 599 ? response.statusCode : null,
      mime: mime(response), reqAborted: boolean(request.aborted),
      writableEnded: boolean(response.writableEnded), writableFinished: boolean(response.writableFinished) });
    const record = (kind, error) => safely(() => push({ kind, ...facts(), ...(error ? { error: errorCode(error) } : {}) }));
    const hooks = [
      [request, 'aborted', () => record('request_aborted')],
      [request, errorMonitor, error => record('request_error', error)],
      [response, 'finish', () => record('response_finish')],
      [response, errorMonitor, error => record('response_error', error)],
    ];
    let removed = false;
    const subscription = { remove: () => {
      if (removed) return; removed = true;
      for (const [emitter, name, callback] of hooks) safely(() => emitter.off(name, callback));
      subscriptions.delete(subscription);
    } };
    hooks.push([response, 'close', () => { record('response_close'); subscription.remove(); }]);
    subscriptions.add(subscription);
    try { for (const [emitter, name, callback] of hooks) emitter.on(name, callback); }
    catch (error) { subscription.remove(); throw error; }
    record('request');
  };
  wrapper = function emit(event, ...args) {
    if (event === 'request' && active) safely(() => observe(args[0], args[1]));
    // No catch/return substitution around the application's native emit.
    return Reflect.apply(original, this, [event, ...args]);
  };
  // Anchor the relative clock at installation, not at bootstrap proof/file I/O.
  started = now(); startedAt = Date.now();
  Object.defineProperty(target, 'emit', { value: wrapper, writable: true, configurable: true, enumerable: descriptor?.enumerable ?? false });
  active = true;
  return { snapshot, close };
}

function bootstrapHttpStreamDiagnostic(options = {}) {
  const env = options.env || process.env;
  if (env.SJ_TEST_HTTP_STREAM_DIAGNOSTIC_ENABLE == null || env.SJ_TEST_HTTP_STREAM_DIAGNOSTIC_ENABLE === '0') return null;
  if (env.SJ_TEST_HTTP_STREAM_DIAGNOSTIC_ENABLE !== '1') fail('EnableInvalid');
  const io = options.fs || fs, host = options.process || process;
  const proofPath = env.SJ_TEST_HTTP_STREAM_DIAGNOSTIC_PROOF, destination = env.SJ_TEST_HTTP_STREAM_DIAGNOSTIC_PATH;
  const token = env.SJ_TEST_HTTP_STREAM_DIAGNOSTIC_TOKEN;
  let proof, owner, report, root;
  // Every ownership/path check precedes fd creation and the global HTTP hook.
  try {
    if (typeof proofPath !== 'string' || !path.isAbsolute(proofPath) || typeof destination !== 'string' || !path.isAbsolute(destination) ||
        typeof token !== 'string' || token.length < 32) fail('TargetNotOwned');
    const read = file => {
      const stat = io.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 64 * 1024) fail('TargetNotOwned');
      return JSON.parse(io.readFileSync(file, 'utf8'));
    };
    proof = read(proofPath); root = path.resolve(proof.root || '');
    if (proof.kind !== 'RA-SJ-02-disposable-v1' || !/^[a-f0-9]{32}$/.test(proof.runId || '') ||
        !/^[a-f0-9]{64}$/.test(proof.tokenHash || '') || typeof proof.root !== 'string' || !path.isAbsolute(proof.root) ||
        !Number.isInteger(proof.parentPid) || proof.parentPid <= 0 || !Number.isFinite(Date.parse(proof.createdAt)) ||
        path.resolve(proofPath) !== path.join(root, 'proof.json') || io.lstatSync(root).isSymbolicLink() ||
        !io.lstatSync(root).isDirectory() || io.realpathSync(root) !== root || io.realpathSync(proofPath) !== path.resolve(proofPath)) fail('TargetNotOwned');
    owner = read(path.join(root, 'owner.json'));
    if (owner.runId !== proof.runId || owner.tokenHash !== proof.tokenHash ||
        crypto.createHash('sha256').update(token).digest('hex') !== proof.tokenHash) fail('TargetNotOwned');
    if (path.dirname(path.resolve(destination)) !== root || !/^(?:catalog-)?http-stream-diagnostic(?:-[a-z0-9-]{1,32})?\.jsonl$/.test(path.basename(destination)) ||
        io.existsSync(destination)) fail('TargetNotOwned');
    const reportPath = path.join(root, 'report.json');
    if (io.lstatSync(reportPath).isSymbolicLink() || !io.lstatSync(reportPath).isFile() || io.lstatSync(reportPath).size > 2 * 1024 * 1024) fail('TargetNotOwned');
    report = JSON.parse(io.readFileSync(reportPath, 'utf8'));
    if (report.runId !== proof.runId || path.resolve(report.root || '') !== root || report.status !== 'running' || report.finishedAt != null) fail('TargetNotOwned');
    host.kill(proof.parentPid, 0);
  } catch { fail('TargetNotOwned'); }
  const origin = localOrigin(env.SJ_TEST_HTTP_STREAM_DIAGNOSTIC_ORIGIN);
  let fd; try { fd = io.openSync(destination, 'wx', 0o600); } catch { fail('OutputUnavailable'); }
  let diagnostic, closed = false, writeFailed = false;
  const writeAll = row => {
    const bytes = Buffer.from(JSON.stringify(row) + '\n', 'utf8');
    // Fixed, allowlisted rows are small. A positive byte count bounds iterations
    // by this row's byte length; a broken fd cannot create an endless loop.
    let offset = 0;
    while (offset < bytes.length) {
      const remaining = bytes.length - offset;
      const written = io.writeSync(fd, bytes, offset, remaining);
      if (!Number.isInteger(written) || written <= 0 || written > remaining) fail('WriteInvalid');
      offset += written;
    }
  };
  const write = row => { try { writeAll(row); } catch { writeFailed = true; } };
  const close = () => {
    if (closed) return; closed = true;
    host.off('exit', close);
    const snapshot = diagnostic?.close();
    write({ kind: 'observer_closed', cap: snapshot?.cap ?? 200, eventCount: snapshot?.events.length ?? 0,
      dropped: snapshot?.dropped ?? 0, observationErrors: snapshot?.observationErrors ?? 0, writeFailed,
      openRequests: snapshot?.openRequests ?? 0, restored: snapshot?.restored ?? false });
    try { io.closeSync(fd); } catch { writeFailed = true; }
  };
  try {
    diagnostic = installHttpStreamDiagnostic({ enabled: true, origin: origin.origin, target: options.target,
      now: options.now, maxEvents: 200, onEvent: write });
    writeAll({ kind: 'observer_started', version: 1, capture: 'scoped-http-stream-metadata', cap: 200,
      startedAt: diagnostic.snapshot().startedAt });
    host.once('exit', close);
  } catch { writeFailed = true; close(); fail('InstallFailed'); }
  return { snapshot: () => ({ ...diagnostic.snapshot(), writeFailed }), close };
}

module.exports = { installHttpStreamDiagnostic, bootstrapHttpStreamDiagnostic };
// Inert when normally imported. A reviewed harness must explicitly preload this
// module and pass the guarded activation fields only to its owned SJ Next child.
if (process.env.SJ_TEST_HTTP_STREAM_DIAGNOSTIC_ENABLE === '1') bootstrapHttpStreamDiagnostic();
