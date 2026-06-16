const prisma = require("../../config/prisma");

const USER_SELECT = {
  id: true,
  name: true,
  username: true,
  email: true,
  division_id: true,
  division: {
    select: {
      id: true,
      name: true,
    },
  },
};

const DEBTOR_REPORT_INCLUDE = {
  branch: true,
  marketing_user: {
    select: USER_SELECT,
  },
  individual_profile: true,
  legal_entity_profile: true,
  contracts: {
    where: {
      deleted_at: null,
    },
    orderBy: {
      created_at: "desc",
    },
    take: 5,
    include: {
      product: true,
      akad_type: true,
      branch: true,
      marketing_user: {
        select: USER_SELECT,
      },
      collectibilities: {
        where: {
          deleted_at: null,
        },
        orderBy: {
          period_month: "desc",
        },
        take: 1,
        include: {
          kol_level: true,
        },
      },
      slik_snapshots: {
        where: {
          deleted_at: null,
        },
        orderBy: {
          period_month: "desc",
        },
        take: 3,
      },
    },
  },
  debtor_documents: {
    where: {
      deleted_at: null,
    },
    take: 5,
  },
};

const CONTRACT_REPORT_INCLUDE = {
  debtor: {
    include: {
      branch: true,
      marketing_user: {
        select: USER_SELECT,
      },
    },
  },
  product: true,
  akad_type: true,
  branch: true,
  marketing_user: {
    select: USER_SELECT,
  },
  collectibilities: {
    where: {
      deleted_at: null,
    },
    orderBy: {
      period_month: "desc",
    },
    take: 12,
    include: {
      kol_level: true,
    },
  },
  slik_snapshots: {
    where: {
      deleted_at: null,
    },
    orderBy: {
      period_month: "desc",
    },
    take: 3,
  },
};

function buildMarketingWhere({
  fromDate,
  toDate,
  debtorWhere = {},
  activityKind = null,
  status = null,
  search = null,
} = {}) {
  const where = {
    deleted_at: null,
    ...(activityKind ? { activity_kind: activityKind } : {}),
    ...(status ? { status } : {}),
    ...(fromDate || toDate
      ? {
          activity_date: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {}),
          },
        }
      : {}),
    ...(Object.keys(debtorWhere).length > 0 ? { debtor: debtorWhere } : {}),
  };

  if (search) {
    where.OR = [
      { action_plan: { contains: search, mode: "insensitive" } },
      { visit_address: { contains: search, mode: "insensitive" } },
      { visit_result: { contains: search, mode: "insensitive" } },
      { conclusion: { contains: search, mode: "insensitive" } },
      { handling_step: { contains: search, mode: "insensitive" } },
      { handling_result: { contains: search, mode: "insensitive" } },
      { notes: { contains: search, mode: "insensitive" } },
      { debtor: { name: { contains: search, mode: "insensitive" } } },
      { debtor: { debtor_number: { contains: search, mode: "insensitive" } } },
      { contract: { no_kontrak: { contains: search, mode: "insensitive" } } },
    ];
  }

  return where;
}

exports.countDebtors = (where = {}) => prisma.digital_debtors.count({ where });

exports.countContracts = (where = {}) => prisma.debtor_contracts.count({ where });

exports.findPortfolioRows = ({ where, skip, take, orderBy }) =>
  prisma.digital_debtors.findMany({
    where,
    skip,
    take,
    orderBy,
    include: DEBTOR_REPORT_INCLUDE,
  });

exports.findPortfolioAggregateRows = (where = {}) =>
  prisma.digital_debtors.findMany({
    where,
    select: {
      id: true,
      status: true,
      customer_type: true,
    },
  });

exports.findDebtorsWithoutFacilities = (where = {}) =>
  prisma.digital_debtors.findMany({
    where: {
      AND: [
        where,
        {
          contracts: {
            none: {
              deleted_at: null,
            },
          },
        },
      ],
    },
    orderBy: {
      created_at: "desc",
    },
    include: DEBTOR_REPORT_INCLUDE,
  });

exports.findDebtorsForCompletenessAudit = (where = {}) =>
  prisma.digital_debtors.findMany({
    where,
    orderBy: {
      created_at: "desc",
    },
    include: {
      branch: true,
      marketing_user: {
        select: USER_SELECT,
      },
      individual_profile: true,
      legal_entity_profile: true,
    },
  });

