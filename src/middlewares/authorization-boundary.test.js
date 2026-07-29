const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");
const app = require("../app");
const { buildOpenApiSpec } = require("../docs/openapi");

function requiresBearer(operation) {
  const security = operation.security || [];
  return security.length > 0 && security.every(
    (requirement) => Object.prototype.hasOwnProperty.call(requirement, "bearerAuth"),
  );
}

function concretePath(pathname) {
  return pathname.replace(/\{[^}]+\}/g, "00000000-0000-4000-8000-000000000001");
}

test("seluruh operasi OpenAPI berproteksi Bearer menolak request tanpa token", async () => {
  const spec = buildOpenApiSpec();
  const protectedOperations = [];

  for (const [pathname, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!requiresBearer(operation)) continue;
      protectedOperations.push({ pathname, method });
    }
  }

  assert.ok(protectedOperations.length > 100);
  for (const operation of protectedOperations) {
    const response = await request(app)
      [operation.method](`/api/v1${concretePath(operation.pathname)}`)
      .send({});
    assert.equal(
      response.status,
      401,
      `${operation.method.toUpperCase()} ${operation.pathname} menghasilkan ${response.status}`,
    );
  }
});
