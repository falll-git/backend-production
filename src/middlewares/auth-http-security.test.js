const test = require("node:test");
const assert = require("node:assert/strict");

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  CORS_ORIGIN: process.env.CORS_ORIGIN,
  AUTH_REFRESH_COOKIE_NAME: process.env.AUTH_REFRESH_COOKIE_NAME,
  AUTH_COOKIE_SAME_SITE: process.env.AUTH_COOKIE_SAME_SITE,
};

process.env.NODE_ENV = "production";
process.env.CORS_ORIGIN = "https://allowed.example";
process.env.AUTH_REFRESH_COOKIE_NAME = "test_refresh_token";
process.env.AUTH_COOKIE_SAME_SITE = "lax";

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

    const denied = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://blocked.example" },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
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
  assert.equal(calls[0].options.path, "/api/auth");
});

test("file privat tanpa token ditolak sebelum file disajikan", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/digital-archive-files/nonexistent.pdf`,
    );

    assert.equal(response.status, 401);
    assert.equal((await response.json()).status, false);
  });
});
