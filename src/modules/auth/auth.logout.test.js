const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const jwt = require("jsonwebtoken");

const repository = require("./auth.repository");
const service = require("./auth.service");
const { generateAccessToken, generateRefreshToken } = require("../../utils/jwt");
const { hashToken } = require("../../utils/auth-onboarding");

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
  const refreshToken = generateRefreshToken({ id: "user-cookie", jti: "session-cookie" });
  repository.findActiveRefreshTokenIdentityByHash = async (hash, userId) => {
    assert.equal(hash, hashToken(refreshToken));
    assert.equal(userId, "user-cookie");
    return { user_id: "user-cookie" };
  };
  repository.revokeActiveRefreshTokenByHash = async (hash, at, userId) => {
    assert.equal(hash, hashToken(refreshToken));
    assert.ok(at instanceof Date);
    assert.equal(userId, "user-cookie");
    return { count: 1 };
  };

  try {
    const result = await service.logout({ refreshToken });
    assert.deepEqual(result, { actor_id: "user-cookie" });
    assert.equal(Object.hasOwn(result, "refreshToken"), false);
  } finally {
    repository.findActiveRefreshTokenIdentityByHash = originalFind;
    repository.revokeActiveRefreshTokenByHash = originalRevoke;
  }
});

test("logout cookie tidak valid tidak mencari atau mencabut identitas dari token tak tepercaya", async () => {
  const originalFind = repository.findActiveRefreshTokenIdentityByHash;
  const originalRevoke = repository.revokeActiveRefreshTokenByHash;
  repository.findActiveRefreshTokenIdentityByHash = async () => assert.fail("unverified lookup");
  repository.revokeActiveRefreshTokenByHash = async () => assert.fail("unverified revoke");
  try {
    assert.deepEqual(await service.logout({ refreshToken: "forged-cookie" }), { actor_id: null });
  } finally {
    repository.findActiveRefreshTokenIdentityByHash = originalFind;
    repository.revokeActiveRefreshTokenByHash = originalRevoke;
  }
});

test("logout tidak menyembunyikan kegagalan penyimpanan pencabutan", async () => {
  const originalRevoke = repository.revokeActiveRefreshTokenByIdAndUserId;
  repository.revokeActiveRefreshTokenByIdAndUserId = async () => { throw Error("OWNED_DB_FAILURE"); };
  try {
    const accessToken = generateAccessToken({ id: "user-test", session_id: "session-test" });
    await assert.rejects(service.logout({ accessToken }), /OWNED_DB_FAILURE/);
  } finally {
    repository.revokeActiveRefreshTokenByIdAndUserId = originalRevoke;
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
      crypto.randomBytes(32).toString("hex"),
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
