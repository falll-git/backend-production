const prisma = require("../../config/prisma");
const {
  USER_SUMMARY_SELECT,
  getDocumentInclude,
} = require("../digital-documents/digitalDocuments.repository");

function withTransaction(callback) {
  return prisma.$transaction(callback);
}

function getLoanInclude() {
  return {
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
    document: {
      include: getDocumentInclude(),
    },
  };
}

function findMany({ where, skip, take }) {
  return prisma.digital_document_loans.findMany({
    where,
    skip,
    take,
    orderBy: {
      created_at: "desc",
    },
    include: getLoanInclude(),
  });
}

function count(where) {
  return prisma.digital_document_loans.count({ where });
}

function findById(id) {
  return prisma.digital_document_loans.findUnique({
    where: { id },
    include: getLoanInclude(),
  });
}

function findActiveByDocumentId(documentId, client = prisma) {
  return client.digital_document_loans.findFirst({
    where: {
      document_id: documentId,
      status: {
        in: ["PENDING", "APPROVED", "BORROWED"],
      },
    },
  });
}

function create(data, client = prisma) {
  return client.digital_document_loans.create({ data });
}

function update(id, data, client = prisma) {
  return client.digital_document_loans.update({
    where: { id },
    data,
  });
}

module.exports = {
  count,
  create,
  findActiveByDocumentId,
  findById,
  findMany,
  getLoanInclude,
  update,
  withTransaction,
};
