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

function findContractById(id) {
  return prisma.debtor_contracts.findFirst({
    where: {
      id,
      deleted_at: null,
    },
  });
}

function transaction(callback) {
  return prisma.$transaction(callback);
}

module.exports = {
  countJobs,
  createExternalRecord,
  createJob,
  findContractById,
  findDebtorById,
  findJobs,
  transaction,
};
