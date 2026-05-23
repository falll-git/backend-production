const repository = require("./digitalArchives.repository");
const {
  getDigitalArchiveAccessScope,
  buildDocumentVisibilityWhere,
} = require("../../utils/digital-archive-access");
const { REPORT_ALL_FEATURE } = require("../../utils/menu-access");
const { roleHasFeature } = require("../../utils/rbac");
const {
  serializeDigitalDocumentActivityLog,
} = require("../../utils/digital-archive-serializer");
const digitalDocumentService = require("../digital-documents/digitalDocuments.service");
const accessRequestService = require("../digital-document-access-requests/digitalDocumentAccessRequests.service");
const loanService = require("../digital-document-loans/digitalDocumentLoans.service");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  resolvePagination,
} = require("../../utils/pagination");

const STORAGE_READ_URLS = [
  "/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan",
  "/dashboard/arsip-digital/ruang-arsip/list-dokumen",
];
const STORAGE_HISTORY_URL = "/dashboard/arsip-digital/historis/penyimpanan";
const ACCESS_HISTORY_URL = "/dashboard/arsip-digital/disposisi/historis";
const LOAN_HISTORY_URL = "/dashboard/arsip-digital/historis/peminjaman";
const LOAN_REPORT_URL = "/dashboard/arsip-digital/peminjaman/laporan";
const DIGITAL_ARCHIVE_REPORT_URL = "/dashboard/arsip-digital/laporan";

function isNonEmptyObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length > 0,
  );
}

function andWhere(...clauses) {
  return {
    AND: clauses.filter(isNonEmptyObject),
  };
}

async function getDigitalArchiveReportScope(
  userId,
  menuUrls = DIGITAL_ARCHIVE_REPORT_URL,
) {
  const scope = await getDigitalArchiveAccessScope(userId, menuUrls);
  const canReportAll = await roleHasFeature(
    scope.roleId,
    menuUrls,
    REPORT_ALL_FEATURE,
  );

  return {
    ...scope,
    canReportAll,
    canViewAllDocuments: Boolean(canReportAll),
    canAccessRestricted: Boolean(scope.canAccessRestricted),
    canAccessRestrictedDocuments: Boolean(
      scope.canAccessRestrictedDocuments ?? scope.canAccessRestricted,
    ),
  };
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
  return repository.findStorageHierarchy();
}

async function loadStorageSummaryData(scope) {
  const visibilityWhere = buildDocumentVisibilityWhere(scope);

  const offices = await loadStorageHierarchy();
  const documentWhere = andWhere(
    {
      deleted_at: null,
    },
    visibilityWhere,
  );
  const documents = await repository.findStorageSummaryDocuments(documentWhere);

  const pendingAccessRequests =
    await repository.findPendingAccessRequestsByDocument(documentWhere);

  const borrowedLoans = await repository.findBorrowedLoansByDocument(documentWhere);

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
      overdue_loan_count: overdueCountByOffice.get(office.id) || 0,
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
      capacity: cabinet.racks.reduce(
        (total, rack) => total + (rack.capacity || 0),
        0,
      ),
      is_active: cabinet.racks.some((rack) => Boolean(rack.is_active)),
      rack_count: cabinet.racks.length,
      total_documents: documentCountByCabinet.get(cabinet.id) || 0,
      pending_access_request_count: accessCountByCabinet.get(cabinet.id) || 0,
      borrowed_document_count: borrowedCountByCabinet.get(cabinet.id) || 0,
      overdue_loan_count: overdueCountByCabinet.get(cabinet.id) || 0,
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
        overdue_loan_count: overdueCountByRack.get(rack.id) || 0,
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

function hasCollectionQuery(query = {}) {
  return (
    query.page !== undefined ||
    query.limit !== undefined ||
    query.search !== undefined
  );
}

function normalizeSearch(search = "") {
  return String(search || "").trim().toLowerCase();
}

function matchesSummarySearch(fields, search) {
  if (!search) return true;

  return fields.some((field) =>
    String(field ?? "")
      .toLowerCase()
      .includes(search),
  );
}

function paginateSummaryCollection(items, query, getSearchFields) {
  const search = normalizeSearch(query.search);
  const filtered = search
    ? items.filter((item) => matchesSummarySearch(getSearchFields(item), search))
    : items;
  const pagination = resolvePagination(query, {
    ...PAGINATION_PROFILES.SETUP,
    allowAll: true,
  });

  if (pagination.all) {
    return filtered;
  }

  return {
    data: filtered.slice(
      pagination.skip,
      pagination.skip + pagination.limit,
    ),
    meta: buildPaginationMeta(filtered.length, pagination),
  };
}

function calculatePercentage(part, total) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(2));
}

