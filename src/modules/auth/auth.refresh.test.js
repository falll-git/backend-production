const test = require("node:test");
const assert = require("node:assert/strict");

const repository = require("./auth.repository");
const service = require("./auth.service");
const { generateRefreshToken, verifyAccessToken } = require("../../utils/jwt");
const { hashToken } = require("../../utils/auth-onboarding");

const ORIGINAL_ENV = {
  AUTH_REFRESH_REUSE_GRACE_MS: process.env.AUTH_REFRESH_REUSE_GRACE_MS,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN,
};

process.env.AUTH_REFRESH_REUSE_GRACE_MS = "5000";
process.env.JWT_SECRET = "access-secret-for-refresh-recovery-test-123";
process.env.JWT_REFRESH_SECRET = "refresh-secret-for-recovery-test-456";
process.env.JWT_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "1d";

const user = {
  id: "user-1",
  name: "Admin Test",
  username: "admin-test",
  email: "admin-test@example.invalid",
  role_id: "role-1",
  division_id: "division-1",
  phone: null,
  is_active: true,
  can_access_restricted_documents: false,
  email_verified_at: new Date("2026-01-01T00:00:00.000Z"),
  password_set_at: new Date("2026-01-01T00:00:00.000Z"),
  invited_at: null,
  activated_at: new Date("2026-01-01T00:00:00.000Z"),
  onboarding_status: "ACTIVE",
  created_at: new Date("2026-01-01T00:00:00.000Z"),
  updated_at: new Date("2026-01-01T00:00:00.000Z"),
  role: { id: "role-1", name: "Admin" },
  division: { id: "division-1", name: "Operasional" },
};

function refreshPayload(jti) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role_id: user.role_id,
    division_id: user.division_id,
    role: { role_name: user.role.name },
    division: { division_name: user.division.name },
    jti,
  };
}

function restoreRepository(originals) {
  for (const [name, implementation] of Object.entries(originals)) {
    repository[name] = implementation;
  }
}

