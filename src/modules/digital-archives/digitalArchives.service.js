const prisma = require("../../config/prisma");
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

const DIGITAL_ARCHIVE_REPORT_URL = "/dashboard/arsip-digital/laporan";

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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

async function getDigitalArchiveReportScope(userId) {
  const scope = await getDigitalArchiveAccessScope(userId);
  const canReportAll = await roleHasFeature(
    scope.roleId,
    DIGITAL_ARCHIVE_REPORT_URL,
    REPORT_ALL_FEATURE,
  );

  return {
    ...scope,
    canReportAll,
    canAccessRestricted: Boolean(scope.canAccessRestricted || canReportAll),
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
    where: andWhere(
      {
        deleted_at: null,
      },
      visibilityWhere,
    ),
    select: {
      id: true,
      storage_id: true,
    },
  });

  const pendingAccessRequests =
    await prisma.digital_document_access_requests.findMany({
      where: {
        status: "PENDING",
        document: andWhere(
          {
            deleted_at: null,
          },
          visibilityWhere,
        ),
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
      status: {
        in: ["HANDED_OVER", "BORROWED"],
      },
      document: andWhere(
        {
          deleted_at: null,
        },
        visibilityWhere,
      ),
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

function calculatePercentage(part, total) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(2));
}

function buildStorageHealth(storageSummary) {
  const usedRacks = storageSummary.racks.filter(
    (item) => item.total_documents > 0,
  );
  const usedRackCountByOffice = new Map();
  const capacityByOffice = new Map();
  const totalCapacity = storageSummary.racks.reduce((total, rack) => {
    const capacity = Number(rack.capacity) || 0;
    capacityByOffice.set(
      rack.office_id,
      (capacityByOffice.get(rack.office_id) || 0) + capacity,
    );
    return total + capacity;
  }, 0);
  const usedCapacity = storageSummary.racks.reduce(
    (total, rack) => total + (rack.total_documents || 0),
    0,
  );

  for (const rack of usedRacks) {
    usedRackCountByOffice.set(
      rack.office_id,
      (usedRackCountByOffice.get(rack.office_id) || 0) + 1,
    );
  }

  const offices = storageSummary.offices.map((office) => {
    const usedRackCount = usedRackCountByOffice.get(office.id) || 0;
    const totalOfficeCapacity = capacityByOffice.get(office.id) || 0;
    const riskCount =
      office.pending_access_request_count +
      office.borrowed_document_count +
      office.overdue_document_count;

    return {
      id: office.id,
      code: office.code,
      name: office.name,
      total_documents: office.total_documents,
      cabinet_count: office.cabinet_count,
      rack_count: office.rack_count,
      total_capacity: totalOfficeCapacity,
      used_rack_count: usedRackCount,
      empty_rack_count: Math.max(office.rack_count - usedRackCount, 0),
      utilization_percent: calculatePercentage(
        usedRackCount,
        office.rack_count,
      ),
      capacity_usage_percent: calculatePercentage(
        office.total_documents,
        totalOfficeCapacity,
      ),
      pending_access_request_count: office.pending_access_request_count,
      borrowed_document_count: office.borrowed_document_count,
      overdue_document_count: office.overdue_document_count,
      risk_count: riskCount,
    };
  });

  const rankedOffices = [...offices].sort((left, right) => {
    if (right.risk_count !== left.risk_count) {
      return right.risk_count - left.risk_count;
    }

    return right.total_documents - left.total_documents;
  });

  return {
    total_offices: storageSummary.offices.length,
    total_cabinets: storageSummary.cabinets.length,
    total_racks: storageSummary.racks.length,
    used_racks: usedRacks.length,
    empty_racks: Math.max(storageSummary.racks.length - usedRacks.length, 0),
    total_capacity: totalCapacity,
    used_capacity: usedCapacity,
    utilization_percent: calculatePercentage(
      usedRacks.length,
      storageSummary.racks.length,
    ),
    capacity_usage_percent: calculatePercentage(usedCapacity, totalCapacity),
    offices,
    top_risk_offices: rankedOffices.filter((item) => item.risk_count > 0),
    top_document_offices: [...offices]
      .sort((left, right) => right.total_documents - left.total_documents)
      .slice(0, 5),
  };
}

function buildRiskQueue({
  dueSoonDocuments,
  overdueDocuments,
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
      key: "overdue_documents",
      label: "Dokumen melewati jatuh tempo",
      total: overdueDocuments,
      severity: "critical",
      report_key: "due_dates",
      endpoint: "/api/digital-archives/reports/due-dates",
      query: {
        due_status: "OVERDUE",
      },
    },
    {
      key: "due_soon_documents",
      label: "Dokumen jatuh tempo 30 hari",
      total: dueSoonDocuments,
      severity: dueSoonDocuments > 0 ? "warning" : "normal",
      report_key: "due_dates",
      endpoint: "/api/digital-archives/reports/due-dates",
      query: {
        has_due_date: "true",
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
      key: "overdue_loans",
      label: "Peminjaman terlambat kembali",
      total: overdueLoans,
      severity: overdueLoans > 0 ? "critical" : "normal",
      report_key: "overdue_loans",
      endpoint: "/api/digital-archives/reports/overdue",
      query: {
        report: "overdue",
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

function buildQuickReports() {
  return [
    {
      key: "documents",
      label: "Inventaris Dokumen",
      description: "Daftar dokumen, pemilik, jenis, lokasi, dan status akses.",
      endpoint: "/api/digital-archives/reports/documents",
      menu_url: "/dashboard/arsip-digital/ruang-arsip/list-dokumen",
    },
    {
      key: "storage",
      label: "Kesehatan Ruang Arsip",
      description: "Sebaran dokumen per kantor, kabinet, dan rak.",
      endpoint: "/api/digital-archives/reports/storage",
      menu_url: "/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan",
    },
    {
      key: "due_dates",
      label: "Jatuh Tempo Dokumen",
      description: "Dokumen yang perlu ditindaklanjuti berdasarkan due date.",
      endpoint: "/api/digital-archives/reports/due-dates",
      menu_url: "/dashboard/arsip-digital/ruang-arsip/jatuh-tempo",
    },
    {
      key: "access_requests",
      label: "Disposisi Arsip",
      description: "Monitoring pengajuan, approval, dan penolakan akses.",
      endpoint: "/api/digital-archives/reports/access-requests",
      menu_url: "/dashboard/arsip-digital/disposisi/historis",
    },
    {
      key: "loans",
      label: "Peminjaman Fisik",
      description: "Monitoring request, approval, serah terima, dan kembali.",
      endpoint: "/api/digital-archives/reports/loans",
      menu_url: "/dashboard/arsip-digital/peminjaman/laporan",
    },
  ];
}

function mapGroupedCount(rows, lookup, idField, fallbackLabel) {
  return rows
    .map((row) => {
      const id = row[idField] || null;
      const item = id ? lookup.get(id) : null;

      return {
        id,
        code: item?.code || null,
        name: item?.name || fallbackLabel,
        total: row._count?._all || 0,
      };
    })
    .sort((left, right) => right.total - left.total);
}

async function buildDocumentBreakdowns(documentWhere) {
  const [typeGroups, divisionGroups, accessLevelGroups] = await Promise.all([
    prisma.digital_documents.groupBy({
      by: ["document_type_id"],
      where: documentWhere,
      _count: {
        _all: true,
      },
    }),
    prisma.digital_documents.groupBy({
      by: ["owner_division_id"],
      where: documentWhere,
      _count: {
        _all: true,
      },
    }),
    prisma.digital_documents.groupBy({
      by: ["access_level"],
      where: documentWhere,
      _count: {
        _all: true,
      },
    }),
  ]);

  const [documentTypes, divisions] = await Promise.all([
    prisma.document_types.findMany({
      where: {
        id: {
          in: typeGroups.map((item) => item.document_type_id).filter(Boolean),
        },
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
    }),
    prisma.divisions.findMany({
      where: {
        id: {
          in: divisionGroups
            .map((item) => item.owner_division_id)
            .filter(Boolean),
        },
      },
      select: {
        id: true,
        name: true,
      },
    }),
  ]);

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
  const scope = scopeOverride || (await getDigitalArchiveAccessScope(userId));
  const data = await loadStorageSummaryData(scope);
  return buildStorageSummaryResponse(data);
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
    prisma.digital_documents.count({
      where: andWhere(
        {
          deleted_at: null,
        },
        visibilityWhere,
        extraWhere,
      ),
    });
  const accessCount = (status) =>
    prisma.digital_document_access_requests.count({
      where: {
        status,
        document: documentWhere,
      },
    });
  const loanCount = (status) =>
    prisma.digital_document_loans.count({
      where: {
        status,
        document: documentWhere,
      },
    });

  const [
    totalDocuments,
    restrictedDocuments,
    debtorDocuments,
    dueSoonDocuments,
    overdueDocuments,
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
    storageSummary,
    documentBreakdowns,
  ] = await Promise.all([
    documentCount(),
    documentCount({ is_restricted: true }),
    documentCount({
      debtor_id: {
        not: null,
      },
    }),
    documentCount({
      due_date: {
        gte: now,
        lte: nextThirtyDays,
      },
    }),
    documentCount({
      due_date: {
        lt: now,
      },
    }),
    accessCount("PENDING"),
    accessCount("APPROVED"),
    accessCount("REJECTED"),
    loanCount("PENDING"),
    loanCount("APPROVED"),
    loanCount("HANDED_OVER"),
    loanCount("BORROWED"),
    loanCount("RETURNED"),
    loanCount("REJECTED"),
    prisma.digital_document_loans.count({
      where: {
        status: {
          in: ["HANDED_OVER", "BORROWED"],
        },
        requested_due_date: {
          lt: now,
        },
        document: documentWhere,
      },
    }),
    exports.getStorageSummary({ userId, scopeOverride: scope }),
    buildDocumentBreakdowns(documentWhere),
  ]);
  const storageHealth = buildStorageHealth(storageSummary);
  const activeLoans = handedOverLoans + borrowedLoans;

  return {
    version: "digital_archive_report.v2",
    generated_at: now.toISOString(),
    scope: {
      user_id: scope.userId,
      role_name: scope.roleName,
      division_id: scope.divisionId,
      division_name: scope.divisionName,
      can_view_division_documents: scope.canAccessDivisionDocuments,
      can_view_all_documents: scope.canAccessRestricted,
      can_report_all: Boolean(scope.canReportAll),
    },
    overview: {
      total_documents: totalDocuments,
      restricted_documents: restrictedDocuments,
      non_restricted_documents: totalDocuments - restrictedDocuments,
      linked_to_debtor_documents: debtorDocuments,
      due_soon_documents: dueSoonDocuments,
      overdue_documents: overdueDocuments,
      pending_access_requests: pendingAccessRequests,
      pending_loans: pendingLoans,
      active_loans: activeLoans,
      overdue_loans: overdueLoans,
      total_racks: storageHealth.total_racks,
      used_racks: storageHealth.used_racks,
      rack_utilization_percent: storageHealth.utilization_percent,
      capacity_usage_percent: storageHealth.capacity_usage_percent,
    },
    documents: {
      total: totalDocuments,
      restricted: restrictedDocuments,
      non_restricted: totalDocuments - restrictedDocuments,
      linked_to_debtor: debtorDocuments,
      due_soon: dueSoonDocuments,
      overdue: overdueDocuments,
    },
    access_requests: {
      pending: pendingAccessRequests,
      approved: approvedAccessRequests,
      rejected: rejectedAccessRequests,
    },
    loans: {
      pending: pendingLoans,
      approved: approvedLoans,
      handed_over: handedOverLoans,
      borrowed: borrowedLoans,
      returned: returnedLoans,
      rejected: rejectedLoans,
      overdue: overdueLoans,
    },
    storage: {
      offices: storageSummary.offices.length,
      cabinets: storageSummary.cabinets.length,
      racks: storageSummary.racks.length,
      used_racks: storageSummary.racks.filter(
        (item) => item.total_documents > 0,
      ).length,
      utilization_percent: storageHealth.utilization_percent,
      capacity_usage_percent: storageHealth.capacity_usage_percent,
    },
    storage_health: storageHealth,
    risk_queue: buildRiskQueue({
      dueSoonDocuments,
      overdueDocuments,
      pendingAccessRequests,
      pendingLoans,
      approvedLoans,
      handedOverLoans,
      borrowedLoans,
      overdueLoans,
    }),
    workflow: buildWorkflowSummary({
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
    }),
    breakdowns: documentBreakdowns,
    quick_reports: buildQuickReports(),
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

exports.getStorageReport = async ({ userId }) => {
  const scope = await getDigitalArchiveReportScope(userId);
  return exports.getStorageSummary({ userId, scopeOverride: scope });
};

exports.getDueDateReport = async ({ req, query, userId }) => {
  const scope = await getDigitalArchiveReportScope(userId);

  return digitalDocumentService.getAll({
    req,
    query: {
      ...query,
      has_due_date: query.has_due_date || "true",
    },
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

  if (String(query.limit || "").toLowerCase() === "all") {
    const data = await prisma.digital_document_activity_logs.findMany({
      where,
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

    return {
      data: data.map(serializeDigitalDocumentActivityLog),
    };
  }

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
  const scope = await getDigitalArchiveReportScope(userId);

  return loanService.getAll({
    req,
    query,
    userId,
    scopeOverride: scope,
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
