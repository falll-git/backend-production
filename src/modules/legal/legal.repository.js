const prisma = require("../../config/prisma");

const CONTRACT_SELECT = {
  id: true,
  no_kontrak: true,
  status: true,
  debtor: {
    select: {
      id: true,
      debtor_number: true,
      identity_number: true,
      name: true,
    },
  },
};

const THIRD_PARTY_SELECT = {
  id: true,
  code: true,
  name: true,
  category: true,
  phone: true,
  email: true,
  contact_person: true,
};

function client(tx) {
  return tx || prisma;
}

exports.transaction = (callback) => prisma.$transaction(callback);

exports.findContractById = (id, tx, extraWhere = {}) =>
  client(tx).debtor_contracts.findFirst({
    where: {
      id,
      deleted_at: null,
      ...extraWhere,
    },
    include: {
      debtor: true,
      product: true,
      akad_type: true,
    },
  });

exports.findDebtorById = (id, tx, extraWhere = {}) =>
  client(tx).digital_debtors.findFirst({
    where: {
      id,
      deleted_at: null,
      ...extraWhere,
    },
  });

exports.findThirdPartyById = (id, tx) =>
  client(tx).third_parties.findFirst({
    where: {
      id,
      is_active: true,
      deleted_at: null,
    },
  });

exports.findDepositTypeById = (id, tx) =>
  client(tx).deposit_types.findFirst({
    where: {
      id,
      is_active: true,
      deleted_at: null,
    },
  });

exports.findLegalProcessType = ({ value, category }, tx) =>
  client(tx).legal_process_types.findFirst({
    where: {
      category,
      is_active: true,
      deleted_at: null,
      OR: [
        { code: String(value || "").trim().toUpperCase() },
        { name: { equals: String(value || "").trim(), mode: "insensitive" } },
      ],
    },
  });

exports.findThirdPartiesByIds = (ids, tx) =>
  client(tx).third_parties.findMany({
    where: {
      id: { in: ids },
      deleted_at: null,
    },
    select: THIRD_PARTY_SELECT,
  });

exports.findTemplateById = (id, tx) =>
  client(tx).legal_document_templates.findFirst({
    where: {
      id,
      deleted_at: null,
    },
  });

exports.findNumberingTemplateById = (id, tx) =>
  client(tx).numbering_templates.findFirst({
    where: {
      id,
      deleted_at: null,
    },
  });

exports.findActiveNumberingTemplate = (documentType, tx) =>
  client(tx).numbering_templates.findFirst({
    where: {
      module: "LEGAL",
      document_type: documentType,
      is_active: true,
      deleted_at: null,
    },
    orderBy: {
      created_at: "desc",
    },
  });

exports.updateNumberingTemplate = (id, data, tx) =>
  client(tx).numbering_templates.update({
    where: { id },
    data,
  });

function includeFor(modelName) {
  switch (modelName) {
    case "legal_print_histories":
      return {
        template: true,
        numbering_template: true,
        contract: {
          select: CONTRACT_SELECT,
        },
      };
    case "legal_notary_progress":
    case "legal_insurance_progress":
    case "legal_kjpp_progress":
      return {
        contract: {
          select: CONTRACT_SELECT,
        },
        third_party: {
          select: THIRD_PARTY_SELECT,
        },
      };
    case "legal_claims":
      return {
        contract: {
          select: CONTRACT_SELECT,
        },
        insurance_progress: {
          include: {
            third_party: {
              select: THIRD_PARTY_SELECT,
            },
          },
        },
      };
    case "legal_deposits":
      return {
        deposit_type: true,
        contract: {
          select: CONTRACT_SELECT,
        },
        third_party: {
          select: THIRD_PARTY_SELECT,
        },
        transactions: {
          orderBy: {
            transaction_date: "desc",
          },
          take: 10,
        },
      };
    case "legal_deposit_transactions":
      return {
        deposit: {
          include: {
            contract: {
              select: CONTRACT_SELECT,
            },
            third_party: {
              select: THIRD_PARTY_SELECT,
            },
          },
        },
      };
    default:
      return undefined;
  }
}

exports.findMany = (modelName, { where, skip, take, orderBy }, tx) =>
  client(tx)[modelName].findMany({
    where,
    skip,
    take,
    orderBy,
    ...(includeFor(modelName) ? { include: includeFor(modelName) } : {}),
  });

exports.count = (modelName, where, tx) => client(tx)[modelName].count({ where });

exports.findById = (modelName, id, where = {}, tx) =>
  client(tx)[modelName].findFirst({
    where: {
      id,
      ...where,
    },
    ...(includeFor(modelName) ? { include: includeFor(modelName) } : {}),
  });

exports.create = (modelName, data, tx) =>
  client(tx)[modelName].create({
    data,
    ...(includeFor(modelName) ? { include: includeFor(modelName) } : {}),
  });

exports.update = (modelName, id, data, tx) =>
  client(tx)[modelName].update({
    where: { id },
    data,
    ...(includeFor(modelName) ? { include: includeFor(modelName) } : {}),
  });

exports.group = (modelName, args) => prisma[modelName].groupBy(args);

exports.aggregateDeposits = (where = { deleted_at: null }) =>
  prisma.legal_deposits.groupBy({
    by: ["type", "status"],
    where,
    _sum: {
      nominal: true,
      paid_amount: true,
      processed_amount: true,
      remaining_amount: true,
    },
    _count: {
      id: true,
    },
  });

exports.countWhere = (modelName, where) => prisma[modelName].count({ where });
