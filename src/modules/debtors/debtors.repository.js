const prisma = require("../../config/prisma");

const USER_SELECT = {
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

const DEBTOR_INCLUDE = {
  branch: true,
  marketing_user: {
    select: USER_SELECT,
  },
  individual_profile: true,
  legal_entity_profile: true,
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
      slik_snapshots: {
        where: {
          deleted_at: null,
        },
        orderBy: {
          period_month: "desc",
        },
        take: 3,
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

function buildDefaultDebtorAggregate() {
  return {
    contracts_count: 0,
    collaterals_count: 0,
    documents_count: 0,
    digital_documents_count: 0,
    total_outstanding: 0,
    latest_slik_period_month: null,
    latest_collectibility_code: null,
  };
}

async function findListAggregates(debtorIds = []) {
  const ids = [...new Set(debtorIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const aggregates = new Map(ids.map((id) => [id, buildDefaultDebtorAggregate()]));
  const [
    contractGroups,
    collateralGroups,
    debtorDocumentGroups,
    digitalDocumentGroups,
    latestSnapshots,
  ] = await Promise.all([
    prisma.debtor_contracts.groupBy({
      by: ["debtor_id"],
      where: {
        debtor_id: { in: ids },
        deleted_at: null,
      },
      _count: {
        _all: true,
      },
      _sum: {
        outstanding_pokok: true,
        outstanding_margin: true,
      },
    }),
    prisma.debtor_collaterals.groupBy({
      by: ["debtor_id"],
      where: {
        debtor_id: { in: ids },
        deleted_at: null,
      },
      _count: {
        _all: true,
      },
    }),
    prisma.debtor_documents.groupBy({
      by: ["debtor_id"],
      where: {
        debtor_id: { in: ids },
        deleted_at: null,
      },
      _count: {
        _all: true,
      },
    }),
    prisma.digital_documents.groupBy({
      by: ["debtor_id"],
      where: {
        debtor_id: { in: ids },
        deleted_at: null,
      },
      _count: {
        _all: true,
      },
    }),
    prisma.debtor_contract_slik_snapshots.findMany({
      where: {
        debtor_id: { in: ids },
        deleted_at: null,
      },
      orderBy: [{ period_month: "desc" }, { updated_at: "desc" }],
      select: {
        debtor_id: true,
        period_month: true,
        collectibility_code: true,
      },
    }),
  ]);

  for (const group of contractGroups) {
    const current = aggregates.get(group.debtor_id);
    if (!current) continue;
    current.contracts_count = group._count?._all || 0;
    current.total_outstanding =
      Number(group._sum?.outstanding_pokok || 0) +
      Number(group._sum?.outstanding_margin || 0);
  }

  for (const group of collateralGroups) {
    const current = aggregates.get(group.debtor_id);
    if (current) current.collaterals_count = group._count?._all || 0;
  }

  for (const group of debtorDocumentGroups) {
    const current = aggregates.get(group.debtor_id);
    if (current) current.documents_count = group._count?._all || 0;
  }

  for (const group of digitalDocumentGroups) {
    const current = aggregates.get(group.debtor_id);
    if (current) current.digital_documents_count = group._count?._all || 0;
  }

  for (const snapshot of latestSnapshots) {
    const current = aggregates.get(snapshot.debtor_id);
    if (!current || current.latest_slik_period_month) continue;
    current.latest_slik_period_month = snapshot.period_month;
    current.latest_collectibility_code = snapshot.collectibility_code;
  }

  return aggregates;
}

function findCollaterals({ where, skip, take, orderBy }) {
  return prisma.debtor_collaterals.findMany({
    where,
    skip,
    take,
    orderBy,
    include: {
      debtor: {
        include: {
          branch: true,
          marketing_user: {
            select: USER_SELECT,
          },
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
    },
  });
}

function countCollaterals(where) {
  return prisma.debtor_collaterals.count({ where });
}

function findById(id, where = {}, db = prisma) {
  return db.digital_debtors.findFirst({
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
          slik_snapshots: {
            where: {
              deleted_at: null,
            },
            orderBy: {
              period_month: "desc",
            },
            take: 3,
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
              debtor_id: true,
              no_kontrak: true,
              status: true,
            },
          },
        },
      },
    },
  });
}

function create(data, db = prisma) {
  return db.digital_debtors.create({
    data,
    include: DEBTOR_INCLUDE,
  });
}

function update(id, data, db = prisma) {
  return db.digital_debtors.update({
    where: { id },
    data,
    include: DEBTOR_INCLUDE,
  });
}

function transaction(callback) {
  return prisma.$transaction(callback);
}

function upsertIndividualProfile(debtorId, data, db = prisma) {
  const { created_by, ...updateData } = data;
  return db.debtor_individual_profiles.upsert({
    where: { debtor_id: debtorId },
    update: updateData,
    create: {
      ...data,
      debtor_id: debtorId,
    },
  });
}

function upsertLegalEntityProfile(debtorId, data, db = prisma) {
  const { created_by, ...updateData } = data;
  return db.debtor_legal_entity_profiles.upsert({
    where: { debtor_id: debtorId },
    update: updateData,
    create: {
      ...data,
      debtor_id: debtorId,
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

function findActiveDocumentChecklists() {
  return prisma.document_checklists.findMany({
    where: {
      is_active: true,
      deleted_at: null,
    },
    orderBy: [{ category: "asc" }, { code: "asc" }, { name: "asc" }],
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
          debtor_id: true,
          no_kontrak: true,
          status: true,
        },
      },
    },
  });
}

function findDocuments({ where, skip, take, orderBy }) {
  return prisma.debtor_documents.findMany({
    where,
    skip,
    take,
    orderBy,
    include: {
      document_checklist: true,
      debtor: {
        select: {
          id: true,
          debtor_number: true,
          identity_number: true,
          name: true,
          customer_type: true,
          slik_segment: true,
          slik_status_code: true,
          branch: true,
          marketing_user: {
            select: USER_SELECT,
          },
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
    },
  });
}

function countDocuments(where = {}) {
  return prisma.debtor_documents.count({ where });
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
          debtor_id: true,
          no_kontrak: true,
          status: true,
        },
      },
    },
  });
}

async function findWorkflowData(debtorId, contractIds = []) {
  const contractFilter = contractIds.length > 0 ? { contract_id: { in: contractIds } } : null;

  const [
    timelines,
    marketing,
    ideb,
    prints,
    warningLetters,
    notaryProgress,
    insuranceProgress,
    kjppProgress,
    claims,
    deposits,
    restructuringRecords,
    collaterals,
  ] = await Promise.all([
    prisma.debtor_marketing_timelines.findMany({
      where: {
        debtor_id: debtorId,
        deleted_at: null,
      },
      orderBy: [{ started_at: "desc" }, { created_at: "desc" }],
      include: {
        contract: {
          select: {
            id: true,
            debtor_id: true,
            no_kontrak: true,
            status: true,
          },
        },
      },
    }),
    prisma.debtor_marketing_activities.findMany({
      where: {
        debtor_id: debtorId,
        deleted_at: null,
      },
      orderBy: [{ activity_date: "desc" }, { created_at: "desc" }],
      include: {
        timeline: true,
        related_activity: {
          select: {
            id: true,
            activity_kind: true,
            debtor_id: true,
            contract_id: true,
            timeline_id: true,
            timeline_group_id: true,
            activity_date: true,
            target_date: true,
            status: true,
            action_plan: true,
            visit_result: true,
            handling_step: true,
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
      },
    }),
    prisma.debtor_ideb_uploads.findMany({
      where: {
        deleted_at: null,
        OR: [
          { debtor_id: debtorId },
          ...(contractFilter ? [contractFilter] : []),
        ],
      },
      orderBy: [{ year: "desc" }, { month: "desc" }, { created_at: "desc" }],
      include: {
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
      },
    }),
    contractFilter
      ? prisma.legal_print_histories.findMany({
          where: {
            deleted_at: null,
            ...contractFilter,
          },
          orderBy: { printed_at: "desc" },
          include: {
            template: true,
            numbering_template: true,
            contract: {
              select: {
                id: true,
                debtor_id: true,
                no_kontrak: true,
                status: true,
              },
            },
          },
        })
      : [],
    prisma.debtor_warning_letters.findMany({
      where: {
        deleted_at: null,
        OR: [
          { debtor_id: debtorId },
          ...(contractFilter ? [contractFilter] : []),
        ],
      },
      orderBy: [{ issued_at: "desc" }, { created_at: "desc" }],
      include: {
        contract: {
          select: {
            id: true,
            debtor_id: true,
            no_kontrak: true,
            status: true,
          },
        },
      },
    }),
    contractFilter
      ? prisma.legal_notary_progress.findMany({
          where: {
            deleted_at: null,
            ...contractFilter,
          },
          orderBy: [{ received_at: "desc" }, { created_at: "desc" }],
          include: {
            third_party: true,
            collateral: true,
            contract: {
              select: {
                id: true,
                debtor_id: true,
                no_kontrak: true,
                status: true,
              },
            },
          },
        })
      : [],
    contractFilter
      ? prisma.legal_insurance_progress.findMany({
          where: {
            deleted_at: null,
            ...contractFilter,
          },
          orderBy: [{ period_start: "desc" }, { created_at: "desc" }],
          include: {
            third_party: true,
            collateral: true,
            contract: {
              select: {
                id: true,
                debtor_id: true,
                no_kontrak: true,
                status: true,
              },
            },
          },
        })
      : [],
    contractFilter
      ? prisma.legal_kjpp_progress.findMany({
          where: {
            deleted_at: null,
            ...contractFilter,
          },
          orderBy: [{ received_at: "desc" }, { created_at: "desc" }],
          include: {
            third_party: true,
            collateral: true,
            contract: {
              select: {
                id: true,
                debtor_id: true,
                no_kontrak: true,
                status: true,
              },
            },
          },
        })
      : [],
    contractFilter
      ? prisma.legal_claims.findMany({
          where: {
            deleted_at: null,
            ...contractFilter,
          },
          orderBy: [{ submitted_at: "desc" }, { created_at: "desc" }],
          include: {
            collateral: true,
            contract: {
              select: {
                id: true,
                debtor_id: true,
                no_kontrak: true,
                status: true,
              },
            },
            insurance_progress: {
              include: {
                collateral: true,
                third_party: true,
              },
            },
          },
        })
      : [],
    contractFilter
      ? prisma.legal_deposits.findMany({
          where: {
            deleted_at: null,
            ...contractFilter,
          },
          orderBy: { created_at: "desc" },
          include: {
            deposit_type: true,
            third_party: true,
            contract: {
              select: {
                id: true,
                debtor_id: true,
                no_kontrak: true,
                status: true,
              },
            },
            transactions: {
              orderBy: {
                transaction_date: "desc",
              },
              take: 25,
            },
          },
        })
      : [],
    contractFilter
      ? prisma.debtor_restructuring_records.findMany({
          where: {
            deleted_at: null,
            ...contractFilter,
          },
          orderBy: [{ period_month: "desc" }, { restructuring_date: "desc" }, { created_at: "desc" }],
          include: {
            contract: {
              select: {
                id: true,
                debtor_id: true,
                no_kontrak: true,
                status: true,
              },
            },
          },
        })
      : [],
    prisma.debtor_collaterals.findMany({
      where: {
        deleted_at: null,
        OR: [
          { debtor_id: debtorId },
          ...(contractFilter ? [contractFilter] : []),
        ],
      },
      orderBy: [{ period_month: "desc" }, { created_at: "desc" }],
      include: {
        contract: {
          select: {
            id: true,
            debtor_id: true,
            no_kontrak: true,
            status: true,
          },
        },
      },
    }),
  ]);

  return {
    claims,
    collaterals,
    deposits,
    ideb,
    insuranceProgress,
    kjppProgress,
    marketing,
    timelines,
    notaryProgress,
    prints,
    restructuringRecords,
    warningLetters,
  };
}

module.exports = {
  USER_SELECT,
  count,
  countCollaterals,
  countDocuments,
  countDocumentsByDebtorId,
  create,
  createDocument,
  findWorkflowData,
  findActiveDocumentChecklists,
  findActiveUserById,
  findBranchById,
  findById,
  findCollaterals,
  findContractById,
  findDocumentChecklistById,
  findDocuments,
  findDocumentsByDebtorId,
  findListAggregates,
  findMany,
  transaction,
  update,
  upsertIndividualProfile,
  upsertLegalEntityProfile,
};
