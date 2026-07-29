const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");

const clientErrorService = require("../modules/client-errors/clientErrors.service");

const recorded = [];
const originalRecordClientError = clientErrorService.recordClientError;
clientErrorService.recordClientError = (report, requestId) => {
  recorded.push({ report, requestId });
};
const app = require("../app");

test.after(() => {
  clientErrorService.recordClientError = originalRecordClientError;
});

function validReport() {
  return {
    event_id: "123e4567-e89b-42d3-a456-426614174000",
    event_type: "render_error",
    boundary: "dashboard",
    error_name: "TypeError",
    error_digest: "digest-001",
    route_group: "dashboard",
    release: "commit-abc123",
    online: true,
    occurred_at: "2026-07-26T10:00:00.000Z",
  };
}

test("API menerima laporan client tanpa autentikasi dan mempertahankan request ID", async () => {
  const response = await request(app)
    .post("/api/v1/client-errors")
    .set("Content-Type", "application/json")
    .set("X-Client-Error-Report", "1")
    .set("X-Request-Id", "client-error:123e4567-e89b-42d3-a456-426614174000")
    .send(validReport());

  assert.equal(response.statusCode, 202);
  assert.equal(
    response.headers["x-request-id"],
    "client-error:123e4567-e89b-42d3-a456-426614174000",
  );
  assert.equal(response.body.data.event_id, validReport().event_id);
  assert.equal(recorded.length, 1);
  assert.equal(
    recorded[0].requestId,
    "client-error:123e4567-e89b-42d3-a456-426614174000",
  );
});

test("API menolak content type, penanda, dan payload yang tidak valid", async () => {
  const nonJson = await request(app)
    .post("/api/v1/client-errors")
    .set("X-Client-Error-Report", "1")
    .type("form")
    .send(validReport());
  assert.equal(nonJson.statusCode, 415);

  const missingMarker = await request(app)
    .post("/api/v1/client-errors")
    .send(validReport());
  assert.equal(missingMarker.statusCode, 400);

  const invalidPayload = await request(app)
    .post("/api/v1/client-errors")
    .set("X-Client-Error-Report", "1")
    .send({ ...validReport(), error_name: "<script>alert(1)</script>" });
  assert.equal(invalidPayload.statusCode, 422);
  assert.equal(typeof invalidPayload.body.request_id, "string");

  const forbiddenFields = await request(app)
    .post("/api/v1/client-errors")
    .set("X-Client-Error-Report", "1")
    .send({
      ...validReport(),
      message: "password dan data nasabah tidak boleh diteruskan",
      stack: "stack rahasia",
    });
  assert.equal(forbiddenFields.statusCode, 422);
  assert.equal(recorded.length, 1);
});
