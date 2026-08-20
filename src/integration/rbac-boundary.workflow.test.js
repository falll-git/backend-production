const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");

const { loadEnv } = require("../config/env");

loadEnv();

const {
  createActiveUser,
  createIntegrationFixture,
  loginAgent,
} = require("./support/integration-test-helpers");

test(
  "role tanpa menu ditolak pada API user, debitur, arsip, legal, dan activity centre",
  { skip: process.env.RUN_CRITICAL_DB_INTEGRATION !== "true" },
  async (t) => {
    const app = require("../app");
    const prisma = require("../config/prisma-system");
    const fixture = createIntegrationFixture(prisma, "RBAC boundary workflow");
    const agent = request.agent(app);
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

    const division = await prisma.divisions.findFirst({
      orderBy: { created_at: "asc" },
    });
    assert.ok(division, "Minimal satu divisi baseline wajib tersedia.");

    const role = await prisma.roles.create({
      data: { name: fixture.name("Integration No Access") },
    });
    fixture.track("role", role.id);
    const restrictedUser = await createActiveUser(prisma, fixture, {
      roleId: role.id,
      divisionId: division.id,
      name: fixture.name("User Tanpa Akses"),
    });
    const login = await loginAgent(
      agent,
      { username: restrictedUser.username, password: restrictedUser.password },
      fixture.userAgent,
    );
    accessToken = login.accessToken;

    const protectedTargets = [
      "/api/v1/users",
      "/api/v1/debtors",
      "/api/v1/digital-documents",
      "/api/v1/legal/deposits",
      "/api/v1/activity-centre",
    ];
    for (const target of protectedTargets) {
      const response = await agent
        .get(target)
        .set("User-Agent", fixture.userAgent)
        .set(login.authorization)
        .expect(403);
      assert.equal(response.body.success, false);
    }

    const roleMenuCount = await prisma.role_menus.count({
      where: { role_id: role.id },
    });
    assert.equal(roleMenuCount, 0);
  },
);
