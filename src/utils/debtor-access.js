const prisma = require("../config/prisma");
const {
  MANAGE_ALL_FEATURE,
  VIEW_DIVISION_FEATURE,
} = require("./menu-access");
const { roleHasFeature, roleHasPermission } = require("./rbac");

const DEBTOR_DATA_SCOPE_URLS = [
  "/dashboard/informasi-debitur",
  "/dashboard/informasi-debitur/master-debitur",
  "/dashboard/informasi-debitur/marketing/action-plan",
  "/dashboard/informasi-debitur/marketing/hasil-kunjungan",
  "/dashboard/informasi-debitur/marketing/langkah-penanganan",
  "/dashboard/informasi-debitur/admin/upload-slik",
  "/dashboard/informasi-debitur/admin/monitoring-import",
  "/dashboard/informasi-debitur/admin/upload-ideb",
  "/dashboard/informasi-debitur/laporan-ideb",
  "/dashboard/informasi-debitur/laporan",
  "/dashboard/informasi-debitur/laporan/npf",
  "/dashboard/informasi-debitur/laporan/aktivitas-marketing",
];

const LEGAL_DATA_SCOPE_URLS = [
  "/dashboard/legal/titipan/asuransi",
  "/dashboard/legal/titipan/notaris",
  "/dashboard/legal/titipan/angsuran",
  "/dashboard/legal/titipan/lainnya",
  "/dashboard/legal/progress/notaris",
  "/dashboard/legal/progress/asuransi",
  "/dashboard/legal/progress/kjpp",
  "/dashboard/legal/progress/klaim",
];

async function getDebtorAccessScope(userId, urls = DEBTOR_DATA_SCOPE_URLS) {
  if (!userId) {
    return {
      userId: null,
      roleId: null,
      divisionId: null,
      canViewAll: false,
      canViewDivision: false,
      canManageAll: false,
    };
  }

  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role_id: true,
      division_id: true,
    },
  });
  const roleId = user?.role_id || null;
  const canViewDivision = await roleHasFeature(
    roleId,
    urls,
    VIEW_DIVISION_FEATURE,
  );
  const canManageAll = await roleHasFeature(roleId, urls, MANAGE_ALL_FEATURE);

  return {
    userId: user?.id || null,
    roleId,
    divisionId: user?.division_id || null,
    canViewAll: false,
    canViewDivision,
    canManageAll,
  };
}

function buildDebtorVisibilityWhere(scope) {
  if (scope?.canViewAll || scope?.canManageAll) return {};
  if (!scope?.userId) return { id: "__no_debtor_access__" };

  const ownClauses = [
    { created_by: scope.userId },
    { marketing_user_id: scope.userId },
    {
      contracts: {
        some: {
          OR: [
            { created_by: scope.userId },
            { marketing_user_id: scope.userId },
          ],
        },
      },
    },
    {
      marketing_items: {
        some: {
          created_by: scope.userId,
        },
      },
    },
  ];

  if (!scope.canViewDivision || !scope.divisionId) {
    return { OR: ownClauses };
  }

  return {
    OR: [
      ...ownClauses,
      {
        marketing_user: {
          division_id: scope.divisionId,
        },
      },
      {
        contracts: {
          some: {
            marketing_user: {
              division_id: scope.divisionId,
            },
          },
        },
      },
    ],
  };
}

function buildDebtorManageWhere(scope) {
  if (scope?.canManageAll) return {};
  if (!scope?.userId) return { id: "__no_debtor_manage_access__" };

  return {
    OR: [{ created_by: scope.userId }, { marketing_user_id: scope.userId }],
  };
}

function buildContractVisibilityWhere(scope) {
  if (scope?.canViewAll || scope?.canManageAll) return {};
  if (!scope?.userId) return { id: "__no_contract_access__" };

  const ownClauses = [
    { created_by: scope.userId },
    { marketing_user_id: scope.userId },
    {
      debtor: {
        OR: [{ created_by: scope.userId }, { marketing_user_id: scope.userId }],
      },
    },
  ];

  if (!scope.canViewDivision || !scope.divisionId) {
    return { OR: ownClauses };
  }

  return {
    OR: [
      ...ownClauses,
      {
        marketing_user: {
          division_id: scope.divisionId,
        },
      },
      {
        debtor: {
          marketing_user: {
            division_id: scope.divisionId,
          },
        },
      },
    ],
  };
}

function buildContractManageWhere(scope) {
  if (scope?.canManageAll) return {};
  if (!scope?.userId) return { id: "__no_contract_manage_access__" };

  return {
    OR: [
      { created_by: scope.userId },
      { marketing_user_id: scope.userId },
      {
        debtor: {
          OR: [
            { created_by: scope.userId },
            { marketing_user_id: scope.userId },
          ],
        },
      },
    ],
  };
}

async function userHasAnyMenuRead(userId, urls) {
  if (!userId) return false;

  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: {
      role_id: true,
    },
  });

  return roleHasPermission(user?.role_id, urls, "read");
}

module.exports = {
  DEBTOR_DATA_SCOPE_URLS,
  LEGAL_DATA_SCOPE_URLS,
  buildContractManageWhere,
  buildContractVisibilityWhere,
  buildDebtorManageWhere,
  buildDebtorVisibilityWhere,
  getDebtorAccessScope,
  userHasAnyMenuRead,
};