function buildRiskQueue({
  dueSoonLoans,
  pendingAccessRequests,
  pendingLoans,
  approvedLoans,
  handedOverLoans,
  borrowedLoans,
  overdueLoans,
}) {
  const activeLoans = handedOverLoans + borrowedLoans;

  return [
    {
      key: "overdue_loans",
      label: "Peminjaman melewati jatuh tempo",
      total: overdueLoans,
      severity: overdueLoans > 0 ? "critical" : "normal",
      report_key: "due_dates",
      endpoint: "/api/digital-archives/reports/due-dates",
      query: {
        due_status: "OVERDUE",
      },
    },
    {
      key: "due_soon_loans",
      label: "Peminjaman jatuh tempo 30 hari",
      total: dueSoonLoans,
      severity: dueSoonLoans > 0 ? "warning" : "normal",
      report_key: "due_dates",
      endpoint: "/api/digital-archives/reports/due-dates",
      query: {
        due_status: "UPCOMING",
      },
    },
    {
      key: "pending_access_requests",
      label: "Permintaan disposisi menunggu",
      total: pendingAccessRequests,
      severity: pendingAccessRequests > 0 ? "warning" : "normal",
      report_key: "access_requests",
      endpoint: "/api/digital-archives/reports/access-requests",
      query: {
        status: "PENDING",
      },
    },
    {
      key: "pending_loans",
      label: "Pengajuan peminjaman menunggu",
      total: pendingLoans,
      severity: pendingLoans > 0 ? "warning" : "normal",
      report_key: "loans",
      endpoint: "/api/digital-archives/reports/loans",
      query: {
        status: "PENDING",
      },
    },
    {
      key: "active_loans",
      label: "Dokumen sedang dipinjam",
      total: activeLoans,
      severity: activeLoans > 0 ? "info" : "normal",
      report_key: "loans",
      endpoint: "/api/digital-archives/reports/loans",
      query: {
        status: "ACTIVE",
      },
    },
    {
      key: "approved_not_handed_over",
      label: "Peminjaman disetujui belum diserahkan",
      total: approvedLoans,
      severity: approvedLoans > 0 ? "info" : "normal",
      report_key: "loans",
      endpoint: "/api/digital-archives/reports/loans",
      query: {
        status: "APPROVED",
      },
    },
  ];
}

function buildWorkflowSummary({
  pendingAccessRequests,
  approvedAccessRequests,
  rejectedAccessRequests,
  pendingLoans,
  approvedLoans,
  handedOverLoans,
  borrowedLoans,
  returnedLoans,
  rejectedLoans,
  overdueLoans,
}) {
  const accessTotal =
    pendingAccessRequests + approvedAccessRequests + rejectedAccessRequests;
  const loanTotal =
    pendingLoans +
    approvedLoans +
    handedOverLoans +
    borrowedLoans +
    returnedLoans +
    rejectedLoans;

  return {
    access_requests: {
      total: accessTotal,
      pending: pendingAccessRequests,
      approved: approvedAccessRequests,
      rejected: rejectedAccessRequests,
      completion_percent: calculatePercentage(
        approvedAccessRequests + rejectedAccessRequests,
        accessTotal,
      ),
    },
    loans: {
      total: loanTotal,
      pending: pendingLoans,
      approved: approvedLoans,
      handed_over: handedOverLoans,
      borrowed: borrowedLoans,
      active: handedOverLoans + borrowedLoans,
      returned: returnedLoans,
      rejected: rejectedLoans,
      overdue: overdueLoans,
      completion_percent: calculatePercentage(
        returnedLoans + rejectedLoans,
        loanTotal,
      ),
    },
  };
}

function buildReportScope(scope) {
  return {
    user_id: scope.userId,
    role_name: scope.roleName,
    division_id: scope.divisionId,
    division_name: scope.divisionName,
    can_view_division_documents: scope.canAccessDivisionDocuments,
    can_view_all_documents: Boolean(scope.canViewAllDocuments),
    can_access_restricted_documents: Boolean(
      scope.canAccessRestrictedDocuments ?? scope.canAccessRestricted,
    ),
    can_manage_all_documents: Boolean(scope.canManageAllDocuments),
    can_report_all: Boolean(scope.canReportAll),
  };
}

