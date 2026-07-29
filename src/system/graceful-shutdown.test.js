const assert = require("node:assert/strict");
const test = require("node:test");
const {
  configureHttpServer,
  createGracefulShutdown,
  resolveHttpServerSettings,
} = require("./graceful-shutdown");

test("HTTP server memakai timeout eksplisit yang konsisten untuk reverse proxy", () => {
  const server = {};
  const settings = configureHttpServer(server, {
    HTTP_KEEP_ALIVE_TIMEOUT_MS: "65000",
    HTTP_HEADERS_TIMEOUT_MS: "66000",
    HTTP_REQUEST_TIMEOUT_MS: "300000",
    HTTP_MAX_HEADERS_COUNT: "200",
  });

  assert.deepEqual(settings, {
    keepAliveTimeoutMs: 65000,
    headersTimeoutMs: 66000,
    requestTimeoutMs: 300000,
    maxHeadersCount: 200,
  });
  assert.equal(server.keepAliveTimeout, 65000);
  assert.equal(server.headersTimeout, 66000);
  assert.equal(server.requestTimeout, 300000);
  assert.equal(server.maxHeadersCount, 200);
});

test("headers timeout wajib lebih besar dari keep-alive timeout", () => {
  assert.throws(
    () =>
      resolveHttpServerSettings({
        HTTP_KEEP_ALIVE_TIMEOUT_MS: "65000",
        HTTP_HEADERS_TIMEOUT_MS: "65000",
      }),
    /harus lebih besar/,
  );
});

test("graceful shutdown menandai drain, menutup idle connection, dan idempoten", async () => {
  let closeCalls = 0;
  let closeIdleCalls = 0;
  let cleanupCalls = 0;
  let drainCalls = 0;
  const exits = [];
  const waits = [];
  const server = {
    close(callback) {
      closeCalls += 1;
      callback();
    },
    closeIdleConnections() {
      closeIdleCalls += 1;
    },
  };
  const manager = createGracefulShutdown({
    server,
    cleanup: async () => {
      cleanupCalls += 1;
    },
    beginDrain: () => {
      drainCalls += 1;
    },
    drainMs: 25,
    timeoutMs: 1000,
    waitFn: async (duration) => {
      waits.push(duration);
    },
    logger: { log() {}, error() {} },
    exit: (code) => exits.push(code),
  });

  const first = manager.shutdown("SIGTERM");
  const second = manager.shutdown("SIGINT");
  assert.equal(first, second);
  assert.equal(await first, 0);
  assert.deepEqual(waits, [25]);
  assert.equal(drainCalls, 1);
  assert.equal(closeCalls, 1);
  assert.equal(closeIdleCalls, 1);
  assert.equal(cleanupCalls, 1);
  assert.deepEqual(exits, [0]);
});
