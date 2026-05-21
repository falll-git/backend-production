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
const { resolveRequestUser, roleHasPermission } = require("../../utils/rbac");
const { buildPaginationMeta } = require("../../utils/pagination");

const USER_MENU_URL = "/dashboard/users";

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

function normalizeReason(value) {
  return value.trim().replace(/\s+/g, " ");
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
  const canAccessRestrictedDocuments = Boolean(
    user.can_access_restricted_documents,
  );

  return {
    ...safeUser,
    can_access_restricted_documents: canAccessRestrictedDocuments,
    is_restrict: canAccessRestrictedDocuments,
    role: serializeRole(user.role),
    invitation_pending: !user.password_set_at,
    onboarding_status: buildOnboardingStatus(user),
  };
}

function serializeAssignableUserLite(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role_id: user.role_id,
    division_id: user.division_id,
    role: serializeRole(user.role),
    division: user.division || null,
  };
}

function buildUserSearchWhere(search) {
  return search
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
}

function countDependencySummary(dependencySummary) {
  return Object.values(dependencySummary?._count || {}).reduce(
    (total, count) => total + Number(count || 0),
    0,
  );
}

function buildDeleteImpact(user, actorId, dependencySummary) {
  const dependencyCount = countDependencySummary(dependencySummary);
  const isSelf = user.id === actorId;
  const hasActivity = dependencyCount > 0;
  const canDelete = !isSelf && !hasActivity;
  const requiresAccessClosure = hasActivity && user.is_active;

  if (isSelf) {
    return {
      can_delete: false,
      has_activity: hasActivity,
      dependency_count: dependencyCount,
      requires_access_closure: false,
      can_close_access: false,
      reason: "SELF_ACCOUNT",
      message: "Anda tidak dapat menghapus akun sendiri.",
    };
  }

  if (requiresAccessClosure) {
    return {
      can_delete: false,
      has_activity: true,
      dependency_count: dependencyCount,
      requires_access_closure: true,
      can_close_access: true,
      reason: "HAS_ACTIVITY_ACTIVE",
      message:
        "Pengguna ini sudah memiliki riwayat aktivitas. Tutup akses pengguna agar tidak bisa login dan tidak muncul pada proses baru.",
    };
  }

  if (hasActivity) {
    return {
      can_delete: false,
      has_activity: true,
      dependency_count: dependencyCount,
      requires_access_closure: false,
      can_close_access: false,
      reason: "HAS_ACTIVITY_INACTIVE",
      message:
        "Pengguna ini sudah memiliki riwayat aktivitas dan aksesnya sudah ditutup. Data tetap disimpan untuk audit dan laporan.",
    };
  }

  return {
    can_delete: canDelete,
    has_activity: false,
    dependency_count: dependencyCount,
    requires_access_closure: false,
    can_close_access: false,
    reason: canDelete ? null : "UNKNOWN",
    message: canDelete
      ? "Pengguna ini belum memiliki riwayat aktivitas dan bisa dihapus permanen."
      : "Pengguna tidak dapat dihapus.",
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
  const safePayload = {
    type: invitation.type,
    expires_at: invitation.expires_at,
    delivery,
  };

  if (process.env.NODE_ENV === "production") {
    return safePayload;
  }

  const developerPayload = {
    ...safePayload,
    path: invitation.path,
    url: invitation.url,
  };

  if (delivery.status === "sent") {
    return developerPayload;
  }

  return {
    ...developerPayload,
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
      reason: "RESEND_NOT_CONFIGURED",
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
      channel: "resend",
      status: result.status,
      message_id: result.messageId || null,
      accepted: result.accepted || [],
      rejected: result.rejected || [],
    });
  } catch (error) {
    return buildPublicInvitationPayload(invitation, {
      channel: "manual",
      status: "failed",
      reason: "RESEND_SEND_FAILED",
      error: error.message,
    });
  }
}

exports.getUsers = async ({ pagination, search }) => {
  const where = buildUserSearchWhere(search);

  const data = await repository.findMany({
    where,
    skip: pagination.skip,
    take: pagination.take,
  });
  const total = await repository.count(where);

  return {
    data: data.map(serializeUser),
    meta: buildPaginationMeta(total, pagination),
  };
};