exports.findDebtorListAggregates = async (debtorIds = []) => {
  const ids = [...new Set(debtorIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const aggregates = new Map(
    ids.map((id) => [
      id,
      {
        contracts_count: 0,
        collaterals_count: 0,
        documents_count: 0,
        total_outstanding: 0,
        latest_slik_period_month: null,
        latest_collectibility_code: null,
      },
    ]),
  );
  const [contractGroups, collateralGroups, documentGroups, latestSnapshots] =
    await Promise.all([
      prisma.debtor_contracts.groupBy({
        by: ["debtor_id"],
        where: {
          debtor_id: { in: ids },
          deleted_at: null,
        },
        _count: {
          _all: true,
        },
        _sum: {
          outstanding_pokok: true,
          outstanding_margin: true,
        },
      }),
      prisma.debtor_collaterals.groupBy({
        by: ["debtor_id"],
        where: {
          debtor_id: { in: ids },
          deleted_at: null,
        },
        _count: {
          _all: true,
        },
      }),
      prisma.debtor_documents.groupBy({
        by: ["debtor_id"],
        where: {
          debtor_id: { in: ids },
          deleted_at: null,
        },
        _count: {
          _all: true,
        },
      }),
      prisma.debtor_contract_slik_snapshots.findMany({
        where: {
          debtor_id: { in: ids },
          deleted_at: null,
        },
        orderBy: [{ period_month: "desc" }, { updated_at: "desc" }],
        select: {
          debtor_id: true,
          period_month: true,
          collectibility_code: true,
        },
      }),
    ]);

  for (const group of contractGroups) {
    const current = aggregates.get(group.debtor_id);
    if (!current) continue;
    current.contracts_count = group._count?._all || 0;
    current.total_outstanding =
      Number(group._sum?.outstanding_pokok || 0) +
      Number(group._sum?.outstanding_margin || 0);
  }

  for (const group of collateralGroups) {
    const current = aggregates.get(group.debtor_id);
    if (current) current.collaterals_count = group._count?._all || 0;
  }

  for (const group of documentGroups) {
    const current = aggregates.get(group.debtor_id);
    if (current) current.documents_count = group._count?._all || 0;
  }

  for (const snapshot of latestSnapshots) {
    const current = aggregates.get(snapshot.debtor_id);
    if (!current || current.latest_slik_period_month) continue;
    current.latest_slik_period_month = snapshot.period_month;
    current.latest_collectibility_code = snapshot.collectibility_code;
  }

  return aggregates;
};

exports.countPortfolioRows = (where = {}) =>
  prisma.digital_debtors.count({ where });

exports.aggregateContractsForDebtors = (debtorWhere = {}) =>
  prisma.debtor_contracts.aggregate({
    where: {
      deleted_at: null,
      debtor: debtorWhere,
    },
    _count: {
      _all: true,
    },
    _sum: {
      outstanding_pokok: true,
      outstanding_margin: true,
    },
  });

exports.countCollateralsForDebtors = (debtorWhere = {}) =>
  prisma.debtor_collaterals.count({
    where: {
      deleted_at: null,
      debtor: debtorWhere,
    },
  });

exports.findFacilityRows = ({ where, skip, take, orderBy }) =>
  prisma.debtor_contracts.findMany({
    where,
    skip,
    take,
    orderBy,
    include: CONTRACT_REPORT_INCLUDE,
  });

exports.findContractsByFacilityNumbers = (facilityNumbers = [], extraWhere = {}) => {
  const values = [...new Set(facilityNumbers.filter(Boolean))];
  if (values.length === 0) return Promise.resolve([]);

  return prisma.debtor_contracts.findMany({
    where: {
      AND: [
        extraWhere,
        {
          deleted_at: null,
          OR: [
            { no_kontrak: { in: values } },
            {
              slik_snapshots: {
                some: {
                  deleted_at: null,
                  facility_number: { in: values },
                },
              },
            },
          ],
        },
      ],
    },
    include: CONTRACT_REPORT_INCLUDE,
  });
};

exports.countFacilityRows = (where = {}) =>
  prisma.debtor_contracts.count({ where });

exports.aggregateFacilityRows = (where = {}) =>
  prisma.debtor_contracts.aggregate({
    where,
    _count: {
      _all: true,
    },
    _sum: {
      plafond: true,
      outstanding_pokok: true,
      outstanding_margin: true,
    },
  });

exports.findFacilityCollectibilityRows = (where = {}) =>
  prisma.debtor_contracts.findMany({
    where,
    select: {
      id: true,
      collectibilities: {
        where: {
          deleted_at: null,
        },
        orderBy: {
          period_month: "desc",
        },
        take: 1,
        include: {
          kol_level: true,
        },
      },
    },
  });

exports.findFacilitiesWithoutCollaterals = (where = {}) =>
  prisma.debtor_contracts.findMany({
    where: {
      AND: [
        where,
        {
          collaterals: {
            none: {
              deleted_at: null,
            },
          },
        },
      ],
    },
    orderBy: {
      created_at: "desc",
    },
    include: CONTRACT_REPORT_INCLUDE,
  });

exports.findCollateralsByFacilityNumbers = (facilityNumbers = [], extraWhere = {}) => {
  const values = [...new Set(facilityNumbers.filter(Boolean))];
  if (values.length === 0) return Promise.resolve([]);

  return prisma.debtor_collaterals.findMany({
    where: {
      AND: [
        extraWhere,
        {
          deleted_at: null,
          facility_number: { in: values },
        },
      ],
    },
    select: {
      id: true,
      facility_number: true,
      debtor_id: true,
      contract_id: true,
      collateral_number: true,
    },
  });
};

exports.findFacilitiesWithoutSlikPeriod = (where = {}) =>
  prisma.debtor_contracts.findMany({
    where: {
      AND: [
        where,
        {
          slik_snapshots: {
            none: {
              deleted_at: null,
            },
          },
          collectibilities: {
            none: {
              deleted_at: null,
            },
          },
        },
      ],
    },
    orderBy: {
      created_at: "desc",
    },
    include: CONTRACT_REPORT_INCLUDE,
  });

exports.findCollateralRows = ({ where, skip, take, orderBy }) =>
  prisma.debtor_collaterals.findMany({
    where,
    skip,
    take,
    orderBy,
    include: {
      debtor: {
        include: {
          branch: true,
          marketing_user: {
            select: USER_SELECT,
          },
        },
      },
      contract: {
        include: {
          debtor: {
            select: {
              id: true,
              debtor_number: true,
              identity_number: true,
              name: true,
              address: true,
              phone: true,
              branch: true,
              marketing_user: {
                select: USER_SELECT,
              },
            },
          },
        },
      },
    },
  });

exports.countCollateralRows = (where = {}) =>
  prisma.debtor_collaterals.count({ where });

exports.aggregateCollateralRows = (where = {}) =>
  prisma.debtor_collaterals.aggregate({
    where,
    _count: {
      _all: true,
    },
    _sum: {
      market_value: true,
      appraisal_value: true,
    },
  });

exports.countLinkedCollateralRows = (baseWhere = {}) =>
  prisma.debtor_collaterals.count({
    where: {
      AND: [
        baseWhere,
        {
          OR: [{ debtor_id: { not: null } }, { contract_id: { not: null } }],
        },
      ],
    },
  });

exports.countUnlinkedCollateralRows = (baseWhere = {}) =>
  prisma.debtor_collaterals.count({
    where: {
      AND: [
        baseWhere,
        {
          debtor_id: null,
          contract_id: null,
        },
      ],
    },
  });

exports.findUnlinkedCollaterals = (where = {}) =>
  prisma.debtor_collaterals.findMany({
    where: {
      AND: [
        where,
        {
          debtor_id: null,
          contract_id: null,
        },
      ],
    },
    orderBy: {
      created_at: "desc",
    },
    include: {
      debtor: {
        include: {
          branch: true,
          marketing_user: {
            select: USER_SELECT,
          },
        },
      },
      contract: {
        include: {
          debtor: {
            select: {
              id: true,
              debtor_number: true,
              identity_number: true,
              name: true,
              address: true,
              phone: true,
              branch: true,
              marketing_user: {
                select: USER_SELECT,
              },
            },
          },
        },
      },
    },
  });

exports.findContractsForNpf = (extraWhere = {}) =>
  prisma.debtor_contracts.findMany({
    where: {
      deleted_at: null,
      status: {
        in: ["ACTIVE", "AKTIF", "BERJALAN"],
      },
      ...extraWhere,
    },
    include: {
      debtor: {
        select: {
          id: true,
          name: true,
          debtor_number: true,
        },
      },
      collectibilities: {
        where: {
          deleted_at: null,
        },
        orderBy: {
          period_month: "desc",
        },
        take: 1,
        include: {
          kol_level: true,
        },
      },
    },
  });

exports.findCollectibilityTrendRows = ({ from, to, contractWhere = {} } = {}) =>
  prisma.debtor_collectibilities.findMany({
    where: {
      deleted_at: null,
      ...(from || to
        ? {
            period_month: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      contract: {
        deleted_at: null,
        status: {
          in: ["ACTIVE", "AKTIF", "BERJALAN"],
        },
        ...contractWhere,
      },
    },
    include: {
      kol_level: true,
    },
    orderBy: {
      period_month: "asc",
    },
  });

exports.groupMarketingActivities = (params = {}) =>
  prisma.debtor_marketing_activities.groupBy({
    by: ["activity_kind", "status"],
    where: buildMarketingWhere(params),
    _count: {
      id: true,
    },
  });

exports.findRecentMarketingActivities = (params = {}) =>
  prisma.debtor_marketing_activities.findMany({
    where: buildMarketingWhere(params),
    take: params.limit || 20,
    orderBy: {
      activity_date: params.sort === "oldest" ? "asc" : "desc",
    },
    include: {
      debtor: {
        select: {
          id: true,
          name: true,
          debtor_number: true,
          identity_number: true,
        },
      },
      contract: {
        select: {
          id: true,
          no_kontrak: true,
          status: true,
        },
      },
    },
  });
