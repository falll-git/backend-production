'use strict';

// Serialized into an owned disposable browser command. Keep this function
// self-contained: no require, module closure, interception, or success rules.
async function attachBrowserNetworkDiagnostic(page, options = {}) {
  const cap = Number.isInteger(options.maxEvents) && options.maxEvents > 0
    ? Math.min(options.maxEvents, 200) : 200;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  let origin;
  try {
    const url = new URL(page.url());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw Error();
    origin = url.origin;
  } catch { throw Error('CDPDiagnosticOriginInvalid'); }
  const started = now(), events = [], requests = new Map(), frames = new Map(), loaders = new Map();
  let active = false, closed = false, detached = false, dropped = 0, closing = null, nextRequest = 1;
  const number = value => Number.isFinite(value) && value >= 0 ? value : null;
  const ordinal = (map, value) => {
    if (typeof value !== 'string' || !value) return null;
    if (!map.has(value)) map.set(value, map.size + 1);
    return map.get(value);
  };
  const knownFunctions = new Set(['fetchServerResponse', 'createFetch', 'createFromFetch',
    'createFromNextFetch', 'startReadingFromStream', 'navigate', 'navigateToKnownRoute',
    'navigateToUnknownRoute', 'fetchPrefetchResponse', 'linkClicked']);
  const initiator = raw => {
    const kind = ['parser', 'script', 'preload', 'preflight', 'other'].includes(raw?.type) ? raw.type : 'other';
    const functions = [...new Set((Array.isArray(raw?.stack?.callFrames) ? raw.stack.callFrames : [])
      .slice(0, 8).map(frame => frame?.functionName).filter(name => knownFunctions.has(name)))];
    return { kind, functions };
  };
  const error = raw => ['net::ERR_ABORTED', 'net::ERR_FAILED', 'net::ERR_CONNECTION_RESET',
    'net::ERR_CONNECTION_CLOSED', 'net::ERR_TIMED_OUT', 'net::ERR_INTERNET_DISCONNECTED',
    'net::ERR_BLOCKED_BY_CLIENT', 'net::ERR_BLOCKED_BY_RESPONSE', 'net::ERR_HTTP_RESPONSE_CODE_FAILURE']
    .includes(raw) ? raw : 'OTHER_NETWORK_ERROR';
  const push = row => {
    if (!active) return;
    if (events.length >= cap) { dropped++; return; }
    events.push({ elapsedMs: number(now() - started), ...row });
  };
  // This transformer only retains allowlisted scalar facts. Raw CDP objects,
  // URLs/queries, identifiers, headers, bodies, and stack locations never persist.
  const transform = (kind, raw) => {
    if (!active || !raw || typeof raw.requestId !== 'string') return;
    if (kind === 'request') {
      let url; try { url = new URL(raw.request?.url); } catch { return; }
      if (url.origin !== origin || url.username || url.password || !(url.pathname === '/katalog' || raw.type === 'Document')) {
        requests.delete(raw.requestId); return;
      }
      if (events.length >= cap) { dropped++; return; }
      let request = requests.get(raw.requestId);
      if (!request) {
        request = { request: nextRequest++, route: url.pathname === '/katalog' ? 'catalog' : 'document' };
        requests.set(raw.requestId, request);
      }
      push({ kind, ...request, frame: ordinal(frames, raw.frameId), loader: ordinal(loaders, raw.loaderId),
        resource: ['Document', 'Fetch', 'XHR'].includes(raw.type) ? raw.type : 'Other',
        method: ['GET', 'POST', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'].includes(raw.request?.method)
          ? raw.request.method : 'OTHER', initiator: initiator(raw.initiator) });
      return;
    }
    const request = requests.get(raw.requestId);
    if (!request) return;
    if (kind === 'response') {
      push({ kind, ...request, status: Number.isInteger(raw.response?.status) && raw.response.status >= 100 && raw.response.status <= 599
        ? raw.response.status : null, bytes: number(raw.response?.encodedDataLength) });
    } else if (kind === 'finished') {
      push({ kind, ...request, bytes: number(raw.encodedDataLength) });
    } else if (kind === 'failed') {
      push({ kind, ...request, canceled: raw.canceled === true, error: error(raw.errorText) });
    }
  };
  let session;
  try { session = await page.context().newCDPSession(page); }
  catch { throw Error('CDPDiagnosticAttachFailed'); }
  const handlers = [
    ['Network.requestWillBeSent', raw => transform('request', raw)],
    ['Network.responseReceived', raw => transform('response', raw)],
    ['Network.loadingFinished', raw => transform('finished', raw)],
    ['Network.loadingFailed', raw => transform('failed', raw)],
  ];
  const removeHandlers = () => {
    let failed = false;
    for (const [name, handler] of handlers) {
      try { session.off(name, handler); } catch { failed = true; }
    }
    return failed;
  };
  try {
    for (const [name, handler] of handlers) session.on(name, handler);
    await session.send('Network.enable');
    active = true;
  } catch {
    removeHandlers();
    try { await session.detach(); } catch { /* setup failure remains failure */ }
    throw Error('CDPDiagnosticAttachFailed');
  }
  const snapshot = () => ({ version: 1, capture: 'scoped-CDP-network-metadata', startedAt:number(started), cap,
    active, closed, detached, dropped, events: events.map(row => ({ ...row,
      ...(row.initiator ? { initiator: { ...row.initiator, functions: [...row.initiator.functions] } } : {}) })) });
  const close = async () => {
    if (closing) return closing;
    closing = (async () => {
      active = false;
      const handlerFailure = removeHandlers();
      try { await session.detach(); detached = true; }
      catch { throw Error('CDPDiagnosticDetachFailed'); }
      finally { closed = true; requests.clear(); frames.clear(); loaders.clear(); }
      if (handlerFailure) throw Error('CDPDiagnosticHandlersNotRemoved');
      return snapshot();
    })();
    return closing;
  };
  return { snapshot, close };
}

module.exports = { attachBrowserNetworkDiagnostic };
