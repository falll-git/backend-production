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

function transaction(callback, options) {
  return prisma.$transaction(callback, options);
}

module.exports = {
  countJobs,
  createExternalRecord,
  createJob,
  findContractById,
  findDebtorById,
  findJobById,
  findJobs,
  prisma,
  transaction,
};
