const repository = require("./auth.repository");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const {
  generateAccessToken,
  generateRefreshToken,
} = require("../../utils/jwt");
const { hashPassword, comparePassword } = require("../../utils/bcrypt");
const {
  buildResetPasswordPath,
  buildResetPasswordUrl,
  buildSetPasswordPath,
  buildSetPasswordUrl,
  generatePlainToken,
  getResetPasswordExpiryDate,
  hashToken,
} = require("../../utils/auth-onboarding");
const {
  buildPasswordResetEmailTemplate,
} = require("../../utils/mail-templates");
const { sendMail } = require("../../utils/mailer");
const { AppError } = require("../../utils/errors");
const { getRoleTypeLabel } = require("../../utils/role-types");

function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

function buildAuthUserPayload(user) {
  const onboardingStatus =
    user.onboarding_status ||
    (user.password_set_at
      ? "ACTIVE"
      : Array.isArray(user.auth_action_tokens) &&
          user.auth_action_tokens.length > 0
        ? "PENDING_ACTIVATION"
        : "NOT_ACTIVATED");

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role_id: user.role_id,
    division_id: user.division_id,
    phone: user.phone,
    is_active: user.is_active,
    is_restrict: user.is_restrict,
    email_verified_at: user.email_verified_at,
    password_set_at: user.password_set_at,
    invited_at: user.invited_at,
    activated_at: user.activated_at,
    invitation_pending: !user.password_set_at,
    onboarding_status: onboardingStatus,
    created_at: user.created_at,
    updated_at: user.updated_at,
    role: {
      id: user.role?.id,
      name: user.role?.name,
      type: user.role?.type,
      type_label: user.role?.type ? getRoleTypeLabel(user.role.type) : null,
      role_name: user.role?.name,
    },
    division: {
      id: user.division?.id,
      name: user.division?.name,
      division_name: user.division?.name,
    },
  };
}

function buildJwtPayload(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role_id: user.role_id,
    division_id: user.division_id,
    role: {
      role_name: user.role?.name,
      role_type: user.role?.type,
    },
    division: {
      division_name: user.division?.name,
    },
  };
}

