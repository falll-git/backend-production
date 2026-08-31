const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const originalApiDocsEnabled = process.env.API_DOCS_ENABLED;
process.env.API_DOCS_ENABLED = "true";
const app = require("../app");
const { buildOpenApiSpec } = require("../docs/openapi");
if (originalApiDocsEnabled === undefined) {
  delete process.env.API_DOCS_ENABLED;
} else {
  process.env.API_DOCS_ENABLED = originalApiDocsEnabled;
}

test("API v1 menjadi kontrak utama tanpa header deprecated", async () => {
  const response = await request(app).get("/api/v1/").expect(200);

  assert.equal(response.headers["x-api-version"], "1");
  assert.equal(response.headers["x-api-deprecated"], undefined);
  assert.match(response.headers["cache-control"], /private/);
  assert.match(response.headers["cache-control"], /no-store/);
  assert.equal(response.body.data.version, "1");
  assert.equal(response.body.data.documentation, "/api/v1/docs/");
});

test("modul Seputar Jaminan tidak menggandakan segmen versi API", async () => {
  const canonical = await request(app).get(
    "/api/v1/seputar-jaminan/dashboard",
  );
  const duplicated = await request(app).get(
    "/api/v1/v1/seputar-jaminan/dashboard",
  );

  assert.equal(canonical.statusCode, 401);
  assert.equal(duplicated.statusCode, 404);
});

test("jalur /api lama tetap kompatibel dan menunjukkan successor version", async () => {
  const response = await request(app).get("/api/").expect(200);

  assert.equal(response.headers["x-api-version"], "1");
  assert.equal(response.headers["x-api-deprecated"], "true");
  assert.match(response.headers["cache-control"], /no-store/);
  assert.match(response.headers.warning, /use \/api\/v1/);
  assert.match(response.headers.link, /<\/api\/v1\/>/);
});

test("OpenAPI JSON dapat dibaca dan mendokumentasikan route v1", async () => {
  const response = await request(app)
    .get("/api/v1/openapi.json")
    .expect(200)
    .expect("Content-Type", /json/);

  assert.equal(response.headers["x-api-version"], "1");
  assert.equal(response.body.openapi, "3.1.0");
  assert.ok(Object.keys(response.body.paths).length > 100);
  assert.ok(response.body.paths["/auth/login"].post);
  assert.ok(response.body.paths["/divisions/{id}"].put);
});

test("liveness tidak memakai cache dan respons 404 memiliki request id", async () => {
  const liveness = await request(app).get("/health").expect(200);
  assert.match(liveness.headers["cache-control"], /no-store/);
  assert.equal(liveness.body.data.state, "alive");

  const missing = await request(app).get("/route-yang-tidak-ada").expect(404);
  assert.equal(missing.body.status, false);
  assert.equal(missing.body.success, false);
  assert.equal(typeof missing.body.request_id, "string");
});

test("API tidak lagi mempublikasikan MFA dan pengelolaan perangkat akun", async () => {
  await request(app).post("/api/v1/auth/mfa/verify-login").send({}).expect(404);
  await request(app).get("/api/v1/auth/mfa/status").expect(404);
  await request(app).get("/api/v1/auth/sessions").expect(404);

  const paths = buildOpenApiSpec().paths;
  assert.equal(paths["/auth/mfa/verify-login"], undefined);
  assert.equal(paths["/auth/mfa/status"], undefined);
  assert.equal(paths["/auth/sessions"], undefined);
});
