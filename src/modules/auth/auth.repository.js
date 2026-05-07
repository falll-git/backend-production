const prisma = require("../../config/prisma");

const authUserSelect = {
  id: true,
  role_id: true,
  division_id: true,
  name: true,
  username: true,
  email: true,
  password: true,
  created_at: true,
  updated_at: true,
  refresh_token: true,
  refresh_token_expires_at: true,
  is_active: true,
  is_restrict: true,
  phone: true,
  onboarding_status: true,
  email_verified_at: true,
  password_set_at: true,
  invited_at: true,
  activated_at: true,
  role: {
    select: {
      id: true,
      name: true,
      type: true,
    },
  },
  division: {
    select: {
      id: true,
      name: true,
    },
  },
};

exports.findByUsername = (username) => {
  return prisma.users.findFirst({
    where: {
      username: {
        equals: username,
        mode: "insensitive",
      },
    },
    select: authUserSelect,
  });
};

exports.findByEmail = (email) => {
  return prisma.users.findFirst({
    where: {
      email: {
        equals: email,
        mode: "insensitive",
      },
    },
    select: authUserSelect,
  });
};

exports.findById = (id) => {
  return prisma.users.findUnique({
    where: { id },
    select: authUserSelect,
  });
};

function findActionToken(tokenHash, type) {
  return prisma.auth_action_tokens.findFirst({
    where: {
      token_hash: tokenHash,
      type,
      used_at: null,
      expires_at: {
        gt: new Date(),
      },
    },
    include: {
      user: {
        select: authUserSelect,
      },
    },
  });
}

exports.findInviteActionToken = (tokenHash) => {
  return findActionToken(tokenHash, "INVITE");
};

exports.findResetPasswordActionToken = (tokenHash) => {
  return findActionToken(tokenHash, "RESET_PASSWORD");
};

function invalidateActionTokens(userId, type, usedAt) {
  return prisma.auth_action_tokens.updateMany({
    where: {
      user_id: userId,
      type,
      used_at: null,
    },
    data: {
      used_at: usedAt,
    },
  });
}

exports.invalidateInviteTokens = (userId, usedAt) => {
  return invalidateActionTokens(userId, "INVITE", usedAt);
};

exports.invalidateResetPasswordTokens = (userId, usedAt) => {
  return invalidateActionTokens(userId, "RESET_PASSWORD", usedAt);
};

exports.createActionToken = (data) => {
  return prisma.auth_action_tokens.create({
    data,
  });
};

exports.createInviteToken = (data) => {
  return exports.createActionToken(data);
};

exports.markActionTokenUsed = (id, usedAt) => {
  return prisma.auth_action_tokens.update({
    where: { id },
    data: {
      used_at: usedAt,
    },
  });
};

exports.update = (id, data) => {
  return prisma.users.update({
    where: { id },
    data,
  });
};

exports.createRefreshToken = (data, client = prisma) => {
  return client.refresh_tokens.create({ data });
};

exports.findActiveRefreshTokenByHash = (tokenHash) => {
  return prisma.refresh_tokens.findFirst({
    where: {
      token_hash: tokenHash,
      revoked_at: null,
      expires_at: {
        gt: new Date(),
      },
    },
    include: {
      user: {
        select: authUserSelect,
      },
    },
  });
};

exports.revokeRefreshToken = (id, revokedAt, client = prisma) => {
  return client.refresh_tokens.update({
    where: { id },
    data: {
      revoked_at: revokedAt,
    },
  });
};

exports.revokeActiveRefreshTokensByUserId = (userId, revokedAt, client = prisma) => {
  return client.refresh_tokens.updateMany({
    where: {
      user_id: userId,
      revoked_at: null,
    },
    data: {
      revoked_at: revokedAt,
    },
  });
};

exports.rotateRefreshToken = ({
  oldRefreshTokenId,
  userId,
  refreshToken,
  refreshTokenHash,
  expiresAt,
  now,
}) => {
  return prisma.$transaction(async (tx) => {
    if (oldRefreshTokenId) {
      await exports.revokeRefreshToken(oldRefreshTokenId, now, tx);
    } else {
      await exports.revokeActiveRefreshTokensByUserId(userId, now, tx);
    }

    await exports.createRefreshToken(
      {
        user_id: userId,
        token_hash: refreshTokenHash,
        expires_at: expiresAt,
      },
      tx,
    );

    return tx.users.update({
      where: { id: userId },
      data: {
        refresh_token: refreshToken,
        refresh_token_expires_at: expiresAt,
      },
      select: authUserSelect,
    });
  });
};

exports.completeInviteOnboarding = async ({
  tokenId,
  userId,
  password,
  now,
}) => {
  return prisma.$transaction(async (tx) => {
    const user = await tx.users.update({
      where: { id: userId },
      data: {
        password,
        password_set_at: now,
        email_verified_at: now,
        onboarding_status: "ACTIVE",
        activated_at: now,
        refresh_token: null,
        refresh_token_expires_at: null,
      },
      select: authUserSelect,
    });

    await tx.refresh_tokens.updateMany({
      where: {
        user_id: userId,
        revoked_at: null,
      },
      data: {
        revoked_at: now,
      },
    });

    await tx.auth_action_tokens.update({
      where: { id: tokenId },
      data: {
        used_at: now,
      },
    });

    return user;
  });
};

exports.completePasswordReset = async ({
  tokenId,
  userId,
  password,
  now,
  emailVerifiedAt,
}) => {
  return prisma.$transaction(async (tx) => {
    const user = await tx.users.update({
      where: { id: userId },
      data: {
        password,
        password_set_at: now,
        onboarding_status: "ACTIVE",
        activated_at: now,
        refresh_token: null,
        refresh_token_expires_at: null,
        ...(emailVerifiedAt ? { email_verified_at: emailVerifiedAt } : {}),
      },
      select: authUserSelect,
    });

    await tx.refresh_tokens.updateMany({
      where: {
        user_id: userId,
        revoked_at: null,
      },
      data: {
        revoked_at: now,
      },
    });

    await tx.auth_action_tokens.updateMany({
      where: {
        user_id: userId,
        type: "RESET_PASSWORD",
        used_at: null,
      },
      data: {
        used_at: now,
      },
    });

    return user;
  });
};
