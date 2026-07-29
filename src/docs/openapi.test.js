const test = require("node:test");
const assert = require("node:assert/strict");
const apiModules = require("../routes/api-modules");
const { buildOpenApiSpec, routeEntries, toOpenApiPath } = require("./openapi");

test("konversi parameter route Express menjadi parameter OpenAPI", () => {
  assert.equal(toOpenApiPath("/:id"), "/{id}");
  assert.equal(toOpenApiPath("/:kind/:id"), "/{kind}/{id}");
  assert.equal(toOpenApiPath("/"), "/");
});

test("OpenAPI memuat setiap method dan path yang terdaftar pada router v1", () => {
  const spec = buildOpenApiSpec();
  const missing = [];

  for (const apiModule of apiModules) {
    for (const route of routeEntries(apiModule)) {
      if (!spec.paths[route.path]?.[route.method]) {
        missing.push(`${route.method.toUpperCase()} ${route.path}`);
      }
    }
  }

  assert.deepEqual(missing, []);
  assert.ok(Object.keys(spec.paths).length > 100);
});

test("OpenAPI memakai operationId unik dan tidak mempublikasikan secret", () => {
  const spec = buildOpenApiSpec();
  const operationIds = [];

  for (const pathItem of Object.values(spec.paths)) {
    for (const operation of Object.values(pathItem)) {
      operationIds.push(operation.operationId);
    }
  }

  assert.equal(new Set(operationIds).size, operationIds.length);
  const serialized = JSON.stringify(spec);
  assert.equal(serialized.includes(process.env.JWT_SECRET || "__absent__"), false);
  assert.equal(serialized.includes(process.env.DATABASE_URL || "__absent__"), false);
});

test("OpenAPI memakai schema Joi runtime untuk request body", () => {
  const spec = buildOpenApiSpec();
  const loginSchema =
    spec.paths["/auth/login"].post.requestBody.content["application/json"].schema;
  const divisionSchema =
    spec.paths["/divisions"].post.requestBody.content["application/json"].schema;

  assert.deepEqual(new Set(loginSchema.required), new Set(["username", "password"]));
  assert.equal(loginSchema.properties.username.type, "string");
  assert.equal(loginSchema.properties.password.type, "string");
  assert.deepEqual(divisionSchema.required, ["name"]);
  assert.equal(divisionSchema.properties.name.type, "string");
});

test("OpenAPI mendokumentasikan endpoint error frontend sebagai public JSON-only", () => {
  const operation = buildOpenApiSpec().paths["/client-errors"].post;

  assert.deepEqual(operation.security, []);
  assert.equal(operation.requestBody.required, true);
  assert.ok(operation.requestBody.content["application/json"]);
  assert.equal(operation.requestBody.content["multipart/form-data"], undefined);
  assert.ok(operation.responses[202]);
  assert.ok(
    operation.parameters.some(
      (parameter) =>
        parameter.in === "header" &&
        parameter.name === "X-Client-Error-Report",
    ),
  );
});

test("OpenAPI mendokumentasikan respons rate limit dan store unavailable", () => {
  const spec = buildOpenApiSpec();
  assert.ok(spec.components.responses.RateLimited.headers["Retry-After"]);
  assert.ok(spec.components.responses.RateLimited.headers["RateLimit-Reset"]);

  const operation = spec.paths["/users"].get;
  assert.equal(
    operation.responses[429].$ref,
    "#/components/responses/RateLimited",
  );
  assert.equal(
    operation.responses[503].$ref,
    "#/components/responses/ServiceUnavailable",
  );
});