function buildOperationalSummary({
  now,
  scope,
  totalDocuments,
  restrictedDocuments,
  activeAccessRequests,
  expiringAccessRequests,
  expiredAccessRequests,
  dueSoonLoans,
  overdueLoans,
  pendingAccessRequests,
  pendingLoans,
  activeLoans,
}) {
  return {
    version: "digital_archive_operational_summary.v3",
    generated_at: now.toISOString(),
    scope,
    metrics: {
      total_active_documents: totalDocuments,
      restricted_documents: restrictedDocuments,
      non_restricted_documents: totalDocuments - restrictedDocuments,
      active_access_requests: activeAccessRequests,
      expiring_access_requests: expiringAccessRequests,
      expired_access_requests: expiredAccessRequests,
      active_loans: activeLoans,
      pending_access_requests: pendingAccessRequests,
      pending_loans: pendingLoans,
      due_soon_loans: dueSoonLoans,
      overdue_loans: overdueLoans,
      due_or_overdue_loans: dueSoonLoans + overdueLoans,
    },
  };
}

function mapGroupedCount(rows, lookup, idField, fallbackLabel) {
  return rows
    .map((row) => {
      const id = row[idField] || null;
      const item = id ? lookup.get(id) : null;
      const mapped = {
        id,
        code: item?.code || null,
        name: item?.name || fallbackLabel,
        total: row._count?._all || 0,
      };

      if (item?.division_id) mapped.division_id = item.division_id;
      if (item?.division_name) mapped.division_name = item.division_name;

      return mapped;
    })
    .sort((left, right) => right.total - left.total);
}

function mapOwnerUserGroupedCount(rows, ownerLookup, divisionLookup) {
  return rows
    .map((row) => {
      const ownerId = row.owner_user_id || null;
      const divisionId = row.owner_division_id || null;
      const owner = ownerId ? ownerLookup.get(ownerId) : null;
      const division =
        (divisionId ? divisionLookup.get(divisionId) : null) ??
        owner?.division ??
        null;

      return {
        id: ownerId,
        code: owner?.username || null,
        name: owner?.name || owner?.username || "Tanpa PIC",
        division_id: division?.id || divisionId,
        division_name: division?.name || null,
        total: row._count?._all || 0,
      };
    })
    .sort((left, right) => right.total - left.total);
}

async function buildDocumentBreakdowns(documentWhere) {
  const typeGroups = await repository.groupDigitalDocuments({
    by: ["document_type_id"],
    where: documentWhere,
    _count: {
      _all: true,
    },
  });
  const divisionGroups = await repository.groupDigitalDocuments({
    by: ["owner_division_id"],
    where: documentWhere,
    _count: {
      _all: true,
    },
  });
  const ownerGroups = await repository.groupDigitalDocuments({
    by: ["owner_user_id", "owner_division_id"],
    where: documentWhere,
    _count: {
      _all: true,
    },
  });
  const accessLevelGroups = await repository.groupDigitalDocuments({
    by: ["access_level"],
    where: documentWhere,
    _count: {
      _all: true,
    },
  });

  const documentTypes = await repository.findDocumentTypesByIds(
    typeGroups.map((item) => item.document_type_id).filter(Boolean),
  );
  const divisions = await repository.findDivisionsByIds(
    divisionGroups.map((item) => item.owner_division_id).filter(Boolean),
  );
  const owners = await repository.findUsersByIds(
    ownerGroups.map((item) => item.owner_user_id).filter(Boolean),
  );

  return {
    by_document_type: mapGroupedCount(
      typeGroups,
      new Map(documentTypes.map((item) => [item.id, item])),
      "document_type_id",
      "Tanpa jenis dokumen",
    ),
    by_owner_division: mapGroupedCount(
      divisionGroups,
      new Map(divisions.map((item) => [item.id, item])),
      "owner_division_id",
      "Tanpa divisi pemilik",
    ),
    by_owner_user: mapOwnerUserGroupedCount(
      ownerGroups,
      new Map(
        owners.map((item) => [
          item.id,
          {
            id: item.id,
            username: item.username,
            name: item.name,
            division: item.division,
          },
        ]),
      ),
      new Map(divisions.map((item) => [item.id, item])),
    ),
    by_access_level: accessLevelGroups
      .map((item) => ({
        key: item.access_level,
        total: item._count?._all || 0,
      }))
      .sort((left, right) => right.total - left.total),
  };
}

