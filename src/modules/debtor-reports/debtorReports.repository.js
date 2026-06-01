const prisma = require("../../config/prisma");

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
