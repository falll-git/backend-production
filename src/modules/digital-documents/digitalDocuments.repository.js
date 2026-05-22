const prisma = require("../../config/prisma");

const USER_SUMMARY_SELECT = {
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
};

const ACTIVE_LOAN_STATUSES = ["PENDING", "APPROVED", "HANDED_OVER", "BORROWED"];

function getDocumentInclude() {
  return {
    document_type: true,
    storage: {
      include: {
        cabinet: {
          include: {
            office: true,
          },
        },
      },
    },
    creator: {
      select: USER_SUMMARY_SELECT,
    },
    owner: {
      select: USER_SUMMARY_SELECT,
    },
    owner_division: true,
    debtor: true,
    updater: {
      select: USER_SUMMARY_SELECT,
    },
    deleter: {
      select: USER_SUMMARY_SELECT,
    },
    document_files: {
      where: {
        deleted_at: null,
      },
      orderBy: [{ is_primary: "desc" }, { created_at: "desc" }],
      include: {
        uploader: {
          select: USER_SUMMARY_SELECT,
        },
      },
    },
    access_requests: {
      where: {
        status: "APPROVED",
        expires_at: {
          gte: new Date(),
        },
      },
      select: {
        id: true,
        requester_id: true,
        status: true,
        expires_at: true,
      },
    },
    related_users: {
      orderBy: {
        created_at: "asc",
      },
      include: {
        user: {
          select: USER_SUMMARY_SELECT,
        },
      },
    },
    loans: {
      where: {
        status: {
          in: ACTIVE_LOAN_STATUSES,
        },
      },
      orderBy: {
        created_at: "desc",
      },
      take: 1,
      include: {
        borrower: {
          select: USER_SUMMARY_SELECT,
        },
        approver: {
          select: USER_SUMMARY_SELECT,
        },
        rejector: {
          select: USER_SUMMARY_SELECT,
        },
        handover_actor: {
          select: USER_SUMMARY_SELECT,
        },
        return_actor: {
          select: USER_SUMMARY_SELECT,
        },
      },
    },
  };
}

function withTransaction(callback) {
  return prisma.$transaction(callback);
}

function findMany({ where, skip, take }) {
  return prisma.digital_documents.findMany({
    where,
    skip,
    take,
    orderBy: {
      created_at: "desc",
    },
    include: getDocumentInclude(),
  });
}

function count(where) {
  return prisma.digital_documents.count({ where });
}

function findById(id, where = {}) {
  return prisma.digital_documents.findFirst({
    where: {
      id,
      ...where,
    },
    include: getDocumentInclude(),
  });
}

function findByDocumentNumber(documentNumber) {
  return prisma.digital_documents.findFirst({
    where: {
      document_number: documentNumber,
      deleted_at: null,
    },
  });
}

function findDocumentNumbersByPrefix(prefix, client = prisma) {
  return client.digital_documents.findMany({
    where: {
      document_number: {
        startsWith: prefix,
      },
    },
    select: {
      document_number: true,
    },
  });
}

function create(data, client = prisma) {
  return client.digital_documents.create({ data });
}

function update(id, data, client = prisma) {
  return client.digital_documents.update({
    where: { id },
    data,
  });
}

function findUserById(id, client = prisma) {
  return client.users.findFirst({
    where: {
      id,
      is_active: true,
    },
    include: {
      role: true,
      division: true,
    },
  });
}

function findUsersByIds(ids, client = prisma) {
  return client.users.findMany({
    where: {
      id: {
        in: ids,
      },
      is_active: true,
    },
    include: {
      role: true,
      division: true,
    },
  });
}

function findDivisionById(id, client = prisma) {
  return client.divisions.findUnique({
    where: {
      id,
    },
  });
}

function findDebtorById(id, client = prisma) {
  return client.digital_debtors.findUnique({
    where: {
      id,
    },
  });
}

function findDebtorByDebtorNumber(debtorNumber, client = prisma) {
  return client.digital_debtors.findUnique({
    where: {
      debtor_number: debtorNumber,
    },
  });
}

function findDebtorByIdentityNumber(identityNumber, client = prisma) {
  return client.digital_debtors.findUnique({
    where: {
      identity_number: identityNumber,
    },
  });
}

