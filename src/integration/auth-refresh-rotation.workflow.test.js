const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { loadEnv } = require("../config/env");
const { hashToken } = require("../utils/auth-onboarding");
const {
  createIntegrationFixture,
  loginAgent,
  readAdminCredentials,
} = require("./support/integration-test-helpers");

loadEnv();

function readResponseCookie(response, cookieName) {
  const rawHeaders = response.headers["set-cookie"];
  const headers = Array.isArray(rawHeaders)
    ? rawHeaders
    : rawHeaders
      ? [rawHeaders]
      : [];
  const prefix = `${cookieName}=`;
  const cookie = headers
    .map((header) => String(header).split(";", 1)[0])
    .find(
      (header) =>
        header.startsWith(prefix) && header.slice(prefix.length).length > 0,
    );

  if (!cookie) {
    throw new Error("Respons autentikasi tidak mengembalikan cookie sesi.");
  }

  return {
    header: cookie,
    token: decodeURIComponent(cookie.slice(prefix.length)),
  };
}

test(
  "refresh bersamaan memulihkan satu rotasi yang sama tanpa menjatuhkan sesi",
  { skip: process.env.RUN_API_DB_INTEGRATION !== "true" },
  async (t) => {
    const app = require("../app");
    const prisma = require("../config/prisma-system");
    const fixture = createIntegrationFixture(
      prisma,
      "Concurrent refresh rotation workflow",
    );
    const credentials = readAdminCredentials();
    const agent = request.agent(app);
    const cookieName = String(process.env.AUTH_REFRESH_COOKIE_NAME || "").trim();

    assert.notEqual(cookieName, "");

    t.after(async () => {
      await fixture.cleanup();
      await prisma.$disconnect();
    });

    const login = await loginAgent(agent, credentials, fixture.userAgent);
    const originalCookie = readResponseCookie(login.response, cookieName);
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app)
          .post("/api/v1/auth/refresh")
          .set("Cookie", originalCookie.header)
          .set("User-Agent", fixture.userAgent)
          .send({ remember: false }),
      ),
    );

    assert.deepEqual(
      responses.map((response) => response.statusCode),
      [200, 200, 200, 200, 200, 200],
    );

    const replacementCookies = responses.map((response) =>
      readResponseCookie(response, cookieName),
    );
    const replacementTokens = new Set(
      replacementCookies.map((cookie) => cookie.token),
    );

    assert.equal(replacementTokens.size, 1);
    const [replacementToken] = replacementTokens;
    assert.notEqual(replacementToken, originalCookie.token);

    const originalRecord = await prisma.refresh_tokens.findUnique({
      where: { token_hash: hashToken(originalCookie.token) },
    });
    const replacementRecord = await prisma.refresh_tokens.findUnique({
      where: { token_hash: hashToken(replacementToken) },
    });

    assert.ok(originalRecord?.revoked_at instanceof Date);
    assert.equal(originalRecord?.replaced_by_token_id, replacementRecord?.id);
    assert.equal(replacementRecord?.revoked_at, null);
    assert.equal(replacementRecord?.user_agent, fixture.userAgent);
  },
);

test(
  "refresh lama mengikuti beberapa rotasi singkat tanpa menghapus sesi terbaru",
  { skip: process.env.RUN_API_DB_INTEGRATION !== "true" },
  async (t) => {
    const app = require("../app");
    const prisma = require("../config/prisma-system");
    const fixture = createIntegrationFixture(
      prisma,
      "Chained refresh rotation workflow",
    );
    const credentials = readAdminCredentials();
    const agent = request.agent(app);
    const cookieName = String(process.env.AUTH_REFRESH_COOKIE_NAME || "").trim();

    assert.notEqual(cookieName, "");

    t.after(async () => {
      await fixture.cleanup();
      await prisma.$disconnect();
    });

    const login = await loginAgent(agent, credentials, fixture.userAgent);
    const originalCookie = readResponseCookie(login.response, cookieName);
    const firstRotation = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", originalCookie.header)
      .set("User-Agent", fixture.userAgent)
      .send({ remember: false });
    assert.equal(firstRotation.statusCode, 200);
    const firstCookie = readResponseCookie(firstRotation, cookieName);

    const secondRotation = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", firstCookie.header)
      .set("User-Agent", fixture.userAgent)
      .send({ remember: false });
    assert.equal(secondRotation.statusCode, 200);
    const latestCookie = readResponseCookie(secondRotation, cookieName);

    const recovered = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", originalCookie.header)
      .set("User-Agent", fixture.userAgent)
      .send({ remember: false });

    assert.equal(recovered.statusCode, 200);
    assert.equal(
      readResponseCookie(recovered, cookieName).token,
      latestCookie.token,
    );
  },
);
