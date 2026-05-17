const prisma = require("../../config/prisma");

exports.countDebtors = (where = {}) => prisma.digital_debtors.count({ where });

exports.countContracts = (where = {}) => prisma.debtor_contracts.count({ where });

exports.findContractsForNpf = () =>
  prisma.debtor_contracts.findMany({
    where: {
      deleted_at: null,
      status: {
        in: ["ACTIVE", "AKTIF", "BERJALAN"],
      },
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

exports.findCollectibilityTrendRows = ({ from, to } = {}) =>
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
      },
    },
    include: {
      kol_level: true,
    },
    orderBy: {
      period_month: "asc",
    },
  });

exports.groupMarketingActivities = ({ fromDate, toDate } = {}) =>
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
    },
    _count: {
      id: true,
    },
  });

exports.findRecentMarketingActivities = ({ fromDate, toDate } = {}) =>
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
