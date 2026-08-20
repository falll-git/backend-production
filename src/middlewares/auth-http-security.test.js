const test = require("node:test");
const assert = require("node:assert/strict");

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  CORS_ORIGIN: process.env.CORS_ORIGIN,
  AUTH_REFRESH_COOKIE_NAME: process.env.AUTH_REFRESH_COOKIE_NAME,
  AUTH_COOKIE_SAME_SITE: process.env.AUTH_COOKIE_SAME_SITE,
  RATE_LIMIT_STORE: process.env.RATE_LIMIT_STORE,
  FILE_ACCESS_RATE_LIMIT_WINDOW_MS:
    process.env.FILE_ACCESS_RATE_LIMIT_WINDOW_MS,
  FILE_ACCESS_RATE_LIMIT_MAX: process.env.FILE_ACCESS_RATE_LIMIT_MAX,
};

process.env.NODE_ENV = "production";
process.env.CORS_ORIGIN = "https://allowed.example";
process.env.AUTH_REFRESH_COOKIE_NAME = "test_refresh_token";
process.env.AUTH_COOKIE_SAME_SITE = "lax";
// Test HTTP ini tidak menjalankan bootstrap production atau Redis. Runtime
// production tetap menolak mode memory melalui validateEnv().
process.env.RATE_LIMIT_STORE = "memory";
process.env.FILE_ACCESS_RATE_LIMIT_WINDOW_MS = "60000";
process.env.FILE_ACCESS_RATE_LIMIT_MAX = "1";

const app = require("../app");
const { setRefreshTokenCookie } = require("../utils/auth-cookie");

async function withServer(run) {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test.after(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("CORS menerima origin terdaftar dan menolak origin asing", async () => {
  await withServer(async (baseUrl) => {
    const allowed = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://allowed.example" },
    });
    assert.equal(allowed.status, 200);
    assert.equal(
      allowed.headers.get("access-control-allow-origin"),
      "https://allowed.example",
    );
    assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
    const exposedHeaders =
      allowed.headers.get("access-control-expose-headers") || "";
    assert.match(exposedHeaders, /Retry-After/i);
    assert.match(exposedHeaders, /RateLimit-Remaining/i);

    const denied = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://blocked.example" },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
  });
});

test("respons production tidak membocorkan framework dan memakai HSTS", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-powered-by"), null);
    assert.match(
      response.headers.get("strict-transport-security") || "",
      /max-age=/,
    );
    assert.equal(
      response.headers.get("permissions-policy"),
      "camera=(), microphone=(), geolocation=(self)",
    );
  });
});

test("refresh token production memakai cookie HttpOnly dan Secure", () => {
  const calls = [];
  const response = {
    cookie(name, value, options) {
      calls.push({ name, value, options });
    },
  };

  setRefreshTokenCookie(response, "refresh-token-value");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "test_refresh_token");
  assert.equal(calls[0].options.httpOnly, true);
  assert.equal(calls[0].options.secure, true);
  assert.equal(calls[0].options.sameSite, "lax");
  assert.equal(calls[0].options.path, "/api");
});

test("malformed JSON memakai pesan aman tanpa detail parser", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{invalid",
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.status, false);
    assert.equal(payload.message, "Payload JSON tidak valid.");
    assert.doesNotMatch(payload.message, /position|column|property/i);
  });
});

test("file privat tanpa token ditolak dan percobaan berlebih dibatasi", async () => {
  await withServer(async (baseUrl) => {
    const firstResponse = await fetch(
      `${baseUrl}/api/digital-archive-files/nonexistent.pdf`,
    );

    assert.equal(firstResponse.status, 401);
    assert.equal(firstResponse.headers.get("ratelimit-limit"), "1");
    assert.equal((await firstResponse.json()).status, false);

    const blockedResponse = await fetch(
      `${baseUrl}/api/digital-archive-files/nonexistent.pdf`,
    );
    const blockedPayload = await blockedResponse.json();
    assert.equal(blockedResponse.status, 429);
    assert.equal(blockedResponse.headers.get("ratelimit-remaining"), "0");
    assert.match(blockedResponse.headers.get("retry-after") || "", /^\d+$/);
    assert.equal(blockedPayload.status, false);
    assert.equal(typeof blockedPayload.request_id, "string");
  });
});
