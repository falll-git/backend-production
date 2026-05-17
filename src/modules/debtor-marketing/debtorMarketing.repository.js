const prisma = require("../../config/prisma");

const INCLUDE = {
  debtor: {
    select: {
      id: true,
      debtor_number: true,
      identity_number: true,
      name: true,
      status: true,
    },
  },
  contract: {
    select: {
      id: true,
      no_kontrak: true,
      status: true,
    },
  },
  activity_type: true,
};

function findMany({ where, skip, take, orderBy }) {
  return prisma.debtor_marketing_activities.findMany({
    where,
    skip,
    take,
    orderBy,
    include: INCLUDE,
  });
}

function count(where) {
  return prisma.debtor_marketing_activities.count({ where });
}

function findById(id, where = {}) {
  return prisma.debtor_marketing_activities.findFirst({
    where: {
      id,
      ...where,
    },
    include: INCLUDE,
  });
}

function create(data) {
  return prisma.debtor_marketing_activities.create({ data, include: INCLUDE });
}

function update(id, data) {
  return prisma.debtor_marketing_activities.update({
    where: { id },
    data,
    include: INCLUDE,
  });
}

function findDebtorById(id) {
  return prisma.digital_debtors.findFirst({ where: { id, deleted_at: null } });
}

function findContractById(id) {
  return prisma.debtor_contracts.findFirst({ where: { id, deleted_at: null } });
}

function findActivityTypeById(id) {
  return prisma.marketing_activity_types.findFirst({
    where: { id, is_active: true, deleted_at: null },
  });
}

module.exports = {
  count,
  create,
  findActivityTypeById,
  findById,
  findContractById,
  findDebtorById,
  findMany,
  update,
};
