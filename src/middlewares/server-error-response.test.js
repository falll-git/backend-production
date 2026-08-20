const assert = require("node:assert/strict");
const test = require("node:test");

const serverErrorResponse = require("./server-error-response.middleware");

function createResponse(statusCode) {
  const response = {
    statusCode,
    payload: null,
    json(body) {
      this.payload = body;
      return this;
    },
  };

  return response;
}

test("masks internal messages on server errors", () => {
  const req = {
    requestId: "request-123",
  };
  const res = createResponse(500);

  serverErrorResponse(req, res, () => {});
  res.json({
    status: false,
    message: "password authentication failed for database",
  });

  assert.deepEqual(res.payload, {
    status: false,
    success: false,
    request_id: "request-123",
    message: "Internal server error",
  });
});

test("preserves expected client error messages", () => {
  const req = {
    requestId: "request-456",
  };
  const res = createResponse(422);

  serverErrorResponse(req, res, () => {});
  res.json({
    status: false,
    message: "Payload tidak valid",
  });

  assert.deepEqual(res.payload, {
    status: false,
    success: false,
    request_id: "request-456",
    message: "Payload tidak valid",
  });
});

test("preserves allowlisted operational 503 messages without exposing internals", () => {
  const req = { requestId: "request-operational-503" };
  const res = createResponse(503);

  serverErrorResponse(req, res, () => {});
  res.json({
    status: false,
    code: "RATE_LIMIT_STORE_UNAVAILABLE",
    message:
      "Layanan pembatasan permintaan sedang tidak tersedia. Silakan coba lagi.",
  });

  assert.deepEqual(res.payload, {
    status: false,
    success: false,
    code: "RATE_LIMIT_STORE_UNAVAILABLE",
    request_id: "request-operational-503",
    message:
      "Layanan pembatasan permintaan sedang tidak tersedia. Silakan coba lagi.",
  });
});

test("allowlist tidak dapat dipakai untuk melewatkan pesan infrastruktur", () => {
  const req = { requestId: "request-unsafe-operational-503" };
  const res = createResponse(503);

  serverErrorResponse(req, res, () => {});
  res.json({
    status: false,
    code: "RATE_LIMIT_STORE_UNAVAILABLE",
    message: "connect ECONNREFUSED redis://internal:6379",
  });

  assert.equal(res.payload.message, "Internal server error");
});

test("masks infrastructure details even when a controller used status 400", () => {
  const req = { requestId: "request-unsafe-client-error" };
  const res = createResponse(400);

  serverErrorResponse(req, res, () => {});
  res.json({
    status: false,
    message: "Invalid prisma.users.findMany() invocation in D:\\app\\service.js",
  });

  assert.deepEqual(res.payload, {
    status: false,
    success: false,
    request_id: "request-unsafe-client-error",
    message: "Internal server error",
  });
});
