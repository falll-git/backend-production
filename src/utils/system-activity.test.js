const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ACTION_LABELS,
  buildActivityPayload,
  classifyAction,
  extractSafeResponseContext,
  resolveRouteDefinition,
  shouldTrackRequest,
} = require("./system-activity");

test("setiap kode aksi memiliki label filter yang dapat dibedakan", () => {
  const labels = Object.values(ACTION_LABELS);
  assert.equal(new Set(labels).size, labels.length);
});

test("route mapping mencakup modul utama termasuk persuratan", () => {
  assert.equal(resolveRouteDefinition("/api/incoming-mails").module, "PERSURATAN");
  assert.equal(resolveRouteDefinition("/api/digital-documents").module, "ARSIP_DIGITAL");
  assert.equal(resolveRouteDefinition("/api/debtors").module, "INFORMASI_DEBITUR");
  assert.equal(resolveRouteDefinition("/api/legal/deposits").module, "MANAJEMEN_LEGAL");
  assert.equal(resolveRouteDefinition("/api/collateral-types").module, "PARAMETER");
  assert.equal(resolveRouteDefinition("/api/v1/incoming-mails").module, "PERSURATAN");
  assert.equal(resolveRouteDefinition("/api/v1/debtors").module, "INFORMASI_DEBITUR");
});

test("aksi khusus lebih diprioritaskan daripada metode HTTP", () => {
  assert.equal(classifyAction("PATCH", "/api/incoming-mails/1/complete"), "COMPLETE");
  assert.equal(classifyAction("POST", "/api/debtor-imports/upload"), "UPLOAD");
  assert.equal(classifyAction("GET", "/api/debtor-reports/export"), "EXPORT");
  assert.equal(classifyAction("DELETE", "/api/users/1"), "DELETE");
  assert.equal(classifyAction("POST", "/api/v1/auth/login"), "LOGIN");
});

test("response context hanya mengambil identitas aman", () => {
  const context = extractSafeResponseContext({
    status: true,
    data: {
      data: { id: "user-1", username: "admin", password: "secret" },
      token: "access-token",
    },
  });

  assert.deepEqual(context, {
    actor_id: "user-1",
    entity_id: "user-1",
    object_label: "admin",
    message: null,
  });
  assert.equal(JSON.stringify(context).includes("secret"), false);
  assert.equal(JSON.stringify(context).includes("access-token"), false);
});

test("hanya request sukses yang relevan dicatat", () => {
  assert.equal(
    shouldTrackRequest({ method: "POST", path: "/api/memorandums", statusCode: 201 }),
    true,
  );
  assert.equal(
    shouldTrackRequest({ method: "GET", path: "/api/memorandums", statusCode: 200 }),
    false,
  );
  assert.equal(
    shouldTrackRequest({ method: "GET", path: "/api/digital-archive-files/a.pdf", statusCode: 200 }),
    true,
  );
  assert.equal(
    shouldTrackRequest({ method: "POST", path: "/api/auth/refresh", statusCode: 200 }),
    false,
  );
  assert.equal(
    shouldTrackRequest({ method: "POST", path: "/api/auth/login", statusCode: 401 }),
    false,
  );
  assert.equal(
    shouldTrackRequest({ method: "GET", path: "/api/activity-centre", statusCode: 200 }),
    false,
  );
  assert.equal(
    shouldTrackRequest({ method: "GET", path: "/api/v1/activity-centre", statusCode: 200 }),
    false,
  );
  assert.equal(
    shouldTrackRequest({ method: "POST", path: "/api/v1/divisions", statusCode: 201 }),
    true,
  );
  assert.equal(
    shouldTrackRequest({
      method: "GET",
      path: "/api/activity-centre/export",
      statusCode: 200,
    }),
    true,
  );
});

test("payload tidak membawa body request atau kredensial", () => {
  const payload = buildActivityPayload({
    actor_id: "user-1",
    method: "POST",
    path: "/api/auth/login",
    statusCode: 200,
    requestId: "request-1",
    userAgent: "browser",
    responseContext: { actor_id: "user-1", object_label: "admin" },
  });

  assert.equal(payload.module, "AUTH");
  assert.equal(payload.action, "LOGIN");
  assert.equal(payload.request_id, "request-1");
  assert.equal(Object.hasOwn(payload, "password"), false);
  assert.equal(Object.hasOwn(payload, "token"), false);
});
