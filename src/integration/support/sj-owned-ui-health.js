'use strict';
const http = require('node:http');

// The owned harness needs HTTP only on its loopback child, never a redirect or
// caller-supplied network origin. Bound both the request and drained response.
function probeOwnedUiHealth(port, timeoutMs = 3000) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3000) {
    return Promise.reject(new Error('INVALID_OWNED_UI_HEALTH_PROBE'));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { request.destroy(); reject(error); }
      else resolve(status);
    };
    const request = http.get({ hostname: '127.0.0.1', port, path: '/api/health', agent: false }, response => {
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 65536) finish(new Error('OWNED_UI_HEALTH_BODY_TOO_LARGE'));
      });
      response.on('error', error => finish(error));
      response.on('end', () => finish(null, response.statusCode));
      response.resume();
    });
    const timer = setTimeout(() => finish(new Error('OWNED_UI_HEALTH_TIMEOUT')), timeoutMs);
    request.on('error', error => finish(error));
  });
}

module.exports = { probeOwnedUiHealth };
