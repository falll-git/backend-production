const crypto = require("crypto");
const repository = require("./user.repository");
const roleRepository = require("../role/role.repository");
const divisionRepository = require("../division/division.repository");
const authRepository = require("../auth/auth.repository");
const { hashPassword } = require("../../utils/bcrypt");
const { buildInvitationEmailTemplate } = require("../../utils/mail-templates");
const {
  buildSetPasswordPath,
  buildSetPasswordUrl,
  generatePlainToken,
  getInviteExpiryDate,
  hashToken,
} = require("../../utils/auth-onboarding");
const { isMailerConfigured, sendMail } = require("../../utils/mailer");
const { AppError } = require("../../utils/errors");
const { serializeRole } = require("../../utils/role-types");

function normalizeText(value) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeUsername(value) {
  return value.trim().toLowerCase();
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function normalizePhone(value) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function buildOnboardingStatus(user) {
  if (user.onboarding_status) {
    return user.onboarding_status;
  }

  if (user.password_set_at) {
    return "ACTIVE";
  }

  if (
    Array.isArray(user.auth_action_tokens) &&
    user.auth_action_tokens.length > 0
  ) {
    return "PENDING_ACTIVATION";
  }

  return "NOT_ACTIVATED";
}

function serializeUser(user) {
  const { auth_action_tokens, ...safeUser } = user;

  return {
    ...safeUser,
    role: serializeRole(user.role),
    invitation_pending: !user.password_set_at,
    onboarding_status: buildOnboardingStatus(user),
  };
}

function buildInvitePayload(token, expiresAt) {
  return {
    type: "INVITE",
    token,
    path: buildSetPasswordPath(token),
    url: buildSetPasswordUrl(token),
    expires_at: expiresAt,
  };
}

function buildPublicInvitationPayload(invitation, delivery = {}) {
  const base = {
    type: invitation.type,
    expires_at: invitation.expires_at,
    path: invitation.path,
    url: invitation.url,
    delivery,
  };

  if (delivery.status === "sent") {
    return base;
  }

  return {
    ...base,
    token: invitation.token,
  };
}

async function assertRoleAndDivisionExist(roleId, divisionId) {
  const role = await roleRepository.findById(roleId);
  const division = await divisionRepository.findById(divisionId);

  if (!role) {
    throw new AppError("Role tidak ditemukan.", 404);
  }

  if (!division) {
    throw new AppError("Divisi tidak ditemukan.", 404);
  }
}

async function issueInviteForUser(userId) {
  const token = generatePlainToken();
  const tokenHash = hashToken(token);
  const expiresAt = getInviteExpiryDate();
  const now = new Date();

  await authRepository.invalidateInviteTokens(userId, now);
  await authRepository.createInviteToken({
    user_id: userId,
    type: "INVITE",
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  return buildInvitePayload(token, expiresAt);
}

async function deliverInvitation(user, invitation) {
  if (!invitation.url) {
    return buildPublicInvitationPayload(invitation, {
      channel: "manual",
      status: "manual_required",
      reason: "FRONTEND_URL_NOT_CONFIGURED",
    });
  }

  if (!isMailerConfigured()) {
    return buildPublicInvitationPayload(invitation, {
      channel: "manual",
      status: "manual_required",
      reason: "SMTP_NOT_CONFIGURED",
    });
  }

  try {
    const template = buildInvitationEmailTemplate({
      name: user.name,
      username: user.username,
      invitationUrl: invitation.url,
      expiresAt: invitation.expires_at,
    });

    const result = await sendMail({
      to: user.email,
      subject: template.subject,
      text: template.text,
      html: template.html,
    });

    return buildPublicInvitationPayload(invitation, {
      channel: "smtp",
      status: result.status,
      message_id: result.messageId || null,
      accepted: result.accepted || [],
      rejected: result.rejected || [],
    });
  } catch (error) {
    return buildPublicInvitationPayload(invitation, {
      channel: "manual",
      status: "failed",
      reason: "SMTP_SEND_FAILED",
      error: error.message,
    });
  }
}

exports.getUsers = async ({ page, limit, search }) => {
  const skip = (page - 1) * limit;

  const where = search
    ? {
        OR: [
          {
            name: {
              contains: search,
              mode: "insensitive",
            },
          },
          {
            username: {
              contains: search,
              mode: "insensitive",
            },
          },
          {
            email: {
              contains: search,
              mode: "insensitive",
            },
          },
        ],
      }
    : {};

  const data = await repository.findMany({ where, skip, take: limit });
  const total = await repository.count(where);

  return {
    data: data.map(serializeUser),
    meta: {
      total,
      page,
      lastPage: Math.ceil(total / limit),
    },
  };
};

exports.getUserById = async (id) => {
  const user = await repository.findById(id);

  if (!user) {
    throw new AppError("Pengguna tidak ditemukan.", 404);
  }

  return serializeUser(user);
};

exports.createUser = async (payload) => {
  const normalizedPayload = {
    name: normalizeText(payload.name),
    username: normalizeUsername(payload.username),
    email: normalizeEmail(payload.email),
    phone: normalizePhone(payload.phone),
    is_active: payload.is_active ?? true,
    is_restrict: payload.is_restrict ?? false,
    role_id: payload.role_id,
    division_id: payload.division_id,
  };
  const userDataPayload = normalizedPayload;

  await assertRoleAndDivisionExist(
    normalizedPayload.role_id,
    normalizedPayload.division_id,
  );

  const existingByEmail = await repository.findByEmail(normalizedPayload.email);
  if (existingByEmail) {
    throw new AppError("Email sudah digunakan.", 409);
  }

  const existingByUsername = await repository.findByUsername(
    normalizedPayload.username,
  );
  if (existingByUsername) {
    throw new AppError("Username sudah digunakan.", 409);
  }

  if (payload.send_invite === false) {
    throw new AppError("Pengguna baru harus menggunakan alur aktivasi undangan.", 422);
  }

  if (payload.password) {
    throw new AppError(
      "Password pengguna baru harus dibuat melalui tautan aktivasi.",
      422,
    );
  }

  const temporaryPassword = crypto.randomUUID();
  const hashedPassword = await hashPassword(temporaryPassword);
  let userData = await repository.create({
    ...userDataPayload,
    password: hashedPassword,
    onboarding_status: "PENDING_ACTIVATION",
    email_verified_at: null,
    password_set_at: null,
    invited_at: new Date(),
  });
  const invitation = await deliverInvitation(
    userData,
    await issueInviteForUser(userData.id),
  );
  userData = await repository.findById(userData.id);

  return {
    ...serializeUser(userData),
    invitation,
  };
};

exports.updateUser = async (id, payload) => {
  const user = await repository.findById(id);

  if (!user) {
    throw new AppError("Pengguna tidak ditemukan.", 404);
  }

  const nextData = {};

  if (typeof payload.name === "string") {
    nextData.name = normalizeText(payload.name);
  }

  if (typeof payload.username === "string") {
    nextData.username = normalizeUsername(payload.username);
    const existingByUsername = await repository.findByUsername(
      nextData.username,
    );
    if (existingByUsername && existingByUsername.id !== id) {
      throw new AppError("Username sudah digunakan.", 409);
    }
  }

  if (typeof payload.email === "string") {
    nextData.email = normalizeEmail(payload.email);
    const existingByEmail = await repository.findByEmail(nextData.email);
    if (existingByEmail && existingByEmail.id !== id) {
      throw new AppError("Email sudah digunakan.", 409);
    }
  }

  if (typeof payload.phone === "string" || payload.phone === null) {
    nextData.phone =
      payload.phone === null ? null : normalizePhone(payload.phone) || null;
  }

  if (typeof payload.is_active === "boolean") {
    nextData.is_active = payload.is_active;
  }

  if (typeof payload.is_restrict === "boolean") {
    nextData.is_restrict = payload.is_restrict;
  }

  if (payload.role_id) {
    const role = await roleRepository.findById(payload.role_id);
    if (!role) {
      throw new AppError("Role tidak ditemukan.", 404);
    }
    nextData.role_id = payload.role_id;
  }

  if (payload.division_id) {
    const division = await divisionRepository.findById(payload.division_id);
    if (!division) {
      throw new AppError("Divisi tidak ditemukan.", 404);
    }
    nextData.division_id = payload.division_id;
  }

  if (payload.password) {
    const now = new Date();
    nextData.password = await hashPassword(payload.password);
    nextData.password_set_at = now;
    nextData.email_verified_at = user.email_verified_at || now;
    nextData.onboarding_status = "ACTIVE";
    nextData.activated_at = user.activated_at || now;
    nextData.refresh_token = null;
    nextData.refresh_token_expires_at = null;
  }

  const updatedUser = await repository.update(id, nextData);
  return serializeUser(updatedUser);
};

exports.sendInvite = async (id) => {
  const user = await repository.findAuthRecordById(id);

  if (!user) {
    throw new AppError("Pengguna tidak ditemukan.", 404);
  }

  if (user.password_set_at) {
    throw new AppError("Pengguna sudah menyelesaikan aktivasi akun.", 400);
  }

  const invitation = await deliverInvitation(
    user,
    await issueInviteForUser(id),
  );
  await repository.update(id, {
    onboarding_status: "PENDING_ACTIVATION",
    invited_at: new Date(),
  });

  return {
    user: serializeUser(await repository.findById(id)),
    invitation,
  };
};

exports.deleteUser = async (id) => {
  const user = await repository.findById(id);

  if (!user) {
    throw new AppError("Pengguna tidak ditemukan.", 404);
  }

  const dependencySummary = await repository.findDependencySummary(id);
  const totalDependencies = Object.values(
    dependencySummary?._count || {},
  ).reduce((total, count) => total + Number(count || 0), 0);

  if (totalDependencies > 0) {
    throw new AppError(
      "Pengguna tidak dapat dihapus karena sudah digunakan oleh data operasional.",
      409,
    );
  }

  return repository.delete(id);
};

exports.getProfile = async (userId) => {
  const user = await repository.findById(userId);
  if (!user) {
    throw new AppError("Pengguna tidak ditemukan.", 404);
  }

  return serializeUser(user);
};
