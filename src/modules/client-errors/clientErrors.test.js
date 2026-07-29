const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildClientErrorLogFields,
  recordClientError,
} = require("./clientErrors.service");
const { reportSchema } = require("./clientErrors.validation");
const {
  CLIENT_ERROR_REPORT_HEADER,
  requireReportRequest,
} = require("./clientErrors.route");

const validReport = Object.freeze({
  event_id: "123e4567-e89b-42d3-a456-426614174000",
  event_type: "api_error",
  boundary: "api",
  error_name: "ApiRequestError",
  route_group: "dashboard",
  release: "release-2026.07.26",
  related_request_id: "request-12345678",
  api_resource: "debtors",
  response_status: 503,
  online: true,
  occurred_at: "2026-07-26T10:00:00.000Z",
});

function responseStub() {
  return {
    statusCode: 200,
    payload: null,
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

test("schema menerima metadata allowlist yang valid", () => {
  const result = reportSchema.validate(validReport);

  assert.equal(result.error, undefined);
  assert.deepEqual(result.value, validReport);
});

test("schema menolak field di luar allowlist termasuk message dan stack", () => {
  const result = reportSchema.validate(
    {
      ...validReport,
      message: "nomor rekening dan password",
      stack: "stack rahasia",
      url: "https://example.test/debtors/123?token=rahasia",
      authorization: "Bearer rahasia",
    },
    { abortEarly: false },
  );

  assert.ok(result.error);
  assert.deepEqual(
    new Set(result.error.details.map((detail) => detail.path[0])),
    new Set(["message", "stack", "url", "authorization"]),
  );
});

test("schema menolak identifier, resource, enum, dan status yang tidak aman", () => {
  const result = reportSchema.validate(
    {
      ...validReport,
      error_name: "Error <script>",
      api_resource: "debtors/123",
      response_status: 999,
    },
    { abortEarly: false },
  );

  assert.ok(result.error);
  assert.equal(result.error.details.length, 3);
});

test("schema menolak nama error bebas dan digest di luar error boundary", () => {
  const result = reportSchema.validate(
    {
      ...validReport,
      error_name: "NamaNasabah123",
      error_digest: "data-yang-tidak-boleh-masuk",
    },
    { abortEarly: false },
  );

  assert.ok(result.error);
  assert.deepEqual(
    new Set(result.error.details.map((detail) => detail.path[0])),
    new Set(["error_name", "error_digest"]),
  );
});

test("service hanya memetakan metadata terverifikasi ke structured log dan span", () => {
  const writes = [];
  const spanEvents = [];
  const fields = recordClientError(validReport, "report-request-123", {
    logger: {
      error(payload, message) {
        writes.push({ payload, message });
      },
    },
    recordClientErrorReport(payload) {
      spanEvents.push(payload);
    },
  });

  assert.equal(fields.event, "frontend_error_reported");
  assert.equal(fields.client_related_request_id, "request-12345678");
  assert.equal(fields.client_response_status, 503);
  assert.equal(fields.message, undefined);
  assert.equal(fields.stack, undefined);
  assert.deepEqual(writes, [
    { payload: fields, message: "Frontend error reported" },
  ]);
  assert.deepEqual(spanEvents, [fields]);
});

test("build log tidak meneruskan properti di luar allowlist", () => {
  const fields = buildClientErrorLogFields(
    { ...validReport, password: "rahasia", payload: { ktp: "3275" } },
    "report-request-456",
  );

  assert.equal(fields.password, undefined);
  assert.equal(fields.payload, undefined);
  assert.equal(fields.request_id, "report-request-456");
});

test("middleware mewajibkan JSON dan penanda request khusus", () => {
  const wrongContentResponse = responseStub();
  requireReportRequest(
    { is: () => false, get: () => "1" },
    wrongContentResponse,
    () => assert.fail("request non-JSON tidak boleh diteruskan"),
  );
  assert.equal(wrongContentResponse.statusCode, 415);

  const missingHeaderResponse = responseStub();
  requireReportRequest(
    { is: () => true, get: () => undefined },
    missingHeaderResponse,
    () => assert.fail("request tanpa penanda tidak boleh diteruskan"),
  );
  assert.equal(missingHeaderResponse.statusCode, 400);

  let nextCalled = false;
  requireReportRequest(
    {
      is: (contentType) => contentType === "application/json",
      get: (header) =>
        header === CLIENT_ERROR_REPORT_HEADER ? "1" : undefined,
    },
    responseStub(),
    () => {
      nextCalled = true;
    },
  );
  assert.equal(nextCalled, true);
});
