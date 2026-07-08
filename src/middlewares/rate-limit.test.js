const test = require("node:test");
const assert = require("node:assert/strict");

const { createRateLimiter } = require("./rate-limit.middleware");

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test("rate limiter meneruskan request sampai batas dan menolak sisanya", () => {
  const limiter = createRateLimiter({
    windowMs: 60_000,
    max: 2,
    keyGenerator: () => "same-key",
  });
  const request = {};

  for (let index = 0; index < 2; index += 1) {
    const response = createResponse();
    let continued = false;
    limiter(request, response, () => {
      continued = true;
    });
    assert.equal(continued, true);
    assert.equal(response.statusCode, 200);
  }

  const blockedResponse = createResponse();
  let continued = false;
  limiter(request, blockedResponse, () => {
    continued = true;
  });

  assert.equal(continued, false);
  assert.equal(blockedResponse.statusCode, 429);
  assert.equal(blockedResponse.payload.status, false);
  assert.match(blockedResponse.headers["Retry-After"], /^\d+$/);
});

test("rate limiter tetap berjalan setelah menerima banyak kunci unik", () => {
  let keyIndex = 0;
  const limiter = createRateLimiter({
    windowMs: 60_000,
    max: 1,
    keyGenerator: () => `key-${keyIndex++}`,
  });

  for (let index = 0; index < 5100; index += 1) {
    const response = createResponse();
    let continued = false;
    limiter({}, response, () => {
      continued = true;
    });
    assert.equal(continued, true);
  }
});
