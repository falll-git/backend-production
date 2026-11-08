'use strict';

// Test-only, in-realm diagnostic factory. Serialize this function into an owned
// browser diagnostic run; never install it in normal application runtime.
// It observes native calls, not response payloads or transport-success rules.
// Prototype instrumentation changes identity/timing: use a separate diagnostic
// reproduction, then an uninstrumented performance rerun. No transparency claim.
function installBrowserCancellationDiagnostic(options = {}, realm = globalThis) {
  const trackResponseStreams = options.trackResponseStreams === true;
  const cap = Number.isInteger(options.maxEvents) && options.maxEvents > 0
    ? Math.min(options.maxEvents, 200) : 200;
  const patchRecords = [], events = [], watchers = [], signals = new WeakMap();
  const installedMarker = Symbol.for('ruwang.test.browser-cancel-diagnostic.v1');
  let active = false, closed = false, dropped = 0, nextRequest = 1;
  let restoreFailures = 0, listenerFailures = 0;
  const responses = new WeakMap(), streams = new WeakMap(), readers = new WeakMap();
  const responseRows = [], streamRows = [], readerRows = [];
  const lineageCap = Math.min(cap, 16);
  let ownershipDropped = 0, unsupportedPromises = 0, promiseObservations = 0, promiseObservationDrops = 0;
  let pendingPromiseObservations = 0, observerFailures = 0;
  let nativeThen, promisePrototype, promiseConstructor, promiseSpecies;
  let origin, URLClass, urlHref, RequestClass, requestUrl, requestMethod, requestSignal;
  let controllerSignal, signalAborted, addListener, removeListener, clock;
  const own = (object, key) => Object.getOwnPropertyDescriptor(object, key);
  const getter = (object, key) => {
    for (let current = object; current; current = Object.getPrototypeOf(current)) {
      const descriptor = own(current, key);
      if (descriptor) return descriptor.get;
    }
    return undefined;
  };
  const attempt = fn => { try { return fn(); } catch { return undefined; } };
  // Fetch can be replaced by another owner while our prototype wrappers remain.
  // Refuse nesting if any target is still ours, before installing any wrapper.
  const patchTargets = attempt(() => [[realm, 'fetch'], [realm.AbortController?.prototype, 'abort'],
    [realm.ReadableStream?.prototype, 'cancel'], [realm.ReadableStreamDefaultReader?.prototype, 'cancel'],
    [realm.ReadableStreamBYOBReader?.prototype, 'cancel'], [realm.Response?.prototype, 'body'],
    [realm.Response?.prototype, 'clone'], [realm.ReadableStream?.prototype, 'getReader'],
    [realm.ReadableStream?.prototype, 'tee'], [realm.ReadableStreamDefaultReader?.prototype, 'read'],
    [realm.ReadableStreamDefaultReader?.prototype, 'releaseLock'], [realm.ReadableStreamDefaultReader?.prototype, 'closed'],
    [realm.ReadableStreamBYOBReader?.prototype, 'read'], [realm.ReadableStreamBYOBReader?.prototype, 'releaseLock'],
    [realm.ReadableStreamBYOBReader?.prototype, 'closed']]) ?? [];
  const alreadyInstalled = patchTargets.some(([target, name]) =>
    attempt(() => [own(target, name)?.value, own(target, name)?.get].some(value =>
      typeof value === 'function' && own(value, installedMarker)?.value === true)) === true);
  if (alreadyInstalled) throw Error('BrowserCancelDiagnosticAlreadyInstalled');
  try {
    URLClass = realm.URL;
    const url = new URLClass(realm.location.href);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw Error();
    origin = url.origin;
    urlHref = getter(URLClass.prototype, 'href');
    RequestClass = realm.Request;
    requestUrl = getter(RequestClass?.prototype, 'url');
    requestMethod = getter(RequestClass?.prototype, 'method');
    requestSignal = getter(RequestClass?.prototype, 'signal');
    controllerSignal = getter(realm.AbortController?.prototype, 'signal');
    signalAborted = getter(realm.AbortSignal?.prototype, 'aborted');
    addListener = realm.EventTarget?.prototype?.addEventListener;
    removeListener = realm.EventTarget?.prototype?.removeEventListener;
    const perf = realm.performance;
    clock = perf && typeof perf.now === 'function' ? perf.now.bind(perf) : Date.now;
    if (typeof controllerSignal !== 'function' || typeof signalAborted !== 'function'
      || typeof addListener !== 'function' || typeof removeListener !== 'function') throw Error();
    if (trackResponseStreams) {
      promisePrototype = realm.Promise?.prototype;
      nativeThen = own(promisePrototype, 'then')?.value;
      promiseConstructor = own(promisePrototype, 'constructor');
      promiseSpecies = own(realm.Promise, Symbol.species);
      if (typeof nativeThen !== 'function' || promiseConstructor?.value !== realm.Promise
        || typeof promiseSpecies?.get !== 'function'
        || !Function.prototype.toString.call(promiseSpecies.get).includes('[native code]')
        || !realm.Response?.prototype || !realm.ReadableStream?.prototype) throw Error();
    }
  } catch { throw Error('BrowserCancelDiagnosticUnsupported'); }
  const started = attempt(clock);
  // Page-realm epoch anchor, independent of the monotonic elapsed clock. Never
  // substitute a CLI/host clock when the supplied realm has no usable Date.now.
  const epoch = attempt(() => realm.Date?.now());
  const startedAt = Number.isFinite(epoch) && epoch >= 0 ? epoch : null;
  const elapsed = () => {
    const value = attempt(clock) - started;
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  // Non-cryptographic correlation fingerprint only. This is not a source-integrity
  // hash, signature, or request-success proof. Raw path/URL/stack never persists.
  const fingerprint = path => {
    let value = 0xcbf29ce484222325n;
    for (let index = 0; index < path.length; index++) {
      value ^= BigInt(path.charCodeAt(index));
      value = BigInt.asUintN(64, value * 0x100000001b3n);
    }
    return 'fnv1a64-' + value.toString(16).padStart(16, '0');
  };
  const callsites = () => {
    const stack = attempt(() => new realm.Error().stack);
    if (typeof stack !== 'string') return [];
    const sites = [], seen = new Set();
    for (const line of stack.split('\n').slice(0, 20)) {
      const match = line.match(/(https?:\/\/[^\s)]+):(\d+):(\d+)\)?\s*$/);
      if (!match) continue;
      const url = attempt(() => new URLClass(match[1]));
      if (!url || url.origin !== origin || url.username || url.password
        || !/^\/_next\/static\/chunks\/[A-Za-z0-9_./()@-]{1,200}\.js$/.test(url.pathname)) continue;
      const sourceLine = Number(match[2]), column = Number(match[3]);
      if (!Number.isSafeInteger(sourceLine) || sourceLine < 1 || sourceLine > 10000000
        || !Number.isSafeInteger(column) || column < 1 || column > 10000000) continue;
      const chunkPathFingerprint = fingerprint(url.pathname);
      const id = chunkPathFingerprint + ':' + sourceLine + ':' + column;
      if (seen.has(id)) continue;
      seen.add(id); sites.push({ chunkPathFingerprint, line: sourceLine, column });
      if (sites.length === 6) break;
    }
    return sites;
  };
  const push = (kind, facts) => {
    if (!active) return;
    if (events.length >= cap) { dropped++; return; }
    events.push({ elapsedMs: elapsed(), kind, ...facts, callsites: callsites() });
  };
  const readAborted = signal => attempt(() => Reflect.apply(signalAborted, signal, []));
  const watch = (signal, request) => {
    if (!signal || (typeof signal !== 'object' && typeof signal !== 'function')) return false;
    if (typeof readAborted(signal) !== 'boolean') return false;
    let info = signals.get(signal);
    if (info) { if (info.requests.length < cap) info.requests.push(request); return true; }
    if (watchers.length >= cap) return false;
    info = { signal, requests: [request], listener: null };
    info.listener = () => attempt(() => push('signal-abort', {
      scope: 'catalog-fetch-signal', requests: [...info.requests], aborted: readAborted(signal) === true,
    }));
    try { Reflect.apply(addListener, signal, ['abort', info.listener]); }
    catch { return false; }
    signals.set(signal, info); watchers.push(info);
    return true;
  };
  // Inspect only primitive URL input or native URL/Request getters and plain
  // data-valued init fields. Never invoke a custom input coercion/accessor.
  const fetchFacts = args => {
    const input = args[0], init = args[1];
    let rawUrl, method = 'GET', signal = null;
    if (typeof input === 'string') rawUrl = input;
    else if (typeof requestUrl === 'function' && typeof requestMethod === 'function') {
      rawUrl = attempt(() => Reflect.apply(requestUrl, input, []));
      if (typeof rawUrl === 'string') {
        method = attempt(() => Reflect.apply(requestMethod, input, []));
        signal = typeof requestSignal === 'function'
          ? attempt(() => Reflect.apply(requestSignal, input, [])) : null;
      } else if (typeof urlHref === 'function') rawUrl = attempt(() => Reflect.apply(urlHref, input, []));
    } else if (typeof urlHref === 'function') {
      rawUrl = attempt(() => Reflect.apply(urlHref, input, []));
    } else return null;
    if (typeof rawUrl !== 'string' || typeof method !== 'string') return null;
    if (init !== undefined && init !== null) {
      if (typeof init !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(init))) return null;
      const methodField = own(init, 'method'), signalField = own(init, 'signal');
      if (methodField && !Object.prototype.hasOwnProperty.call(methodField, 'value')) return null;
      if (signalField && !Object.prototype.hasOwnProperty.call(signalField, 'value')) return null;
      if ((!methodField && own(Object.prototype, 'method'))
        || (!signalField && own(Object.prototype, 'signal'))) return null;
      if (methodField && methodField.value !== undefined) method = methodField.value;
      if (signalField && signalField.value !== undefined) signal = signalField.value;
    }
    if (typeof method !== 'string' || method.toUpperCase() !== 'GET') return null;
    const url = attempt(() => new URLClass(rawUrl, origin));
    if (!url || url.origin !== origin || url.username || url.password || url.pathname !== '/katalog') return null;
    const request = nextRequest++;
    return { scope: 'catalog', request, signalPresent: signal != null,
      signalObserved: watch(signal, request), signalAlreadyAborted: readAborted(signal) === true };
  };
  const object = value => value !== null && (typeof value === 'object' || typeof value === 'function');
  // All records contain scalar metadata only. WeakMaps never become strong
  // body/reader references in snapshots or pending observer callbacks.
  const associate = (map, rows, value, key, parent, facts = {}) => {
    if (!active || !object(value)) return null;
    const prior = map.get(value);
    if (prior) {
      const missing = parent.requests.filter(request => !prior.requests.includes(request));
      const available = Math.max(0, lineageCap - prior.requests.length);
      prior.requests.push(...missing.slice(0, available));
      if (missing.length > available) { ownershipDropped++; prior.lineageTruncated = true; }
      return prior;
    }
    if (rows.length >= cap) { ownershipDropped++; return null; }
    const row = { [key]: rows.length + 1, requests: parent.requests.slice(0, lineageCap),
      lineageTruncated: parent.lineageTruncated === true || parent.requests.length > lineageCap, ...facts };
    map.set(value, row); rows.push(row); return row;
  };
  const lineage = row => row ? { scope: 'catalog-response-stream', requests: [...row.requests],
    lineageTruncated: row.lineageTruncated === true,
    ...(row.response ? { response: row.response } : {}), ...(row.stream ? { stream: row.stream } : {}),
    ...(row.reader ? { reader: row.reader } : {}) } : { scope: 'unassociated' };
  const increment = (row, key) => { row[key] = Math.min(Number.MAX_SAFE_INTEGER, (row[key] || 0) + 1); };
  const sameDescriptor = (a, b) => a?.value === b?.value && a?.get === b?.get && a?.set === b?.set
    && a?.writable === b?.writable && a?.configurable === b?.configurable && a?.enumerable === b?.enumerable;
  // Adds a diagnostic Promise reaction, never a replacement application
  // promise. This can affect scheduling/unhandled-rejection observation.
  // Only native-prototype promises without custom constructor/species are
  // accepted; no custom then/getter is called. Native callbacks are captured.
  const rejectionKind = reason => attempt(() => {
    // Never read a custom name/message accessor or coerce an arbitrary reason.
    for (let value = reason, depth = 0; object(value) && depth < 5; value = Object.getPrototypeOf(value), depth++) {
      const field = own(value, 'name');
      if (field) return 'value' in field && ['Error','TypeError','AbortError','RangeError','DOMException'].includes(field.value)
        ? field.value : 'REJECTED';
    }
    return 'REJECTED';
  }) || 'REJECTED';
  const observePromise = (result, fulfilled, rejected) => {
    if (!active) return false;
    // Bound outstanding callbacks, not total chunks. Otherwise a legitimate
    // long response would lose its eventual EOF solely after its 200th read.
    if (pendingPromiseObservations >= cap) { promiseObservationDrops++; return false; }
    const eligible = attempt(() => object(result) && Object.getPrototypeOf(result) === promisePrototype
      && !own(result, 'constructor') && sameDescriptor(own(promisePrototype, 'constructor'), promiseConstructor)
      && sameDescriptor(own(realm.Promise, Symbol.species), promiseSpecies));
    if (!eligible) { unsupportedPromises++; return false; }
    const run = work => {
      if (!active) return;
      pendingPromiseObservations--;
      try { work(); } catch { observerFailures++; }
    };
    try {
      pendingPromiseObservations++;
      Reflect.apply(nativeThen, result, [
        value => run(() => fulfilled(value)),
        reason => run(() => rejected(rejectionKind(reason))),
      ]);
      promiseObservations = Math.min(Number.MAX_SAFE_INTEGER, promiseObservations + 1);
      return true;
    } catch { pendingPromiseObservations--; unsupportedPromises++; return false; }
  };
  const patch = (target, name, observe, observeResult, observeThrow) => {
    const descriptor = target && own(target, name);
    if (!descriptor || typeof descriptor.value !== 'function'
      || (!descriptor.configurable && !descriptor.writable)) throw Error();
    const native = descriptor.value;
    const wrapper = function (...args) {
      // Diagnostic failures never mask or replace native errors, results, promise
      // identity, arguments or receiver. Opt-in side reactions never read bodies.
      const facts = active ? attempt(() => observe(this, args)) : undefined;
      let result;
      try { result = Reflect.apply(native, this, args); }
      catch (error) {
        if (active && observeThrow) attempt(() => observeThrow(facts, rejectionKind(error)));
        throw error;
      }
      if (active && observeResult) attempt(() => observeResult(this, result, facts));
      return result;
    };
    Object.defineProperty(wrapper, installedMarker, { value: true });
    Object.defineProperty(target, name, { ...descriptor, value: wrapper });
    patchRecords.push({ target, name, descriptor, wrapper, slot: 'value' });
  };
  const patchGetter = (target, name, observeResult, observeThrow) => {
    const descriptor = target && own(target, name);
    if (!descriptor?.configurable || typeof descriptor.get !== 'function') throw Error();
    const native = descriptor.get;
    const wrapper = function () {
      let result;
      try { result = Reflect.apply(native, this, []); }
      catch (error) {
        if (active && observeThrow) attempt(() => observeThrow(this, rejectionKind(error)));
        throw error;
      }
      if (active) attempt(() => observeResult(this, result));
      return result;
    };
    Object.defineProperty(wrapper, installedMarker, { value: true });
    Object.defineProperty(target, name, { ...descriptor, get: wrapper });
    patchRecords.push({ target, name, descriptor, wrapper, slot: 'get' });
  };
  const cleanup = () => {
    active = false;
    for (const info of watchers) {
      try { Reflect.apply(removeListener, info.signal, ['abort', info.listener]); }
      catch { listenerFailures++; }
      signals.delete(info.signal);
    }
    watchers.length = 0;
    for (const record of [...patchRecords].reverse()) {
      try {
        const current = own(record.target, record.name);
        const attributesMatch = current && current.configurable === record.descriptor.configurable
          && current.enumerable === record.descriptor.enumerable && current.writable === record.descriptor.writable;
        if (attributesMatch && current[record.slot] === record.wrapper
          && (record.slot !== 'get' || current.set === record.descriptor.set)) Object.defineProperty(record.target, record.name, record.descriptor);
        else if (!sameDescriptor(current, record.descriptor)) restoreFailures++;
      } catch { restoreFailures++; }
    }
    patchRecords.length = 0; closed = true;
  };
  try {
    patch(realm, 'fetch', (receiver, args) => {
      if (events.length >= cap) { dropped++; return; }
      const facts = fetchFacts(args);
      if (facts) push('fetch-call', facts);
      return facts;
    }, (receiver, result, facts) => {
      if (!trackResponseStreams || !facts) return;
      observePromise(result, value => {
        const row = associate(responses, responseRows, value, 'response', { requests: [facts.request] });
        if (row) push('fetch-response', lineage(row));
      }, error => push('fetch-rejected', { scope: 'catalog', request: facts.request, error }));
    });
    patch(realm.AbortController.prototype, 'abort', controller => {
      const signal = attempt(() => Reflect.apply(controllerSignal, controller, []));
      if (typeof readAborted(signal) !== 'boolean') return;
      const info = signals.get(signal);
      push('abort-controller-call', { scope: info ? 'catalog-fetch-signal' : 'unassociated',
        ...(info ? { requests: [...info.requests] } : {}), signalAlreadyAborted: readAborted(signal) === true });
    });
    const cancel = (target, kind, map) => patch(target, 'cancel', receiver => {
      const row = trackResponseStreams ? map.get(receiver) : null;
      if (row) increment(row, 'cancelCalls');
      push(kind + '-cancel-call', lineage(row)); return row;
    }, (receiver, result, row) => {
      if (trackResponseStreams && row) observePromise(result,
        () => { increment(row, 'cancelFulfilled'); push(kind + '-cancel-fulfilled', lineage(row)); },
        error => { increment(row, 'cancelRejected'); push(kind + '-cancel-rejected', { ...lineage(row), error }); });
    }, (row, error) => {
      if (trackResponseStreams && row) { increment(row, 'cancelThrew'); push(kind + '-cancel-threw', { ...lineage(row), error }); }
    });
    cancel(realm.ReadableStream.prototype, 'stream', streams);
    cancel(realm.ReadableStreamDefaultReader.prototype, 'reader', readers);
    if (realm.ReadableStreamBYOBReader) cancel(realm.ReadableStreamBYOBReader.prototype, 'byob-reader', readers);
    if (trackResponseStreams) {
      patchGetter(realm.Response.prototype, 'body', (receiver, result) => {
        const parent = responses.get(receiver); if (!parent) return;
        increment(parent, 'bodyAccesses');
        const row = result === null ? null : associate(streams, streamRows, result, 'stream', parent, { response: parent.response });
        push('response-body-access', { ...lineage(row || parent), response: parent.response, bodyNull: result === null });
      }, (receiver, error) => {
        const row = responses.get(receiver);
        if (row) { increment(row, 'bodyThrew'); push('response-body-threw', { ...lineage(row), error }); }
      });
      patch(realm.Response.prototype, 'clone', receiver => responses.get(receiver), (receiver, result, parent) => {
        if (!parent) return;
        const row = associate(responses, responseRows, result, 'response', parent, { cloneOf: parent.response });
        if (row) push('response-clone', { ...lineage(row), cloneOf: parent.response });
      });
      patch(realm.ReadableStream.prototype, 'tee', receiver => streams.get(receiver), (receiver, result, parent) => {
        if (!parent || !Array.isArray(result)) return;
        for (const key of ['0', '1']) {
          const field = own(result, key); if (!field || !('value' in field)) continue;
          const row = associate(streams, streamRows, field.value, 'stream', parent, { teeOf: parent.stream });
          if (row) push('stream-tee-branch', { ...lineage(row), teeOf: parent.stream });
        }
      });
      patch(realm.ReadableStream.prototype, 'getReader', receiver => streams.get(receiver), (receiver, result, parent) => {
        if (!parent) return;
        const byob = realm.ReadableStreamBYOBReader && Object.getPrototypeOf(result) === realm.ReadableStreamBYOBReader.prototype;
        const row = associate(readers, readerRows, result, 'reader', parent, { stream: parent.stream, kind: byob ? 'byob' : 'default' });
        if (row) push('stream-reader', { ...lineage(row), stream: parent.stream });
      });
      for (const target of [realm.ReadableStreamDefaultReader.prototype, realm.ReadableStreamBYOBReader?.prototype].filter(Boolean)) {
        patch(target, 'read', receiver => {
          const row = readers.get(receiver);
          if (row) { increment(row, 'readCalls'); if (row.readCalls === 1) push('reader-read-call', lineage(row)); }
          return row;
        }, (receiver, result, row) => {
          if (!row) return;
          const observed = observePromise(result, value => {
            increment(row, 'readResolved');
            const field = object(value) ? own(value, 'done') : null;
            if (!field || !('value' in field) || typeof field.value !== 'boolean') { increment(row, 'readUnknown'); return; }
            increment(row, field.value ? 'doneTrue' : 'doneFalse');
            if (field.value || row.doneFalse === 1) push('reader-read-result', { ...lineage(row), done: field.value });
          }, error => { increment(row, 'readRejected'); push('reader-read-rejected', { ...lineage(row), error }); });
          if (!observed) increment(row, 'readUnobserved');
        }, (row, error) => {
          if (row) { increment(row, 'readThrew'); push('reader-read-threw', { ...lineage(row), error }); }
        });
        patch(target, 'releaseLock', receiver => {
          const row = readers.get(receiver); if (row) increment(row, 'releaseLockCalls'); return row;
        }, (receiver, result, row) => {
          if (row) { increment(row, 'releaseLockReturned'); push('reader-release-lock', lineage(row)); }
        }, (row, error) => {
          if (row) { increment(row, 'releaseLockThrew'); push('reader-release-lock-threw', { ...lineage(row), error }); }
        });
        const closedPromises = new WeakSet();
        patchGetter(target, 'closed', (receiver, result) => {
          const row = readers.get(receiver); if (!row) return;
          increment(row, 'closedAccesses'); push('reader-closed-access', lineage(row));
          if (object(result) && closedPromises.has(result)) return;
          if (object(result)) closedPromises.add(result);
          observePromise(result,
            () => { increment(row, 'closedFulfilled'); push('reader-closed-fulfilled', lineage(row)); },
            error => { increment(row, 'closedRejected'); push('reader-closed-rejected', { ...lineage(row), error }); });
        }, (receiver, error) => {
          const row = readers.get(receiver);
          if (row) { increment(row, 'closedThrew'); push('reader-closed-threw', { ...lineage(row), error }); }
        });
      }
    }
    active = true;
  } catch { cleanup(); throw Error('BrowserCancelDiagnosticInstallFailed'); }
  const snapshot = () => ({ version: 1, capture: 'native-call-observation-only', startedAt, cap,
    active, closed, dropped, observedSignals: watchers.length, restoreFailures, listenerFailures,
    ...(trackResponseStreams ? { trackResponseStreams: true, lineageCap, ownershipDropped, unsupportedPromises,
      promiseObservations, pendingPromiseObservations, promiseObservationDrops, observerFailures,
      responses: responseRows.map(row => ({ ...row, requests: [...row.requests] })),
      streams: streamRows.map(row => ({ ...row, requests: [...row.requests] })),
      readers: readerRows.map(row => ({ ...row, requests: [...row.requests] })) } : {}),
    events: events.map(row => ({ ...row, ...(row.requests ? { requests: [...row.requests] } : {}),
      callsites: row.callsites.map(site => ({ ...site })) })) });
  const close = () => { if (!closed) cleanup(); return snapshot(); };
  return { snapshot, close };
}

module.exports = { installBrowserCancellationDiagnostic };
