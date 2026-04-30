const prisma = require("../../config/prisma");

const USER_SUMMARY_SELECT = {
  id: true,
  name: true,
  username: true,
  email: true,
};

const ACTIVE_LOAN_STATUSES = ["PENDING", "APPROVED", "BORROWED"];

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

function countByDocumentNumberPrefix(prefix, client = prisma) {
  return client.digital_documents.count({
    where: {
      deleted_at: null,
      document_number: {
        startsWith: prefix,
      },
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
  createDocumentFile,
  clearPrimaryDocumentFiles,
  count,
  countLoansByDocumentId,
  countPendingAccessRequestsByDocumentId,
  countActivityLogsByDocumentId,
  countByDocumentNumberPrefix,
  findActivityLogsByDocumentId,
  findActiveLoanConflict,
  findByDocumentNumber,
  findById,
  findDocumentTypeById,
  findMany,
  findPendingAccessConflict,
  findStorageById,
  getDocumentInclude,
  update,
  withTransaction,
};
