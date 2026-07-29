const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { loadEnv } = require("../config/env");
const {
  createIntegrationFixture,
  loginAgent,
  readAdminCredentials,
} = require("./support/integration-test-helpers");

loadEnv();

test(
  "workflow HTTP v1 CRUD tersimpan ke PostgreSQL dan dibersihkan kembali",
  { skip: process.env.RUN_API_DB_INTEGRATION !== "true" },
  async (t) => {
    const app = require("../app");
    const prisma = require("../config/prisma");
    const fixture = createIntegrationFixture(prisma, "API division workflow");
    const agent = request.agent(app);
    const credentials = readAdminCredentials();
    const initialName = fixture.name("API Workflow");
    const updatedName = fixture.name("API Workflow Updated");
    let divisionId = null;
    let accessToken = null;

    t.after(async () => {
      if (accessToken) {
        await agent
          .post("/api/v1/auth/logout")
          .set("User-Agent", fixture.userAgent)
          .set("Authorization", `Bearer ${accessToken}`);
      }
      await fixture.cleanup();
      await prisma.$disconnect();
    });

    const login = await loginAgent(agent, credentials, fixture.userAgent);
    accessToken = login.accessToken;
    const authorization = login.authorization;
    const created = await agent
      .post("/api/v1/divisions")
      .set("User-Agent", fixture.userAgent)
      .set(authorization)
      .send({ name: initialName })
      .expect(201);
    divisionId = created.body.data?.id;
    assert.equal(typeof divisionId, "string");
    fixture.track("division", divisionId);

    const storedAfterCreate = await prisma.divisions.findUnique({
      where: { id: divisionId },
    });
    assert.equal(storedAfterCreate?.name, initialName);

    const fetched = await agent
      .get(`/api/v1/divisions/${divisionId}`)
      .set("User-Agent", fixture.userAgent)
      .set(authorization)
      .expect(200);
    assert.equal(fetched.body.data.id, divisionId);

    await agent
      .put(`/api/v1/divisions/${divisionId}`)
      .set("User-Agent", fixture.userAgent)
      .set(authorization)
      .send({ name: updatedName })
      .expect(200);
    const storedAfterUpdate = await prisma.divisions.findUnique({
      where: { id: divisionId },
    });
    assert.equal(storedAfterUpdate?.name, updatedName);

    await agent
      .delete(`/api/v1/divisions/${divisionId}`)
      .set("User-Agent", fixture.userAgent)
      .set(authorization)
      .expect(200);
    const storedAfterDelete = await prisma.divisions.findUnique({
      where: { id: divisionId },
    });
    assert.equal(storedAfterDelete, null);
    divisionId = null;
  },
);
