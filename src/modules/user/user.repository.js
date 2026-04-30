const prisma = require("../../config/prisma");

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
    is_restrict: true,
    onboarding_status: true,
    email_verified_at: true,
    password_set_at: true,
    invited_at: true,
    activated_at: true,
    created_at: true,
    updated_at: true,
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

exports.findMany = ({ where, skip, take }) => {
  return prisma.users.findMany({
    where,
    skip,
    take,
    orderBy: { created_at: "desc" },
    select: getUserSelect(),
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

exports.findActiveManagersByDivisionId = (divisionId, roleName = "Manajer") => {
  return prisma.users.findMany({
    where: {
      division_id: divisionId,
      is_active: true,
      role: {
        name: {
          equals: roleName,
          mode: "insensitive",
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
    },
    orderBy: { name: "asc" },
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
          created_digital_documents: true,
          updated_digital_documents: true,
          deleted_digital_documents: true,
          created_outgoing_mails: true,
          updated_outgoing_mails: true,
          deleted_outgoing_mails: true,
          created_memorandums: true,
          updated_memorandums: true,
          deleted_memorandums: true,
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
