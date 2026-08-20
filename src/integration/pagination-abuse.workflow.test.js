const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");

const { loadEnv } = require("../config/env");

loadEnv();

const apiModules = require("../routes/api-modules");
const {
  createIntegrationFixture,
  loginAgent,
  readAdminCredentials,
} = require("./support/integration-test-helpers");

const SAFE_UUID = "00000000-0000-4000-8000-000000000001";
const EXPECTED_GET_ROUTE_COUNT = 117;

function concretePath(modulePath, routePath) {
  return `${modulePath}${routePath}`
    .replace(/:kind(?:\([^)]*\))?\??/g, "action-plan")
    .replace(/:[A-Za-z0-9_]+(?:\([^)]*\))?\??/g, SAFE_UUID)
    .replace(/\/$/, "") || "/";
}

function getRoutePaths() {
  const routes = [];
  for (const apiModule of apiModules) {
    for (const layer of apiModule.router.stack || []) {
      if (!layer.route?.methods?.get) continue;
      const paths = Array.isArray(layer.route.path)
        ? layer.route.path
        : [layer.route.path];
      for (const routePath of paths) {
        routes.push(concretePath(apiModule.path, String(routePath)));
      }
    }
  }
  return routes;
}

test(
  "pagination abuse pada seluruh GET API tidak memicu 5xx atau limit tak terbatas",
  { skip: process.env.RUN_CRITICAL_DB_INTEGRATION !== "true" },
  async (t) => {
    const app = require("../app");
    const prisma = require("../config/prisma-system");
    const fixture = createIntegrationFixture(prisma, "Pagination abuse workflow");
    const agent = request.agent(app);
    const credentials = readAdminCredentials();
    let accessToken = null;

    t.after(async () => {
      if (accessToken) {
        await agent
          .post("/api/v1/auth/logout")
          .set("User-Agent", fixture.userAgent)
          .set("Authorization", `Bearer ${accessToken}`)
          .catch(() => {});
      }
      await fixture.cleanup();
      await prisma.$disconnect();
    });

    const login = await loginAgent(agent, credentials, fixture.userAgent);
    accessToken = login.accessToken;
    const routes = getRoutePaths();
    assert.equal(routes.length, EXPECTED_GET_ROUTE_COUNT);

    for (const route of routes) {
      const response = await agent
        .get(`/api/v1${route}`)
        .query({
          page: "-999999999",
          limit: "999999999",
          offset: "-999999999",
        })
        .set("User-Agent", fixture.userAgent)
        .set(login.authorization);

      assert.ok(
        response.status < 500,
        `GET ${route} menghasilkan status ${response.status}`,
      );
      assert.notEqual(response.status, 429, `GET ${route} terkena rate limit saat matriks`);
      const meta = response.body?.meta;
      if (meta && typeof meta === "object") {
        if (meta.page !== undefined) {
          assert.ok(Number(meta.page) >= 1, `GET ${route} mengembalikan page negatif`);
        }
        if (meta.limit !== undefined) {
          assert.ok(
            Number(meta.limit) >= 1 && Number(meta.limit) <= 100,
            `GET ${route} mengembalikan limit ${meta.limit}`,
          );
        }
      }
    }
  },
);
