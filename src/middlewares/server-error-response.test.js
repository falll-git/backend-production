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
