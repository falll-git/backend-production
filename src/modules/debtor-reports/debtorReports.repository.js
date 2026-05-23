const prisma = require("../../config/prisma");

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

exports.groupMarketingActivities = ({ fromDate, toDate, debtorWhere = {} } = {}) =>
  prisma.debtor_marketing_activities.groupBy({
    by: ["activity_kind", "status"],
    where: {
      deleted_at: null,
      ...(fromDate || toDate
        ? {
            activity_date: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
      ...(Object.keys(debtorWhere).length > 0
        ? { debtor: debtorWhere }
        : {}),
    },
    _count: {
      id: true,
    },
  });

exports.findRecentMarketingActivities = ({ fromDate, toDate, debtorWhere = {} } = {}) =>
  prisma.debtor_marketing_activities.findMany({
    where: {
      deleted_at: null,
      ...(fromDate || toDate
        ? {
            activity_date: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
      ...(Object.keys(debtorWhere).length > 0
        ? { debtor: debtorWhere }
        : {}),
    },
    take: 20,
    orderBy: {
      created_at: "desc",
    },
    include: {
      debtor: {
        select: {
          id: true,
          name: true,
          debtor_number: true,
        },
      },
      contract: {
        select: {
          id: true,
          no_kontrak: true,
        },
      },
    },
  });
