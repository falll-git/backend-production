const prisma = require("../../config/prisma");
const { USER_SELECT } = require("../debtors/debtors.repository");

const CONTRACT_INCLUDE = {
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
};

function findMany({ where, skip, take, orderBy }) {
  return prisma.debtor_contracts.findMany({
    where,
    skip,
    take,
    orderBy,
    include: CONTRACT_INCLUDE,
  });
}

function count(where) {
  return prisma.debtor_contracts.count({ where });
}

function findById(id, where = {}) {
  return prisma.debtor_contracts.findFirst({
    where: {
      id,
      ...where,
    },
    include: CONTRACT_INCLUDE,
  });
}

function create(data) {
  return prisma.debtor_contracts.create({
    data,
    include: CONTRACT_INCLUDE,
  });
}

function update(id, data) {
  return prisma.debtor_contracts.update({
    where: { id },
    data,
    include: CONTRACT_INCLUDE,
  });
}

function findDebtorById(id) {
  return prisma.digital_debtors.findFirst({
    where: {
      id,
      deleted_at: null,
    },
  });
}

function findDebtorByIdWithWhere(id, where = {}) {
  return prisma.digital_debtors.findFirst({
    where: {
      id,
      deleted_at: null,
      ...where,
    },
  });
}

function findProductById(id) {
  return prisma.financing_products.findFirst({
    where: {
      id,
      is_active: true,
      deleted_at: null,
    },
  });
}

function findContractTypeById(id) {
  return prisma.contract_types.findFirst({
    where: {
      id,
      is_active: true,
      deleted_at: null,
    },
  });
}

function findBranchById(id) {
  return prisma.branches.findFirst({
    where: {
      id,
      is_active: true,
      deleted_at: null,
    },
  });
}

function findActiveUserById(id) {
  return prisma.users.findFirst({
    where: {
      id,
      is_active: true,
    },
  });
}

module.exports = {
  count,
  create,
  findActiveUserById,
  findBranchById,
  findById,
  findContractTypeById,
  findDebtorById,
  findDebtorByIdWithWhere,
  findMany,
  findProductById,
  update,
};
