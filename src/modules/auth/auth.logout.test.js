const assert = require("node:assert/strict");
const test = require("node:test");
const jwt = require("jsonwebtoken");

const repository = require("./auth.repository");
const service = require("./auth.service");
const { generateAccessToken } = require("../../utils/jwt");

test("logout Bearer-only mencabut sesi dari klaim access token", async () => {
  const originalRevoke = repository.revokeActiveRefreshTokenByIdAndUserId;
  const calls = [];

  repository.revokeActiveRefreshTokenByIdAndUserId = async (...args) => {
    calls.push(args);
    return { count: 1 };
  };

  try {
    const accessToken = generateAccessToken({
      id: "user-test",
      session_id: "session-test",
    });

    const result = await service.logout({ accessToken });

    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "session-test");
    assert.equal(calls[0][1], "user-test");
    assert.ok(calls[0][2] instanceof Date);
    assert.equal(result.actor_id, "user-test");
  } finally {
    repository.revokeActiveRefreshTokenByIdAndUserId = originalRevoke;
  }
});

test("logout cookie-only mengembalikan pelaku untuk audit tanpa mengekspos token", async () => {
  const originalFind = repository.findActiveRefreshTokenIdentityByHash;
  const originalRevoke = repository.revokeActiveRefreshTokenByHash;
  repository.findActiveRefreshTokenIdentityByHash = async () => ({
    user_id: "user-cookie",
  });
  repository.revokeActiveRefreshTokenByHash = async () => ({ count: 1 });

  try {
    const result = await service.logout({ refreshToken: "refresh-cookie" });
    assert.deepEqual(result, { actor_id: "user-cookie" });
    assert.equal(Object.hasOwn(result, "refreshToken"), false);
  } finally {
    repository.findActiveRefreshTokenIdentityByHash = originalFind;
    repository.revokeActiveRefreshTokenByHash = originalRevoke;
  }
});

test("logout tetap idempoten untuk access token tidak valid", async () => {
  const originalRevoke = repository.revokeActiveRefreshTokenByIdAndUserId;
  let callCount = 0;

  repository.revokeActiveRefreshTokenByIdAndUserId = async () => {
    callCount += 1;
    return { count: 1 };
  };

  try {
    await assert.doesNotReject(() =>
      service.logout({ accessToken: "access-token-tidak-valid" }),
    );
    assert.equal(callCount, 0);
  } finally {
    repository.revokeActiveRefreshTokenByIdAndUserId = originalRevoke;
  }
});

test("logout menolak token bertanda tangan asing tanpa mencabut sesi", async () => {
  const originalRevoke = repository.revokeActiveRefreshTokenByIdAndUserId;
  let callCount = 0;

  repository.revokeActiveRefreshTokenByIdAndUserId = async () => {
    callCount += 1;
    return { count: 1 };
  };

  try {
    const forgedToken = jwt.sign(
      { id: "user-test", session_id: "session-test" },
      "secret-asing-yang-tidak-dipercaya",
      {
        algorithm: "HS256",
        issuer: "ruwang-arsip-api",
        audience: "ruwang-arsip-access",
        expiresIn: "5m",
      },
    );

    await assert.doesNotReject(() =>
      service.logout({ accessToken: forgedToken }),
    );
    assert.equal(callCount, 0);
  } finally {
    repository.revokeActiveRefreshTokenByIdAndUserId = originalRevoke;
  }
});
