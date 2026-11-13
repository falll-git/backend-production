'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { probeOwnedUiHealth } = require('./sj-owned-ui-health');

async function fixture(handler, run) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(server.address().port); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('owned health probes the exact loopback endpoint and accepts completed 2xx', async () => {
  await fixture((req, res) => { assert.equal(req.url, '/api/health'); res.writeHead(204).end(); }, async port => {
    assert.equal(await probeOwnedUiHealth(port), 204);
  });
});

test('owned health returns non-2xx without following redirects', async () => {
  let requests = 0;
  await fixture((req, res) => { requests++; res.writeHead(302, { Location: '/elsewhere' }).end(); }, async port => {
    assert.equal(await probeOwnedUiHealth(port), 302);
    assert.equal(requests, 1);
  });
});

test('owned health bounds the entire response even if headers have arrived', async () => {
  await fixture((_req, res) => { res.writeHead(200); res.write('pending'); }, async port => {
    await assert.rejects(probeOwnedUiHealth(port, 30), /OWNED_UI_HEALTH_TIMEOUT/);
  });
});

test('owned health rejects oversized responses', async () => {
  await fixture((_req, res) => { res.writeHead(200); res.end(Buffer.alloc(65537)); }, async port => {
    await assert.rejects(probeOwnedUiHealth(port), /OWNED_UI_HEALTH_BODY_TOO_LARGE/);
  });
});

test('owned health rejects a disconnected child', async () => {
  await fixture((_req, res) => res.destroy(), async port => {
    await assert.rejects(probeOwnedUiHealth(port));
  });
});

test('owned health rejects arbitrary origins, invalid ports and unbounded timeouts', async () => {
  for (const port of ['https://example.test', '4320', 0, 65536, 1.5]) {
    await assert.rejects(probeOwnedUiHealth(port), /INVALID_OWNED_UI_HEALTH_PROBE/);
  }
  for (const timeout of [0, 3001, Infinity]) {
    await assert.rejects(probeOwnedUiHealth(4320, timeout), /INVALID_OWNED_UI_HEALTH_PROBE/);
  }
});