exports.getAssignableUsers = async ({ pagination, search }) => {
  const where = buildUserSearchWhere(search);
  const data = await repository.findAssignableMany({
    where,
    skip: pagination.skip,
    take: pagination.take,
  });
  const total = await repository.countAssignable(where);

  return {
    data: data.map(serializeAssignableUserLite),
    meta: buildPaginationMeta(total, pagination),
  };
};

exports.getUsersForRequest = async ({ pagination, search, requestUser }) => {
  const user = await resolveRequestUser(requestUser);
  if (!user) {
    throw new AppError("Sesi pengguna tidak valid.", 401);
  }

  const canReadUserManagement = await roleHasPermission(
    user.role_id,
    USER_MENU_URL,
    "read",
  );

  if (canReadUserManagement) {
    return exports.getUsers({ pagination, search });
  }

  return exports.getAssignableUsers({ pagination, search });
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
    can_access_restricted_documents:
      payload.can_access_restricted_documents ?? payload.is_restrict ?? false,
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
    throw new AppError(
      "Gunakan fitur Tutup Akses atau Aktifkan Kembali untuk mengubah status akun.",
      422,
    );
  }

  if (
    typeof payload.can_access_restricted_documents === "boolean" ||
    typeof payload.is_restrict === "boolean"
  ) {
    nextData.can_access_restricted_documents =
      typeof payload.can_access_restricted_documents === "boolean"
        ? payload.can_access_restricted_documents
        : payload.is_restrict;
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
    throw new AppError(
      "Password hanya dapat diubah melalui alur reset password.",
      422,
    );
  }

  const updatedUser = await repository.update(id, nextData);
  return serializeUser(updatedUser);
};

exports.sendInvite = async (id) => {
  const user = await repository.findAuthRecordById(id);

  if (!user) {
    throw new AppError("Pengguna tidak ditemukan.", 404);
  }

  if (!user.is_active) {
    throw new AppError("Akses pengguna sedang ditutup.", 409);
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

exports.closeAccess = async (id, actorId, payload) => {
  const user = await repository.findById(id);

  if (!user) {
    throw new AppError("Pengguna tidak ditemukan.", 404);
  }

  if (id === actorId) {
    throw new AppError("Anda tidak dapat menutup akses akun sendiri.", 422);
  }

  if (!user.is_active) {
    throw new AppError("Akses pengguna sudah ditutup.", 409);
  }

  const now = new Date();
  const reason = normalizeReason(payload.reason);
  const updatedUser = await repository.updateAccessStatus({
    id,
    revokedAt: now,
    data: {
      is_active: false,
      deactivated_at: now,
      deactivated_by: actorId,
      deactivation_reason: reason,
    },
  });

  await authRepository.invalidateInviteTokens(id, now);
  await authRepository.invalidateResetPasswordTokens(id, now);

  return serializeUser(updatedUser);
};

exports.reactivateAccess = async (id, actorId, payload) => {
  const user = await repository.findById(id);

  if (!user) {
    throw new AppError("Pengguna tidak ditemukan.", 404);
  }

  if (user.is_active) {
    throw new AppError("Akses pengguna sudah aktif.", 409);
  }

  const now = new Date();
  const reason = normalizeReason(payload.reason);
  const updatedUser = await repository.updateAccessStatus({
    id,
    data: {
      is_active: true,
      reactivated_at: now,
      reactivated_by: actorId,
      reactivation_reason: reason,
    },
  });

  return serializeUser(updatedUser);
};

exports.getDeleteImpact = async (id, actorId) => {
  const user = await repository.findById(id);

  if (!user) {
    throw new AppError("Pengguna tidak ditemukan.", 404);
  }

  const dependencySummary = await repository.findDependencySummary(id);
  return buildDeleteImpact(user, actorId, dependencySummary);
};

exports.deleteUser = async (id, actorId) => {
  const user = await repository.findById(id);

  if (!user) {
    throw new AppError("Pengguna tidak ditemukan.", 404);
  }

  if (id === actorId) {
    throw new AppError("Anda tidak dapat menghapus akun sendiri.", 422);
  }

  const dependencySummary = await repository.findDependencySummary(id);
  const deleteImpact = buildDeleteImpact(user, actorId, dependencySummary);

  if (!deleteImpact.can_delete) {
    throw new AppError(
      deleteImpact.message,
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
