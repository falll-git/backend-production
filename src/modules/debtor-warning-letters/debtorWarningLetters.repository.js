const prisma = require("../../config/prisma");

const INCLUDE = {
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
      no_kontrak: true,
      status: true,
    },
  },
};

exports.findMany = ({ where, skip, take, orderBy }) =>
  prisma.debtor_warning_letters.findMany({
    where,
    skip,
    take,
    orderBy,
    include: INCLUDE,
  });

exports.count = (where) => prisma.debtor_warning_letters.count({ where });

exports.findById = (id, where = {}) =>
  prisma.debtor_warning_letters.findFirst({
    where: { id, ...where },
    include: INCLUDE,
  });

exports.create = (data) =>
  prisma.debtor_warning_letters.create({ data, include: INCLUDE });

exports.update = (id, data) =>
  prisma.debtor_warning_letters.update({
    where: { id },
    data,
    include: INCLUDE,
  });

exports.findDebtorById = (id) =>
  prisma.digital_debtors.findFirst({ where: { id, deleted_at: null } });

exports.findContractById = (id) =>
  prisma.debtor_contracts.findFirst({ where: { id, deleted_at: null } });
