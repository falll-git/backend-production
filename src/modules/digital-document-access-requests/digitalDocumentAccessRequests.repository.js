const prisma = require("../../config/prisma");
const {
  USER_SUMMARY_SELECT,
  getDocumentInclude,
} = require("../digital-documents/digitalDocuments.repository");

function withTransaction(callback) {
  return prisma.$transaction(callback);
}

function getAccessRequestInclude() {
  return {
    requester: {
      select: USER_SUMMARY_SELECT,
    },
    owner: {
      select: USER_SUMMARY_SELECT,
    },
    actor: {
      select: USER_SUMMARY_SELECT,
    },
    document: {
      include: getDocumentInclude(),
    },
  };
}

function findMany({ where, skip, take }) {
  return prisma.digital_document_access_requests.findMany({
    where,
    skip,
    take,
    orderBy: {
      created_at: "desc",
    },
    include: getAccessRequestInclude(),
  });
}

function count(where) {
  return prisma.digital_document_access_requests.count({ where });
}

function findById(id) {
  return prisma.digital_document_access_requests.findUnique({
    where: { id },
    include: getAccessRequestInclude(),
  });
}

function findPendingByDocumentAndRequester(
  documentId,
  requesterId,
  client = prisma,
) {
  return client.digital_document_access_requests.findFirst({
    where: {
      document_id: documentId,
      requester_id: requesterId,
      status: "PENDING",
    },
  });
}

function findActiveApprovedByDocumentAndRequester(
  documentId,
  requesterId,
  client = prisma,
) {
  return client.digital_document_access_requests.findFirst({
    where: {
      document_id: documentId,
      requester_id: requesterId,
      status: "APPROVED",
      OR: [
        {
          expires_at: null,
        },
        {
          expires_at: {
            gte: new Date(),
          },
        },
      ],
    },
  });
}

function create(data, client = prisma) {
  return client.digital_document_access_requests.create({ data });
}

function update(id, data, client = prisma) {
  return client.digital_document_access_requests.update({
    where: { id },
    data,
  });
}

module.exports = {
  count,
  create,
  findActiveApprovedByDocumentAndRequester,
  findById,
  findMany,
  findPendingByDocumentAndRequester,
  getAccessRequestInclude,
  update,
  withTransaction,
};