test.after(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("refresh bersamaan memakai kembali token pengganti yang sama dalam grace window", async () => {
  const context = { ipAddress: "127.0.0.1", userAgent: "test-browser" };
  const oldIssuedAt = new Date(Date.now() - 1000);
  const replacementIssuedAt = new Date();
  const oldToken = generateRefreshToken(refreshPayload("session-old"), {
    issuedAt: oldIssuedAt,
  });
  const replacementToken = generateRefreshToken(
    refreshPayload("session-replacement"),
    { issuedAt: replacementIssuedAt },
  );
  const originals = {
    findActiveRefreshTokenByHash: repository.findActiveRefreshTokenByHash,
    findRecentlyReplacedRefreshTokenByHash:
      repository.findRecentlyReplacedRefreshTokenByHash,
    findActiveRefreshTokenByIdAndUserId:
      repository.findActiveRefreshTokenByIdAndUserId,
    findRefreshTokenByIdAndUserId:
      repository.findRefreshTokenByIdAndUserId,
  };

  repository.findActiveRefreshTokenByHash = async () => null;
  repository.findRecentlyReplacedRefreshTokenByHash = async () => ({
    id: "session-old",
    user_id: user.id,
    token_hash: hashToken(oldToken),
    expires_at: new Date(Date.now() + 86400000),
    revoked_at: replacementIssuedAt,
    replaced_by_token_id: "session-replacement",
    ip_address: context.ipAddress,
    user_agent: context.userAgent,
    user,
  });
  repository.findRefreshTokenByIdAndUserId = async () => ({
    id: "session-replacement",
    user_id: user.id,
    token_hash: hashToken(replacementToken),
    expires_at: new Date(Date.now() + 86400000),
    revoked_at: null,
    created_at: replacementIssuedAt,
    ip_address: context.ipAddress,
    user_agent: context.userAgent,
  });

  try {
    const result = await service.refreshToken(oldToken, context);

    assert.equal(result.refreshToken, replacementToken);
    assert.equal(result.user.id, user.id);
    assert.equal(verifyAccessToken(result.token).session_id, "session-replacement");
  } finally {
    restoreRepository(originals);
  }
});

test("recovery rotasi ditolak ketika identitas client berbeda", async () => {
  const oldIssuedAt = new Date(Date.now() - 1000);
  const oldToken = generateRefreshToken(refreshPayload("session-old"), {
    issuedAt: oldIssuedAt,
  });
  const originals = {
    findActiveRefreshTokenByHash: repository.findActiveRefreshTokenByHash,
    findRecentlyReplacedRefreshTokenByHash:
      repository.findRecentlyReplacedRefreshTokenByHash,
    findActiveRefreshTokenByIdAndUserId:
      repository.findActiveRefreshTokenByIdAndUserId,
    findRefreshTokenByIdAndUserId:
      repository.findRefreshTokenByIdAndUserId,
  };

  repository.findActiveRefreshTokenByHash = async () => null;
  repository.findRecentlyReplacedRefreshTokenByHash = async () => ({
    id: "session-old",
    user_id: user.id,
    token_hash: hashToken(oldToken),
    expires_at: new Date(Date.now() + 86400000),
    revoked_at: new Date(),
    replaced_by_token_id: "session-replacement",
    ip_address: "127.0.0.1",
    user_agent: "original-browser",
    user,
  });

  try {
    await assert.rejects(
      service.refreshToken(oldToken, {
        ipAddress: "127.0.0.1",
        userAgent: "different-browser",
      }),
      (error) => error?.statusCode === 401,
    );
  } finally {
    restoreRepository(originals);
  }
});

test("recovery mengikuti rantai rotasi singkat sampai token aktif terakhir", async () => {
  const context = { ipAddress: "127.0.0.1", userAgent: "test-browser" };
  const oldIssuedAt = new Date(Date.now() - 2000);
  const middleIssuedAt = new Date(Date.now() - 1000);
  const activeIssuedAt = new Date();
  const oldToken = generateRefreshToken(refreshPayload("session-old"), {
    issuedAt: oldIssuedAt,
  });
  const activeToken = generateRefreshToken(refreshPayload("session-active"), {
    issuedAt: activeIssuedAt,
  });
  const originals = {
    findActiveRefreshTokenByHash: repository.findActiveRefreshTokenByHash,
    findRecentlyReplacedRefreshTokenByHash:
      repository.findRecentlyReplacedRefreshTokenByHash,
    findRefreshTokenByIdAndUserId:
      repository.findRefreshTokenByIdAndUserId,
  };

  repository.findActiveRefreshTokenByHash = async () => null;
  repository.findRecentlyReplacedRefreshTokenByHash = async () => ({
    id: "session-old",
    user_id: user.id,
    token_hash: hashToken(oldToken),
    expires_at: new Date(Date.now() + 86400000),
    revoked_at: middleIssuedAt,
    replaced_by_token_id: "session-middle",
    ip_address: context.ipAddress,
    user_agent: context.userAgent,
    user,
  });
  repository.findRefreshTokenByIdAndUserId = async ({ id }) => {
    if (id === "session-middle") {
      return {
        id,
        user_id: user.id,
        token_hash: "not-returned-to-client",
        expires_at: new Date(Date.now() + 86400000),
        revoked_at: activeIssuedAt,
        replaced_by_token_id: "session-active",
        ip_address: context.ipAddress,
        user_agent: context.userAgent,
        created_at: middleIssuedAt,
      };
    }
    if (id === "session-active") {
      return {
        id,
        user_id: user.id,
        token_hash: hashToken(activeToken),
        expires_at: new Date(Date.now() + 86400000),
        revoked_at: null,
        replaced_by_token_id: null,
        ip_address: context.ipAddress,
        user_agent: context.userAgent,
        created_at: activeIssuedAt,
      };
    }
    return null;
  };

  try {
    const result = await service.refreshToken(oldToken, context);

    assert.equal(result.refreshToken, activeToken);
    assert.equal(verifyAccessToken(result.token).session_id, "session-active");
  } finally {
    restoreRepository(originals);
  }
});