function createDebtor(data, client = prisma) {
  return client.digital_debtors.create({ data });
}

function updateDebtor(id, data, client = prisma) {
  return client.digital_debtors.update({
    where: {
      id,
    },
    data,
  });
}

async function replaceRelatedUsers(documentId, userIds, client = prisma) {
  await client.digital_document_related_users.deleteMany({
    where: {
      document_id: documentId,
    },
  });

  if (!userIds.length) return;

  const now = new Date();
  await client.digital_document_related_users.createMany({
    data: userIds.map((userId) => ({
      document_id: documentId,
      user_id: userId,
      created_at: now,
      updated_at: now,
    })),
    skipDuplicates: true,
  });
}

function findStorageById(id, client = prisma) {
  return client.storages.findFirst({
    where: {
      id,
      is_active: true,
    },
    include: {
      cabinet: {
        include: {
          office: true,
        },
      },
    },
  });
}

function findDocumentTypeById(id, client = prisma) {
  return client.document_types.findFirst({
    where: {
      id,
      is_active: true,
    },
  });
}

function findActiveLoanConflict(documentId, client = prisma) {
  return client.digital_document_loans.findFirst({
    where: {
      document_id: documentId,
      status: {
        in: ACTIVE_LOAN_STATUSES,
      },
    },
  });
}

function findPendingAccessConflict(documentId, client = prisma) {
  return client.digital_document_access_requests.findFirst({
    where: {
      document_id: documentId,
      status: "PENDING",
    },
  });
}

function createActivityLog(data, client = prisma) {
  return client.digital_document_activity_logs.create({
    data,
  });
}

function createDocumentFile(data, client = prisma) {
  return client.document_files.create({
    data,
  });
}

function clearPrimaryDocumentFiles(documentId, client = prisma) {
  return client.document_files.updateMany({
    where: {
      document_id: documentId,
      deleted_at: null,
      is_primary: true,
    },
    data: {
      is_primary: false,
    },
  });
}

async function countPendingAccessRequestsByDocumentId(
  documentId,
  client = prisma,
) {
  return client.digital_document_access_requests.count({
    where: {
      document_id: documentId,
      status: "PENDING",
    },
  });
}

async function countLoansByDocumentId(documentId, client = prisma) {
  return client.digital_document_loans.count({
    where: {
      document_id: documentId,
    },
  });
}

function findActivityLogsByDocumentId(documentId, { skip, take } = {}) {
  return prisma.digital_document_activity_logs.findMany({
    where: {
      document_id: documentId,
    },
    skip,
    take,
    orderBy: {
      created_at: "desc",
    },
    include: {
      actor: {
        select: USER_SUMMARY_SELECT,
      },
      document: {
        select: {
          id: true,
          document_number: true,
          document_name: true,
        },
      },
      from_storage: {
        include: {
          cabinet: {
            include: {
              office: true,
            },
          },
        },
      },
      to_storage: {
        include: {
          cabinet: {
            include: {
              office: true,
            },
          },
        },
      },
    },
  });
}

function countActivityLogsByDocumentId(documentId) {
  return prisma.digital_document_activity_logs.count({
    where: {
      document_id: documentId,
    },
  });
}

module.exports = {
  USER_SUMMARY_SELECT,
  ACTIVE_LOAN_STATUSES,
  create,
  createActivityLog,
  createDebtor,
  createDocumentFile,
  clearPrimaryDocumentFiles,
  count,
  countLoansByDocumentId,
  countPendingAccessRequestsByDocumentId,
  countActivityLogsByDocumentId,
  findActivityLogsByDocumentId,
  findActiveLoanConflict,
  findByDocumentNumber,
  findById,
  findDocumentNumbersByPrefix,
  findDebtorByDebtorNumber,
  findDebtorById,
  findDebtorByIdentityNumber,
  findDivisionById,
  findDocumentTypeById,
  findMany,
  findPendingAccessConflict,
  findStorageById,
  findUserById,
  findUsersByIds,
  getDocumentInclude,
  replaceRelatedUsers,
  update,
  updateDebtor,
  withTransaction,
};
