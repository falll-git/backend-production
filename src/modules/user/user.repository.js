const prisma = require("../../config/prisma");

const auditUserSelect = {
  id: true,
  name: true,
  username: true,
  email: true,
};

function getUserSelect() {
  return {
    id: true,
    role_id: true,
    division_id: true,
    name: true,
    username: true,
    email: true,
    phone: true,
    is_active: true,
    can_access_restricted_documents: true,
    onboarding_status: true,
    email_verified_at: true,
    password_set_at: true,
    invited_at: true,
    activated_at: true,
    deactivated_at: true,
    deactivated_by: true,
    deactivation_reason: true,
    reactivated_at: true,
    reactivated_by: true,
    reactivation_reason: true,
    created_at: true,
    updated_at: true,
    deactivator: {
      select: auditUserSelect,
    },
    reactivator: {
      select: auditUserSelect,
    },
    role: {
      select: {
        id: true,
        name: true,
      },
    },
    division: {
      select: {
        id: true,
        name: true,
      },
    },
    auth_action_tokens: {
      where: {
        type: "INVITE",
        used_at: null,
        expires_at: {
          gt: new Date(),
        },
      },
      select: {
        id: true,
        expires_at: true,
      },
      orderBy: {
        expires_at: "desc",
      },
      take: 1,
    },
  };
}

function getAssignableUserSelect() {
  return {
    id: true,
    role_id: true,
    division_id: true,
    name: true,
    username: true,
    email: true,
    phone: true,
    is_active: true,
    onboarding_status: true,
    password_set_at: true,
    role: {
      select: {
        id: true,
        name: true,
      },
    },
    division: {
      select: {
        id: true,
        name: true,
      },
    },
  };
}

function getAssignableUserLiteSelect() {
  return {
    id: true,
    role_id: true,
    division_id: true,
    name: true,
    username: true,
    role: {
      select: {
        id: true,
        name: true,
      },
    },
    division: {
      select: {
        id: true,
        name: true,
      },
    },
  };
}

function assignableUserWhere() {
  return {
    is_active: true,
    onboarding_status: "ACTIVE",
    password_set_at: {
      not: null,
    },
  };
}

exports.findMany = ({ where, skip, take }) => {
  return prisma.users.findMany({
    where,
    skip,
    take,
    orderBy: { created_at: "desc" },
    select: getUserSelect(),
  });
};

exports.findAssignableMany = ({ where, skip, take }) => {
  return prisma.users.findMany({
    where: {
      ...assignableUserWhere(),
      ...where,
    },
    skip,
    take,
    orderBy: { name: "asc" },
    select: getAssignableUserLiteSelect(),
  });
};

exports.countAssignable = (where = {}) => {
  return prisma.users.count({
    where: {
      ...assignableUserWhere(),
      ...where,
    },
  });
};

exports.count = (where) => {
  return prisma.users.count({ where });
};

exports.findById = (id) => {
  return prisma.users.findUnique({
    where: { id },
    select: getUserSelect(),
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
  });
};

exports.findByUsername = (username) => {
  return prisma.users.findFirst({
    where: {
      username: {
        equals: username,
        mode: "insensitive",
      },
    },
  });
};

exports.findActiveUsersByDivisionRoleFeature = ({
  divisionId,
  menuUrls = [],
  feature,
}) => {
  return prisma.users.findMany({
    where: {
      ...assignableUserWhere(),
      division_id: divisionId,
      role: {
        roles_menus: {
          some: {
            can_read: true,
            features: {
              has: feature,
            },
            menu: {
              url: {
                in: menuUrls,
              },
            },
          },
        },
      },
    },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      role_id: true,
      division_id: true,
      role: {
        select: {
          id: true,
          name: true,
        },
      },
      division: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });
};

exports.findAssignableUserById = (id) => {
  return prisma.users.findFirst({
    where: {
      id,
      ...assignableUserWhere(),
    },
    select: getAssignableUserSelect(),
  });
};

exports.findAssignableUsersByIds = (ids) => {
  const normalizedIds = [
    ...new Set(
      (Array.isArray(ids) ? ids : [ids])
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean),
    ),
  ];

  if (normalizedIds.length === 0) return [];

  return prisma.users.findMany({
    where: {
      id: {
        in: normalizedIds,
      },
      ...assignableUserWhere(),
    },
    select: getAssignableUserSelect(),
  });
};

exports.findAssignableDispositionRecipients = ({
  search,
  divisionId,
  excludeUserId,
  limit = 50,
}) => {
  const where = {
    ...assignableUserWhere(),
  };

  if (divisionId) {
    where.division_id = divisionId;
  }

  if (excludeUserId) {
    where.id = {
      not: excludeUserId,
    };
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { username: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  return prisma.users.findMany({
    where,
    take: Math.max(Number(limit) || 50, 1),
    orderBy: { name: "asc" },
    select: getAssignableUserSelect(),
  });
};

exports.create = (data) => {
  return prisma.users.create({
    data,
    select: getUserSelect(),
  });
};

exports.update = (id, data) => {
  return prisma.users.update({
    where: { id },
    data,
    select: getUserSelect(),
  });
};

exports.updateAccessStatus = ({ id, data, revokedAt = null }) => {
  return prisma.$transaction(async (tx) => {
    const user = await tx.users.update({
      where: { id },
      data,
      select: getUserSelect(),
    });

    if (revokedAt) {
      await tx.refresh_tokens.updateMany({
        where: {
          user_id: id,
          revoked_at: null,
        },
        data: {
          revoked_at: revokedAt,
        },
      });
    }

    return user;
  });
};

exports.findAuthRecordById = (id) => {
  return prisma.users.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      is_active: true,
      email_verified_at: true,
      password_set_at: true,
      onboarding_status: true,
      invited_at: true,
      activated_at: true,
    },
  });
};

exports.findDependencySummary = (id) => {
  return prisma.users.findUnique({
    where: { id },
    select: {
      id: true,
      _count: {
        select: {
          sent_dispositions: true,
          received_dispositions: true,
          sent_memo_dispositions: true,
          received_memo_dispositions: true,
          created_incoming_mails: true,
          updated_incoming_mails: true,
          deleted_incoming_mails: true,
          managed_incoming_mail_targets: true,
          created_digital_documents: true,
          owned_digital_documents: true,
          updated_digital_documents: true,
          deleted_digital_documents: true,
          related_digital_documents: true,
          uploaded_document_files: true,
          requested_digital_document_accesses: true,
          owned_digital_document_accesses: true,
          acted_digital_document_accesses: true,
          borrowed_digital_document_loans: true,
          approved_digital_document_loans: true,
          rejected_digital_document_loans: true,
          handed_over_digital_document_loans: true,
          returned_digital_document_loans: true,
          digital_document_activity_logs: true,
          created_outgoing_mails: true,
          updated_outgoing_mails: true,
          deleted_outgoing_mails: true,
          created_memorandums: true,
          updated_memorandums: true,
          deleted_memorandums: true,
          managed_memorandum_targets: true,
          deactivated_users: true,
          reactivated_users: true,
        },
      },
    },
  });
};

exports.delete = (id) => {
  return prisma.users.delete({
    where: { id },
  });
};
