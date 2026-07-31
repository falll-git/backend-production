const assert = require("node:assert/strict");
const test = require("node:test");

const { readRefreshTokenCookie } = require("./auth-cookie");

test("refresh cookie dibaca tanpa property injection", (t) => {
  const previousName = process.env.AUTH_REFRESH_COOKIE_NAME;
  process.env.AUTH_REFRESH_COOKIE_NAME = "refresh_token";
  t.after(() => {
    if (previousName === undefined) {
      delete process.env.AUTH_REFRESH_COOKIE_NAME;
    } else {
      process.env.AUTH_REFRESH_COOKIE_NAME = previousName;
    }
  });

  const token = readRefreshTokenCookie({
    headers: {
      cookie:
        "__proto__=polluted; constructor=unsafe; refresh_token=token%2Eaman",
    },
  });

  assert.equal(token, "token.aman");
  assert.equal(Object.prototype.polluted, undefined);
});

test("cookie malformed tidak menyebabkan parser gagal", (t) => {
  const previousName = process.env.AUTH_REFRESH_COOKIE_NAME;
  process.env.AUTH_REFRESH_COOKIE_NAME = "refresh_token";
  t.after(() => {
    if (previousName === undefined) {
      delete process.env.AUTH_REFRESH_COOKIE_NAME;
    } else {
      process.env.AUTH_REFRESH_COOKIE_NAME = previousName;
    }
  });

  assert.equal(
    readRefreshTokenCookie({
      headers: { cookie: "refresh_token=%E0%A4%A" },
    }),
    "%E0%A4%A",
  );
  assert.equal(readRefreshTokenCookie({ headers: {} }), null);
});
