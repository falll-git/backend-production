const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const Joi = require("joi");
const request = require("supertest");

const app = require("../app");
const apiModules = require("../routes/api-modules");
const validate = require("./validate.middleware");

const BODYLESS_MUTATIONS = new Set([
  "POST /auth/logout",
  "POST /users/:id/send-invite",
  "PATCH /incoming-mails/:id/complete",
  "PATCH /memorandums/:id/complete",
  "POST /watermark-settings/image",
  "POST /watermark-settings/apply",
  "POST /debtors/collaterals/expiry-import",
  "POST /debtor-imports/slik/:jobId/retry",
  "POST /debtor-imports/master",
  "POST /debtor-imports/collectibility",
  "PATCH /notifications/read-all",
  "PATCH /notifications/:id/read",
]);

function routePaths(layer) {
  return Array.isArray(layer.route.path)
    ? layer.route.path.map(String)
    : [String(layer.route.path)];
}

function mutationEntries() {
  const entries = [];
  for (const apiModule of apiModules) {
    for (const layer of apiModule.router.stack || []) {
      if (!layer.route) continue;
      const methods = Object.keys(layer.route.methods || {}).filter(
        (method) =>
          layer.route.methods[method] && ["post", "put", "patch"].includes(method),
      );
      const bodyValidations = (layer.route.stack || [])
        .map((routeLayer) => routeLayer.handle?.validation)
        .filter((validation) => validation?.source === "body");
      for (const path of routePaths(layer)) {
        for (const method of methods) {
          entries.push({
            key: `${method.toUpperCase()} ${apiModule.path}${path}`,
            bodyValidations,
          });
        }
      }
    }
  }
  return entries;
}

test("seluruh mutation route memakai schema body atau termasuk action tanpa body yang diaudit", () => {
  const entries = mutationEntries();
  assert.equal(entries.length, 104);
  const withoutValidation = entries
    .filter((entry) => entry.bodyValidations.length === 0)
    .map((entry) => entry.key)
    .sort();
  assert.deepEqual(withoutValidation, [...BODYLESS_MUTATIONS].sort());
});

test("seluruh schema mutation menolak atau membuang field mass-assignment asing", () => {
  const entries = mutationEntries();
  let validatedRoutes = 0;
  for (const entry of entries) {
    for (const validation of entry.bodyValidations) {
      validatedRoutes += 1;
      const result = validation.schema.validate(
        { __mass_assignment_probe: "attacker-controlled" },
        { abortEarly: false, stripUnknown: true },
      );
      assert.ok(
        result.error ||
          !Object.prototype.hasOwnProperty.call(
            result.value || {},
            "__mass_assignment_probe",
          ),
        `${entry.key} menerima field asing mass-assignment`,
      );
    }
  }
  assert.equal(validatedRoutes, 92);
});

test("middleware validasi membuang field audit yang tidak ada di schema", async () => {
  const validationApp = express();
  validationApp.use(express.json());
  validationApp.post(
    "/resource",
    validate(Joi.object({ name: Joi.string().required() })),
    (req, res) => res.json(req.body),
  );

  const response = await request(validationApp)
    .post("/resource")
    .send({
      name: "aman",
      created_by: "attacker",
      deleted_at: "2026-01-01",
      is_active: true,
    })
    .expect(200);
  assert.deepEqual(response.body, { name: "aman" });
});

test("seluruh mount file menolak traversal dan dotfile", async () => {
  const prefixes = [
    "/api/persuratan-files",
    "/api/digital-archive-files",
    "/api/watermark-assets",
    "/api/watermarked-files",
  ];
  const probes = [
    "/..%2f..%2fpackage.json",
    "/%2e%2e/%2e%2e/package.json",
    "/.env",
  ];

  for (const prefix of prefixes) {
    for (const probe of probes) {
      const response = await request(app).get(`${prefix}${probe}`);
      assert.notEqual(
        response.status,
        200,
        `${prefix}${probe} tidak boleh mengembalikan file`,
      );
      assert.equal(
        String(response.text || "").includes('"name": "be-ruwang-arsip"'),
        false,
      );
      assert.equal(
        String(response.text || "").includes("DATABASE_URL="),
        false,
      );
    }
  }
});