function buildActivityWhere(query, visibilityWhere) {
  const where = {
    document: andWhere(
      {
        deleted_at: null,
      },
      visibilityWhere,
    ),
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

exports.getStorageSummary = async ({ userId, scopeOverride = null }) => {
  const scope =
    scopeOverride ||
    (await getDigitalArchiveAccessScope(userId, STORAGE_READ_URLS));
  const data = await loadStorageSummaryData(scope);
  return buildStorageSummaryResponse(data);
};
exports.getStorageOffices = async ({ query = {}, userId }) => {
  const summary = await exports.getStorageSummary({ userId });

  if (!hasCollectionQuery(query)) {
    return summary;
  }

  return paginateSummaryCollection(summary.offices, query, (item) => [
    item.code,
    item.name,
  ]);
};

exports.getReportSummary = async ({ userId }) => {
  const scope = await getDigitalArchiveReportScope(userId);
  const visibilityWhere = buildDocumentVisibilityWhere(scope);
  const documentWhere = andWhere(
    {
      deleted_at: null,
    },
    visibilityWhere,
  );
  const now = new Date();
  const nextThirtyDays = new Date();
  nextThirtyDays.setDate(nextThirtyDays.getDate() + 30);

  const documentCount = (extraWhere = {}) =>
    repository.countDocuments(
      andWhere(
        {
          deleted_at: null,
        },
        visibilityWhere,
        extraWhere,
      ),
    );
  const accessCount = (where = {}) =>
    repository.countAccessRequests({
      ...where,
      document: documentWhere,
    });
  const loanCount = (status) =>
    repository.countLoans({
      status,
      document: documentWhere,
    });

  const totalDocuments = await documentCount();
  const restrictedDocuments = await documentCount({ is_restricted: true });
  const debtorDocuments = await documentCount({
    debtor_id: {
      not: null,
    },
  });
  const dueSoonLoans = await repository.countLoans({
    status: {
      in: ["HANDED_OVER", "BORROWED"],
    },
    requested_due_date: {
      gte: now,
      lte: nextThirtyDays,
    },
    document: documentWhere,
  });
  const pendingAccessRequests = await accessCount({ status: "PENDING" });
  const activeAccessRequests = await accessCount({
    status: "APPROVED",
    expires_at: {
      gte: now,
    },
  });
  const expiringAccessRequests = await accessCount({
    status: "APPROVED",
    expires_at: {
      gte: now,
      lte: nextThirtyDays,
    },
  });
  const expiredAccessRequests = await accessCount({
    status: "APPROVED",
    expires_at: {
      lt: now,
    },
  });
  const rejectedAccessRequests = await accessCount({ status: "REJECTED" });
  const pendingLoans = await loanCount("PENDING");
  const approvedLoans = await loanCount("APPROVED");
  const handedOverLoans = await loanCount("HANDED_OVER");
  const borrowedLoans = await loanCount("BORROWED");
  const returnedLoans = await loanCount("RETURNED");
  const rejectedLoans = await loanCount("REJECTED");
  const overdueLoans = await repository.countLoans({
    status: {
      in: ["HANDED_OVER", "BORROWED"],
    },
    requested_due_date: {
      lt: now,
    },
    document: documentWhere,
  });
  const documentBreakdowns = await buildDocumentBreakdowns(documentWhere);
  const activeLoans = handedOverLoans + borrowedLoans;
  const reportScope = buildReportScope(scope);

  return {
    version: "digital_archive_report.v5",
    report_mode: "OPERATIONAL_SUMMARY",
    generated_at: now.toISOString(),
    scope: reportScope,
    operational_summary: buildOperationalSummary({
      now,
      scope: reportScope,
      totalDocuments,
      restrictedDocuments,
      activeAccessRequests,
      expiringAccessRequests,
      expiredAccessRequests,
      dueSoonLoans,
      overdueLoans,
      pendingAccessRequests,
      pendingLoans,
      activeLoans,
    }),
    overview: {
      total_documents: totalDocuments,
      restricted_documents: restrictedDocuments,
      non_restricted_documents: totalDocuments - restrictedDocuments,
      linked_to_debtor_documents: debtorDocuments,
      due_soon_loans: dueSoonLoans,
      due_or_overdue_loans: dueSoonLoans + overdueLoans,
      pending_access_requests: pendingAccessRequests,
      active_access_requests: activeAccessRequests,
      expiring_access_requests: expiringAccessRequests,
      expired_access_requests: expiredAccessRequests,
      pending_loans: pendingLoans,
      active_loans: activeLoans,
      overdue_loans: overdueLoans,
    },
    documents: {
      total: totalDocuments,
      restricted: restrictedDocuments,
      non_restricted: totalDocuments - restrictedDocuments,
      linked_to_debtor: debtorDocuments,
    },
    access_requests: {
      pending: pendingAccessRequests,
      approved: activeAccessRequests,
      active: activeAccessRequests,
      expiring_soon: expiringAccessRequests,
      expired: expiredAccessRequests,
      rejected: rejectedAccessRequests,
    },
    loans: {
      pending: pendingLoans,
      approved: approvedLoans,
      handed_over: handedOverLoans,
      borrowed: borrowedLoans,
      returned: returnedLoans,
      rejected: rejectedLoans,
      due_soon: dueSoonLoans,
      overdue: overdueLoans,
    },
    risk_queue: buildRiskQueue({
      dueSoonLoans,
      pendingAccessRequests,
      pendingLoans,
      approvedLoans,
      handedOverLoans,
      borrowedLoans,
      overdueLoans,
    }),
    workflow: buildWorkflowSummary({
      pendingAccessRequests,
      approvedAccessRequests: activeAccessRequests,
      rejectedAccessRequests,
      pendingLoans,
      approvedLoans,
      handedOverLoans,
      borrowedLoans,
      returnedLoans,
      rejectedLoans,
      overdueLoans,
    }),
    breakdowns: documentBreakdowns,
  };
};

exports.getDocumentReport = async ({ req, query, userId }) => {
  const scope = await getDigitalArchiveReportScope(userId);

  return digitalDocumentService.getAll({
    req,
    query,
    userId,
    scopeOverride: scope,
  });
};

exports.getDueDateReport = async ({ req, query, userId }) => {
  const scope = await getDigitalArchiveReportScope(userId);

  const nextQuery = {
    ...query,
  };

  if (!nextQuery.status && !nextQuery.due_status && !nextQuery.report) {
    nextQuery.status = "ACTIVE";
  }

  return loanService.getAll({
    req,
    query: nextQuery,
    userId,
    scopeOverride: scope,
  });
};

exports.getAccessRequestReport = async ({ req, query, userId }) => {
  const scope = await getDigitalArchiveReportScope(userId);

  return accessRequestService.getAll({
    req,
    query,
    userId,
    scopeOverride: scope,
  });
};

exports.getOfficeCabinets = async ({ officeId, query = {}, userId }) => {
  const summary = await exports.getStorageSummary({ userId });
  const cabinets = summary.cabinets.filter((item) => item.office_id === officeId);

  if (!hasCollectionQuery(query)) {
    return cabinets;
  }

  return paginateSummaryCollection(cabinets, query, (item) => [
    item.code,
    item.office_code,
    item.office_name,
  ]);
};

exports.getCabinetRacks = async ({ cabinetId, query = {}, userId }) => {
  const summary = await exports.getStorageSummary({ userId });
  const racks = summary.racks.filter((item) => item.cabinet_id === cabinetId);

  if (!hasCollectionQuery(query)) {
    return racks;
  }

  return paginateSummaryCollection(racks, query, (item) => [
    item.rack_name,
    item.cabinet_code,
    item.office_name,
    item.capacity,
    item.is_active ? "aktif" : "nonaktif",
  ]);
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
  const scope = await getDigitalArchiveAccessScope(userId, STORAGE_HISTORY_URL);
  const visibilityWhere = buildDocumentVisibilityWhere(scope);
  const where = buildActivityWhere(query, visibilityWhere);
  const pagination = resolvePagination(query, {
    ...PAGINATION_PROFILES.HISTORY,
    allowAll: true,
  });

  if (pagination.all) {
    const data = await repository.findActivityLogs({
      where,
    });

    return {
      data: data.map(serializeDigitalDocumentActivityLog),
    };
  }

  const data = await repository.findActivityLogs({
    where,
    skip: pagination.skip,
    take: pagination.take,
  });
  const total = await repository.countActivityLogs(where);

  return {
    data: data.map(serializeDigitalDocumentActivityLog),
    meta: buildPaginationMeta(total, pagination),
  };
};

exports.getAccessRequestHistories = async ({ req, query, userId }) => {
  const scope = await getDigitalArchiveAccessScope(userId, ACCESS_HISTORY_URL);

  return accessRequestService.getAll({
    req,
    query: {
      ...query,
      report: "history",
    },
    userId,
    scopeOverride: scope,
  });
};

exports.getLoanHistories = async ({ req, query, userId }) => {
  const scope = await getDigitalArchiveAccessScope(userId, LOAN_HISTORY_URL);

  return loanService.getAll({
    req,
    query: {
      ...query,
      report: "history",
    },
    userId,
    scopeOverride: scope,
  });
};

exports.getLoanReport = async ({ req, query, userId }) => {
  const scope = await getDigitalArchiveReportScope(userId, [
    LOAN_REPORT_URL,
    DIGITAL_ARCHIVE_REPORT_URL,
  ]);

  return loanService.getAll({
    req,
    query,
    userId,
    scopeOverride: scope,
  });
};
