const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createDrainMiddleware,
  isHealthPath,
} = require("./drain.middleware");

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

test("health dan readiness tetap dapat diakses selama drain", () => {
  assert.equal(isHealthPath("/health"), true);
  assert.equal(isHealthPath("/api/v1/ready"), true);
  assert.equal(isHealthPath("/api/v1/debtors"), false);

  const middleware = createDrainMiddleware({ isDraining: () => true });
  let nextCalls = 0;
  middleware(
    { path: "/api/v1/ready" },
    createResponse(),
    () => {
      nextCalls += 1;
    },
  );
  assert.equal(nextCalls, 1);
});

test("request baru ditolak 503 setelah instance memasuki drain", () => {
  const middleware = createDrainMiddleware({
    isDraining: () => true,
    retryAfterSeconds: 7,
  });
  const response = createResponse();
  let nextCalls = 0;

  middleware(
    {
      path: "/api/v1/debtors",
      requestId: "request-drain-123",
    },
    response,
    () => {
      nextCalls += 1;
    },
  );

  assert.equal(nextCalls, 0);
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers.Connection, "close");
  assert.equal(response.headers["Retry-After"], "7");
  assert.equal(response.body.request_id, "request-drain-123");
});
