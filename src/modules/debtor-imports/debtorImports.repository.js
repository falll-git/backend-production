const prisma = require("../../config/prisma");

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
    include: {
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
      debtor: {
        select: {
          id: true,
          debtor_number: true,
          identity_number: true,
          name: true,
        },
      },
      contract: {
        select: {
          id: true,
          debtor_id: true,
          no_kontrak: true,
          status: true,
        },
      },
      files: {
        orderBy: {
          part_number: "asc",
        },
      },
    },
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
    include: {
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
      debtor: {
        select: {
          id: true,
          debtor_number: true,
          identity_number: true,
          name: true,
        },
      },
      contract: {
        select: {
          id: true,
          debtor_id: true,
          no_kontrak: true,
          status: true,
        },
      },
      files: {
        orderBy: {
          part_number: "asc",
        },
      },
    },
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

function findIdebUploadById(id, db = prisma) {
  return db.debtor_ideb_uploads.findFirst({
    where: {
      id,
      deleted_at: null,
    },
    include: {
      import_job: {
        include: {
          records: {
            where: {
              deleted_at: null,
              source_type: "IDEB",
            },
          },
        },
      },
      debtor: {
        select: {
          id: true,
          debtor_number: true,
          identity_number: true,
          name: true,
        },
      },
      contract: {
        select: {
          id: true,
          debtor_id: true,
          no_kontrak: true,
          status: true,
        },
      },
      files: {
        orderBy: {
          part_number: "asc",
        },
      },
    },
  });
}

function transaction(callback, options) {
  return prisma.$transaction(callback, options);
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