function ensureUserCanAuthenticate(user) {
  if (!user) {
    throw new AppError("Username atau password tidak sesuai.", 401);
  }

  if (!user.is_active) {
    throw new AppError("Akun pengguna tidak aktif.", 403);
  }

  if (!user.password_set_at) {
    throw new AppError(
      "Aktivasi akun belum selesai. Silakan atur password melalui tautan undangan.",
      403,
    );
  }
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function canRequestPasswordReset(user) {
  return Boolean(user && user.is_active && user.password_set_at);
}

async function issueResetPasswordToken(userId) {
  const token = generatePlainToken();
  const tokenHash = hashToken(token);
  const expiresAt = getResetPasswordExpiryDate();
  const now = new Date();

  await repository.invalidateResetPasswordTokens(userId, now);
  await repository.createActionToken({
    user_id: userId,
    type: "RESET_PASSWORD",
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  return {
    token,
    type: "RESET_PASSWORD",
    path: buildResetPasswordPath(token),
    url: buildResetPasswordUrl(token),
    expires_at: expiresAt,
  };
}

function getRefreshTokenExpiryDate(refreshToken) {
  const decoded = jwt.decode(refreshToken);
  if (decoded && typeof decoded.exp === "number") {
    return new Date(decoded.exp * 1000);
  }

  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

async function issueRefreshToken(user, oldRefreshTokenId = null) {
  const refreshToken = generateRefreshToken({
    ...buildJwtPayload(user),
    jti: crypto.randomUUID(),
  });
  const expiresAt = getRefreshTokenExpiryDate(refreshToken);
  const now = new Date();

  const updatedUser = await repository.rotateRefreshToken({
    oldRefreshTokenId,
    userId: user.id,
    refreshToken,
    refreshTokenHash: hashToken(refreshToken),
    expiresAt,
    now,
  });

  return {
    refreshToken,
    expiresAt,
    user: updatedUser,
  };
}

async function sendResetPasswordEmail(user, resetPassword) {
  if (!resetPassword.url) {
    return;
  }

  const template = buildPasswordResetEmailTemplate({
    name: user.name,
    username: user.username,
    resetPasswordUrl: resetPassword.url,
    expiresAt: resetPassword.expires_at,
  });

  await sendMail({
    to: user.email,
    subject: template.subject,
    text: template.text,
    html: template.html,
  });
}

exports.login = async (payload) => {
  const user = await repository.findByUsername(
    normalizeUsername(payload.username),
  );
  ensureUserCanAuthenticate(user);

  const match = await comparePassword(payload.password, user.password);
  if (!match) throw new AppError("Username atau password tidak sesuai.", 401);

  const token = generateAccessToken(buildJwtPayload(user));
  const refresh = await issueRefreshToken(user);

  return {
    data: buildAuthUserPayload(refresh.user),
    token,
    refreshToken: refresh.refreshToken,
  };
};

exports.refreshToken = async (token) => {
  if (!token) {
    throw new AppError("Sesi login wajib disertakan.", 422);
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch (error) {
    throw new AppError("Sesi login tidak valid.", 401);
  }

  const tokenRecord = await repository.findActiveRefreshTokenByHash(
    hashToken(token),
  );
  let user = tokenRecord?.user || null;
  let oldRefreshTokenId = tokenRecord?.id || null;

  if (!user) {
    const legacyUser = await repository.findById(decoded.id);
    if (!legacyUser || legacyUser.refresh_token !== token) {
      throw new AppError("Sesi login tidak valid.", 401);
    }

    user = legacyUser;
    oldRefreshTokenId = null;
  }

  if (user.id !== decoded.id) {
    throw new AppError("Sesi login tidak valid.", 401);
  }

  ensureUserCanAuthenticate(user);

  const newAccessToken = generateAccessToken(buildJwtPayload(user));
  const refresh = await issueRefreshToken(user, oldRefreshTokenId);

  return {
    token: newAccessToken,
    refreshToken: refresh.refreshToken,
    user: buildAuthUserPayload(refresh.user),
  };
};

exports.changePassword = async (userId, payload) => {
  const { oldPassword, newPassword } = payload;

  const user = await repository.findById(userId);
  if (!user) {
    throw new AppError("Pengguna tidak ditemukan.", 404);
  }

  const match = await comparePassword(oldPassword, user.password);

  if (!match) {
    throw new AppError("Password saat ini tidak sesuai.", 400);
  }

  const hashed = await hashPassword(newPassword);
  const now = new Date();

  await repository.update(userId, {
    password: hashed,
    password_set_at: now,
    email_verified_at: user.email_verified_at || now,
    onboarding_status: "ACTIVE",
    activated_at: user.activated_at || now,
    refresh_token: null,
    refresh_token_expires_at: null,
  });
  await repository.revokeActiveRefreshTokensByUserId(userId, now);

  return true;
};

exports.forgotPassword = async ({ email }) => {
  const user = await repository.findByEmail(normalizeEmail(email));

  if (!canRequestPasswordReset(user)) {
    return true;
  }

  const resetPassword = await issueResetPasswordToken(user.id);

  try {
    await sendResetPasswordEmail(user, resetPassword);
  } catch {
  }

  return true;
};

exports.verifySetPasswordToken = async (token) => {
  const tokenHash = hashToken(token);
  const actionToken = await repository.findInviteActionToken(tokenHash);

  if (!actionToken) {
    throw new AppError("Tautan aktivasi tidak valid atau sudah kedaluwarsa.", 400);
  }

  if (!actionToken.user.is_active) {
    throw new AppError("Akses pengguna sedang ditutup.", 403);
  }

  if (actionToken.user.password_set_at) {
    throw new AppError("Aktivasi akun sudah selesai.", 400);
  }

  return {
    user: {
      id: actionToken.user.id,
      name: actionToken.user.name,
      email: actionToken.user.email,
      username: actionToken.user.username,
    },
    expires_at: actionToken.expires_at,
    path: buildSetPasswordPath(token),
    url: buildSetPasswordUrl(token),
  };
};

exports.verifyResetPasswordToken = async (token) => {
  const tokenHash = hashToken(token);
  const actionToken = await repository.findResetPasswordActionToken(tokenHash);

  if (!actionToken || !canRequestPasswordReset(actionToken.user)) {
    throw new AppError("Tautan reset password tidak valid atau sudah kedaluwarsa.", 400);
  }

  return {
    user: {
      id: actionToken.user.id,
      name: actionToken.user.name,
      email: actionToken.user.email,
      username: actionToken.user.username,
    },
    expires_at: actionToken.expires_at,
    path: buildResetPasswordPath(token),
    url: buildResetPasswordUrl(token),
  };
};

exports.setPassword = async ({ token, password }) => {
  const tokenHash = hashToken(token);
  const actionToken = await repository.findInviteActionToken(tokenHash);

  if (!actionToken) {
    throw new AppError("Tautan aktivasi tidak valid atau sudah kedaluwarsa.", 400);
  }

  if (!actionToken.user.is_active) {
    throw new AppError("Akses pengguna sedang ditutup.", 403);
  }

  if (actionToken.user.password_set_at) {
    throw new AppError("Aktivasi akun sudah selesai.", 400);
  }

  const now = new Date();
  const hashedPassword = await hashPassword(password);

  const user = await repository.completeInviteOnboarding({
    tokenId: actionToken.id,
    userId: actionToken.user.id,
    password: hashedPassword,
    now,
  });

  return {
    user: buildAuthUserPayload(user),
  };
};

exports.resetPassword = async ({ token, password }) => {
  const tokenHash = hashToken(token);
  const actionToken = await repository.findResetPasswordActionToken(tokenHash);

  if (!actionToken || !canRequestPasswordReset(actionToken.user)) {
    throw new AppError("Tautan reset password tidak valid atau sudah kedaluwarsa.", 400);
  }

  const now = new Date();
  const hashedPassword = await hashPassword(password);
  const user = await repository.completePasswordReset({
    tokenId: actionToken.id,
    userId: actionToken.user.id,
    password: hashedPassword,
    now,
    emailVerifiedAt: actionToken.user.email_verified_at || now,
  });

  return {
    user: buildAuthUserPayload(user),
  };
};

exports.logout = async (userId) => {
  const now = new Date();
  await repository.update(userId, {
    refresh_token: null,
    refresh_token_expires_at: null,
  });
  await repository.revokeActiveRefreshTokensByUserId(userId, now);

  return true;
};
