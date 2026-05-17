const prisma = require("../../config/prisma");

const ACTIVITY_LOG_INCLUDE = {
  actor: {
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
    },
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
};

exports.findStorageHierarchy = () => {
  return prisma.storage_offices.findMany({
    where: {
      cabinets: {
        some: {
          racks: {
            some: {},
          },
        },
      },
    },
    orderBy: {
      name: "asc",
    },
    include: {
      cabinets: {
        where: {
          racks: {
            some: {},
          },
        },
        orderBy: {
          code: "asc",
        },
        include: {
          racks: {
            orderBy: {
              name: "asc",
            },
            include: {
              cabinet: {
                include: {
                  office: true,
                },
              },
            },
          },
        },
      },
    },
  });
};

exports.findStorageSummaryDocuments = (where) => {
  return prisma.digital_documents.findMany({
    where,
    select: {
      id: true,
      storage_id: true,
    },
  });
};

exports.findPendingAccessRequestsByDocument = (documentWhere) => {
  return prisma.digital_document_access_requests.findMany({
    where: {
      status: "PENDING",
      document: documentWhere,
    },
    select: {
      document: {
        select: {
          storage_id: true,
        },
      },
    },
  });
};

exports.findBorrowedLoansByDocument = (documentWhere) => {
  return prisma.digital_document_loans.findMany({
    where: {
      status: {
        in: ["HANDED_OVER", "BORROWED"],
      },
      document: documentWhere,
    },
    select: {
      requested_due_date: true,
      document: {
        select: {
          storage_id: true,
        },
      },
    },
  });
};

exports.groupDigitalDocuments = (args) => prisma.digital_documents.groupBy(args);

exports.findDocumentTypesByIds = (ids) => {
  return prisma.document_types.findMany({
    where: {
      id: {
        in: ids,
      },
    },
    select: {
      id: true,
      code: true,
      name: true,
    },
  });
};

exports.findDivisionsByIds = (ids) => {
  return prisma.divisions.findMany({
    where: {
      id: {
        in: ids,
      },
    },
    select: {
      id: true,
      name: true,
    },
  });
};

exports.findUsersByIds = (ids) => {
  return prisma.users.findMany({
    where: {
      id: {
        in: ids,
      },
    },
    select: {
      id: true,
      username: true,
      name: true,
      division: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
};

exports.countDocuments = (where) => prisma.digital_documents.count({ where });

exports.countAccessRequests = (where) => {
  return prisma.digital_document_access_requests.count({ where });
};

exports.countLoans = (where) => prisma.digital_document_loans.count({ where });

exports.findActivityLogs = ({ where, skip, take }) => {
  return prisma.digital_document_activity_logs.findMany({
    where,
    ...(skip !== undefined ? { skip } : {}),
    ...(take !== undefined ? { take } : {}),
    orderBy: {
      created_at: "desc",
    },
    include: ACTIVITY_LOG_INCLUDE,
  });
};

exports.countActivityLogs = (where) => {
  return prisma.digital_document_activity_logs.count({ where });
};
