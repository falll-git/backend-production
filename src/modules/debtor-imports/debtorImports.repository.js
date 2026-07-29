const prisma = require("../../config/prisma");
const { withDatabaseTransaction } = require("../../config/database-rls");

const IDEB_USER_SELECT = {
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

const IDEB_COLLATERAL_SELECT = {
  id: true,
  collateral_number: true,
  facility_number: true,
  collateral_type: true,
  owner_name: true,
  proof_number: true,
  address: true,
  market_value: true,
  appraisal_value: true,
  independent_appraisal_value: true,
  period_month: true,
  description: true,
};

function idebUploadInclude({ includeInternalCollaterals = false } = {}) {
  return {
    import_job: {
      include: {
        records: {
          where: {
            deleted_at: null,
            source_type: "IDEB",
          },
          orderBy: {
            created_at: "desc",
          },
        },
      },
    },
    uploader: {
      select: IDEB_USER_SELECT,
    },
    debtor: {
      select: {
        id: true,
        debtor_number: true,
        identity_number: true,
        name: true,
        ...(includeInternalCollaterals
          ? {
              collaterals: {
                where: { deleted_at: null },
                select: IDEB_COLLATERAL_SELECT,
                orderBy: [{ period_month: "desc" }, { created_at: "desc" }],
              },
            }
          : {}),
      },
    },
    contract: {
      select: {
        id: true,
        debtor_id: true,
        no_kontrak: true,
        status: true,
        ...(includeInternalCollaterals
          ? {
              collaterals: {
                where: { deleted_at: null },
                select: IDEB_COLLATERAL_SELECT,
                orderBy: [{ period_month: "desc" }, { created_at: "desc" }],
              },
            }
          : {}),
      },
    },
    files: {
      orderBy: {
        part_number: "asc",
      },
    },
  };
}

function findJobs({ where, skip, take, orderBy }) {
  return prisma.debtor_import_jobs.findMany({
    where,
    skip,
    take,
    orderBy,
    include: {
      records: {
        where: {
          deleted_at: null,
        },
        take: 10,
        orderBy: {
          created_at: "desc",
        },
      },
      segments: {
        orderBy: {
          file_name: "asc",
        },
      },
    },
  });
}

function findPendingIdebUploads({ where, skip, take, orderBy }) {
  return prisma.debtor_ideb_uploads.findMany({
    where,
    skip,
    take,
    orderBy,
    include: idebUploadInclude(),
  });
}

function countPendingIdebUploads(where) {
  return prisma.debtor_ideb_uploads.count({ where });
}

function findIdebReports({ where, skip, take, orderBy }) {
  return prisma.debtor_ideb_uploads.findMany({
    where,
    skip,
    take,
    orderBy,
    include: idebUploadInclude(),
  });
}

function countIdebReports(where) {
  return prisma.debtor_ideb_uploads.count({ where });
}

function countJobs(where) {
  return prisma.debtor_import_jobs.count({ where });
}

function createJob(data) {
  return prisma.debtor_import_jobs.create({
    data,
    include: {
      records: true,
    },
  });
}

function createExternalRecord(data) {
  return prisma.debtor_external_records.create({ data });
}

function findDebtorById(id) {
  return prisma.digital_debtors.findFirst({
    where: {
      id,
      deleted_at: null,
    },
  });
}

function findJobById(id) {
  return prisma.debtor_import_jobs.findFirst({
    where: {
      id,
      deleted_at: null,
    },
    include: {
      records: {
        where: {
          deleted_at: null,
        },
        take: 10,
        orderBy: {
          created_at: "desc",
        },
      },
      segments: {
        orderBy: {
          file_name: "asc",
        },
      },
    },
  });
}

function findContractById(id) {
  return prisma.debtor_contracts.findFirst({
    where: {
      id,
      deleted_at: null,
    },
  });
}

function findIdebUploadById(
  id,
  db = prisma,
  visibilityWhere = {},
  options = {},
) {
  return db.debtor_ideb_uploads.findFirst({
    where: {
      id,
      deleted_at: null,
      ...visibilityWhere,
    },
    include: idebUploadInclude(options),
  });
}

function transaction(callback, options) {
  return withDatabaseTransaction(callback, options);
}

module.exports = {
  countJobs,
  countIdebReports,
  countPendingIdebUploads,
  createExternalRecord,
  createJob,
  findContractById,
  findDebtorById,
  findJobById,
  findJobs,
  findIdebUploadById,
  findIdebReports,
  findPendingIdebUploads,
  prisma,
  transaction,
};
