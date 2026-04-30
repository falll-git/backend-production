const prisma = require("../../config/prisma");
const {
  getDigitalArchiveAccessScope,
  buildDocumentVisibilityWhere,
} = require("../../utils/digital-archive-access");
const {
  serializeDigitalDocumentActivityLog,
  serializeStorageSummary,
} = require("../../utils/digital-archive-serializer");
const digitalDocumentService = require("../digital-documents/digitalDocuments.service");
const accessRequestService = require("../digital-document-access-requests/digitalDocumentAccessRequests.service");
const loanService = require("../digital-document-loans/digitalDocumentLoans.service");

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildRackIdentityMaps(offices) {
  const rackById = new Map();
  const officeIdByRackId = new Map();
  const cabinetIdByRackId = new Map();

  for (const office of offices) {
    for (const cabinet of office.cabinets) {
      for (const rack of cabinet.racks) {
        rackById.set(rack.id, rack);
        officeIdByRackId.set(rack.id, office.id);
        cabinetIdByRackId.set(rack.id, cabinet.id);
      }
    }
  }

  return {
    rackById,
    officeIdByRackId,
    cabinetIdByRackId,
  };
}

async function loadStorageHierarchy() {
  return prisma.storage_offices.findMany({
    orderBy: {
      name: "asc",
    },
    include: {
      cabinets: {
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
}

async function loadStorageSummaryData(scope) {
  const visibilityWhere = buildDocumentVisibilityWhere(scope);

  const offices = await loadStorageHierarchy();
  const documents = await prisma.digital_documents.findMany({
    where: {
      deleted_at: null,
      ...visibilityWhere,
    },
    select: {
      id: true,
      storage_id: true,
    },
  });

  const pendingAccessRequests =
    await prisma.digital_document_access_requests.findMany({
      where: {
        status: "PENDING",
        document: {
          deleted_at: null,
          ...visibilityWhere,
        },
      },
      select: {
        document: {
          select: {
            storage_id: true,
          },
        },
      },
    });

  const borrowedLoans = await prisma.digital_document_loans.findMany({
    where: {
      status: "BORROWED",
      document: {
        deleted_at: null,
        ...visibilityWhere,
      },
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

  return {
    offices,
    documents,
    pendingAccessRequests,
    borrowedLoans,
  };
}

function buildStorageSummaryResponse({
  offices,
  documents,
  pendingAccessRequests,
  borrowedLoans,
}) {
  const { officeIdByRackId, cabinetIdByRackId } =
    buildRackIdentityMaps(offices);
  const now = new Date();

  const documentCountByOffice = new Map();
  const documentCountByCabinet = new Map();
  const documentCountByRack = new Map();
  const accessCountByOffice = new Map();
  const accessCountByCabinet = new Map();
  const accessCountByRack = new Map();
  const borrowedCountByOffice = new Map();
  const borrowedCountByCabinet = new Map();
  const borrowedCountByRack = new Map();
  const overdueCountByOffice = new Map();
  const overdueCountByCabinet = new Map();
  const overdueCountByRack = new Map();

  function increment(map, key) {
    if (!key) return;
    map.set(key, (map.get(key) || 0) + 1);
  }

  for (const document of documents) {
    const rackId = document.storage_id;
    increment(documentCountByRack, rackId);
    increment(documentCountByCabinet, cabinetIdByRackId.get(rackId));
    increment(documentCountByOffice, officeIdByRackId.get(rackId));
  }

  for (const item of pendingAccessRequests) {
    const rackId = item.document.storage_id;
    increment(accessCountByRack, rackId);
    increment(accessCountByCabinet, cabinetIdByRackId.get(rackId));
    increment(accessCountByOffice, officeIdByRackId.get(rackId));
  }

  for (const item of borrowedLoans) {
    const rackId = item.document.storage_id;
    increment(borrowedCountByRack, rackId);
    increment(borrowedCountByCabinet, cabinetIdByRackId.get(rackId));
    increment(borrowedCountByOffice, officeIdByRackId.get(rackId));

    if (new Date(item.requested_due_date) < now) {
      increment(overdueCountByRack, rackId);
      increment(overdueCountByCabinet, cabinetIdByRackId.get(rackId));
      increment(overdueCountByOffice, officeIdByRackId.get(rackId));
    }
  }

  const officeSummary = offices.map((office) => {
    const rackIds = office.cabinets.flatMap((cabinet) =>
      cabinet.racks.map((rack) => rack.id),
    );
    return {
      id: office.id,
      code: office.code,
      name: office.name,
      total_documents: documentCountByOffice.get(office.id) || 0,
      cabinet_count: office.cabinets.length,
      rack_count: rackIds.length,
      pending_access_request_count: accessCountByOffice.get(office.id) || 0,
      borrowed_document_count: borrowedCountByOffice.get(office.id) || 0,
      overdue_document_count: overdueCountByOffice.get(office.id) || 0,
    };
  });

  const cabinetSummary = offices.flatMap((office) =>
    office.cabinets.map((cabinet) => ({
      id: cabinet.id,
      office_id: office.id,
      office_code: office.code,
      office_name: office.name,
      code: cabinet.code,
      rack_count: cabinet.racks.length,
      total_documents: documentCountByCabinet.get(cabinet.id) || 0,
      pending_access_request_count: accessCountByCabinet.get(cabinet.id) || 0,
      borrowed_document_count: borrowedCountByCabinet.get(cabinet.id) || 0,
      overdue_document_count: overdueCountByCabinet.get(cabinet.id) || 0,
    })),
  );

  const rackSummary = offices.flatMap((office) =>
    office.cabinets.flatMap((cabinet) =>
      cabinet.racks.map((rack) => ({
        id: rack.id,
        office_id: office.id,
        office_code: office.code,
        office_name: office.name,
        cabinet_id: cabinet.id,
        cabinet_code: cabinet.code,
        rack_name: rack.name,
        capacity: rack.capacity,
        is_active: rack.is_active,
        total_documents: documentCountByRack.get(rack.id) || 0,
        pending_access_request_count: accessCountByRack.get(rack.id) || 0,
        borrowed_document_count: borrowedCountByRack.get(rack.id) || 0,
        overdue_document_count: overdueCountByRack.get(rack.id) || 0,
      })),
    ),
  );

  return {
    offices: officeSummary,
    cabinets: cabinetSummary,
    racks: rackSummary,
  };
}

function buildActivityWhere(query, visibilityWhere) {
  const where = {
    document: {
      deleted_at: null,
      ...visibilityWhere,
    },
  };

  if (query.action) {
    where.action = String(query.action).trim().toUpperCase();
  } else {
    where.action = {
      in: ["CREATED", "UPDATED", "STORAGE_MOVED", "DELETED"],
    };
  }

  if (query.document_id) {
    where.document_id = query.document_id;
  }

  if (query.office_id) {
    where.OR = [
      {
        from_storage: {
          cabinet: {
            office_id: query.office_id,
          },
        },
      },
      {
        to_storage: {
          cabinet: {
            office_id: query.office_id,
          },
        },
      },
    ];
  }

  if (query.cabinet_id) {
    where.OR = [
      ...(where.OR || []),
      {
        from_storage: {
          cabinet_id: query.cabinet_id,
        },
      },
      {
        to_storage: {
          cabinet_id: query.cabinet_id,
        },
      },
    ];
  }

  if (query.storage_id) {
    where.OR = [
      ...(where.OR || []),
      {
        from_storage_id: query.storage_id,
      },
      {
        to_storage_id: query.storage_id,
      },
    ];
  }

  if (query.search) {
    const normalized = String(query.search).trim();
    where.AND = [
      ...(where.AND || []),
      {
        OR: [
          {
            description: {
              contains: normalized,
              mode: "insensitive",
            },
          },
          {
            document: {
              document_number: {
                contains: normalized,
                mode: "insensitive",
              },
            },
          },
          {
            document: {
              document_name: {
                contains: normalized,
                mode: "insensitive",
              },
            },
          },
          {
            actor: {
              name: {
                contains: normalized,
                mode: "insensitive",
              },
            },
          },
          {
            actor: {
              username: {
                contains: normalized,
                mode: "insensitive",
              },
            },
          },
        ],
      },
    ];
  }

  return where;
}

exports.getStorageSummary = async ({ userId }) => {
  const scope = await getDigitalArchiveAccessScope(userId);
  const data = await loadStorageSummaryData(scope);
  return buildStorageSummaryResponse(data);
};

exports.getOfficeCabinets = async ({ officeId, userId }) => {
  const summary = await exports.getStorageSummary({ userId });
  return summary.cabinets.filter((item) => item.office_id === officeId);
};

exports.getCabinetRacks = async ({ cabinetId, userId }) => {
  const summary = await exports.getStorageSummary({ userId });
  return summary.racks.filter((item) => item.cabinet_id === cabinetId);
};

exports.getRackDocuments = async ({ req, rackId, query, userId }) => {
  return digitalDocumentService.getAll({
    req,
    query: {
      ...query,
      storage_id: rackId,
    },
    userId,
  });
};

exports.getStorageHistories = async ({ query, userId }) => {
  const scope = await getDigitalArchiveAccessScope(userId);
  const visibilityWhere = buildDocumentVisibilityWhere(scope);
  const where = buildActivityWhere(query, visibilityWhere);
  const page = parsePositiveInteger(query.page, 1);
  const limit = Math.min(parsePositiveInteger(query.limit, 20), 100);
  const skip = (page - 1) * limit;

  const data = await prisma.digital_document_activity_logs.findMany({
    where,
    skip,
    take: limit,
    orderBy: {
      created_at: "desc",
    },
    include: {
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
    },
  });
  const total = await prisma.digital_document_activity_logs.count({ where });

  return {
    data: data.map(serializeDigitalDocumentActivityLog),
    meta: {
      total,
      page,
      lastPage: Math.ceil(total / limit),
    },
  };
};

exports.getAccessRequestHistories = async ({ req, query, userId }) => {
  return accessRequestService.getAll({
    req,
    query: {
      ...query,
      report: "history",
    },
    userId,
  });
};

exports.getLoanHistories = async ({ req, query, userId }) => {
  return loanService.getAll({
    req,
    query: {
      ...query,
      report: "history",
    },
    userId,
  });
};

exports.getLoanReport = async ({ req, query, userId }) => {
  return loanService.getAll({
    req,
    query,
    userId,
  });
};

exports.getOverdueLoans = async ({ req, query, userId }) => {
  return loanService.getAll({
    req,
    query: {
      ...query,
      report: "overdue",
    },
    userId,
  });
};
