const prisma = require("../../config/prisma");

const USER_SELECT = {
  id: true,
  name: true,
  username: true,
  email: true,
  division_id: true,
};

const DEBTOR_INCLUDE = {
  branch: true,
  marketing_user: {
    select: USER_SELECT,
  },
  contracts: {
    where: {
      deleted_at: null,
    },
    orderBy: {
      created_at: "desc",
    },
    take: 5,
    include: {
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
        take: 1,
        include: {
          kol_level: true,
        },
      },
    },
  },
  documents: {
    where: {
      deleted_at: null,
    },
    take: 5,
    orderBy: {
      created_at: "desc",
    },
  },
};

function findMany({ where, skip, take, orderBy }) {
  return prisma.digital_debtors.findMany({
    where,
    skip,
    take,
    orderBy,
    include: DEBTOR_INCLUDE,
  });
}

function count(where) {
  return prisma.digital_debtors.count({ where });
}

function findById(id, where = {}) {
  return prisma.digital_debtors.findFirst({
    where: {
      id,
      ...where,
    },
    include: {
      ...DEBTOR_INCLUDE,
      contracts: {
        where: {
          deleted_at: null,
        },
        orderBy: {
          created_at: "desc",
        },
        include: {
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
            include: {
              kol_level: true,
            },
          },
        },
      },
      debtor_documents: {
        where: {
          deleted_at: null,
        },
        orderBy: {
          created_at: "desc",
        },
        include: {
          document_checklist: true,
          contract: {
            select: {
              id: true,
              no_kontrak: true,
            },
          },
        },
      },
    },
  });
}

function create(data) {
  return prisma.digital_debtors.create({
    data,
    include: DEBTOR_INCLUDE,
  });
}

function update(id, data) {
  return prisma.digital_debtors.update({
    where: { id },
    data,
    include: DEBTOR_INCLUDE,
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
    select: USER_SELECT,
  });
}

function findDocumentChecklistById(id) {
  return prisma.document_checklists.findFirst({
    where: {
      id,
      is_active: true,
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

function findDocumentsByDebtorId(debtorId, { where, skip, take, orderBy }) {
  return prisma.debtor_documents.findMany({
    where: {
      debtor_id: debtorId,
      deleted_at: null,
      ...where,
    },
    skip,
    take,
    orderBy,
    include: {
      document_checklist: true,
      contract: {
        select: {
          id: true,
          no_kontrak: true,
        },
      },
    },
  });
}

function countDocumentsByDebtorId(debtorId, where = {}) {
  return prisma.debtor_documents.count({
    where: {
      debtor_id: debtorId,
      deleted_at: null,
      ...where,
    },
  });
}

function createDocument(data) {
  return prisma.debtor_documents.create({
    data,
    include: {
      document_checklist: true,
      contract: {
        select: {
          id: true,
          no_kontrak: true,
        },
      },
    },
  });
}

module.exports = {
  USER_SELECT,
  count,
  countDocumentsByDebtorId,
  create,
  createDocument,
  findActiveUserById,
  findBranchById,
  findById,
  findContractById,
  findDocumentChecklistById,
  findDocumentsByDebtorId,
  findMany,
  update,
};
