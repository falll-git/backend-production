const prisma = require("../config/prisma");
const {
  MANAGE_ALL_FEATURE,
  VIEW_DIVISION_FEATURE,
} = require("./menu-access");
const { roleHasFeature } = require("./rbac");

const NO_ACCESS_ID = "__no_persuratan_access__";
const PERSURATAN_DATA_SCOPE_URLS = [
  "/dashboard/manajemen-surat/kelola-surat/input-surat-masuk",
  "/dashboard/manajemen-surat/kelola-surat/input-surat-keluar",
  "/dashboard/manajemen-surat/kelola-surat/input-memorandum",
  "/dashboard/manajemen-surat/laporan",
  "/dashboard/manajemen-surat/cetak-dokumen",
];

function hasDivisionScope(scope) {
  return Boolean(scope?.divisionId && scope?.canAccessDivisionPersuratan);
}

async function getPersuratanAccessScope(
  userId,
  menuUrls = PERSURATAN_DATA_SCOPE_URLS,
) {
  if (!userId) {
    return {
      userId: null,
      roleId: null,
      roleName: null,
      divisionId: null,
      divisionName: null,
      canAccessAllPersuratan: false,
      canAccessDivisionPersuratan: false,
      canManageAllPersuratan: false,
    };
  }

  const user = await prisma.users.findFirst({
    where: {
      id: userId,
      is_active: true,
    },
    select: {
      id: true,
      role_id: true,
      division_id: true,
      role: {
        select: {
          id: true,
          name: true,
        },
      },
      division: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  const roleId = user?.role_id ?? null;
  const canAccessDivisionPersuratan = await roleHasFeature(
    roleId,
    menuUrls,
    VIEW_DIVISION_FEATURE,
  );
  const canManageAllPersuratan = await roleHasFeature(
    roleId,
    menuUrls,
    MANAGE_ALL_FEATURE,
  );
  const canAccessAllPersuratan = canManageAllPersuratan;

  return {
    userId: user?.id ?? null,
    roleId,
    roleName: user?.role?.name ?? null,
    divisionId: user?.division_id ?? null,
    divisionName: user?.division?.name ?? null,
    canAccessAllPersuratan,
    canAccessDivisionPersuratan,
    canManageAllPersuratan,
  };
}

function buildDispositionUserWhere(fieldName, userId) {
  return {
    [fieldName]: {
      some: {
        OR: [{ receiver_id: userId }, { sender_id: userId }],
      },
    },
  };
}

function buildIncomingMailVisibilityWhere(scope) {
  if (scope?.canAccessAllPersuratan) {
    return {};
  }

  if (!scope?.userId) {
    return { id: NO_ACCESS_ID };
  }

  const conditions = [
    { created_by: scope.userId },
    buildDispositionUserWhere("disposition_mails", scope.userId),
  ];

  if (hasDivisionScope(scope)) {
    conditions.push({
      target_divisions: {
        some: {
          OR: [
            { division_id: scope.divisionId },
            { manager_id: scope.userId },
          ],
        },
      },
    });
  }

  return { OR: conditions };
}

function buildMemorandumVisibilityWhere(scope) {
  if (scope?.canAccessAllPersuratan) {
    return {};
  }

  if (!scope?.userId) {
    return { id: NO_ACCESS_ID };
  }

  const conditions = [
    { created_by: scope.userId },
    buildDispositionUserWhere("dispositions", scope.userId),
  ];

  if (hasDivisionScope(scope)) {
    conditions.push(
      { origin_division_id: scope.divisionId },
      {
        target_divisions: {
          some: {
            OR: [
              { division_id: scope.divisionId },
              { manager_id: scope.userId },
            ],
          },
        },
      },
    );
  }

  return { OR: conditions };
}

function buildOutgoingMailVisibilityWhere(scope) {
  if (scope?.canAccessAllPersuratan) {
    return {};
  }

  if (!scope?.userId) {
    return { id: NO_ACCESS_ID };
  }

  const conditions = [{ created_by: scope.userId }];

  if (hasDivisionScope(scope)) {
    conditions.push({
      creator: {
        division_id: scope.divisionId,
      },
    });
  }

  return { OR: conditions };
}

function isSameUser(userId, candidateId) {
  return Boolean(userId && candidateId && String(userId) === String(candidateId));
}

function hasDispositionInvolvement(dispositions, userId) {
  if (!Array.isArray(dispositions) || !userId) return false;

  return dispositions.some(
    (item) =>
      isSameUser(userId, item.receiver_id) || isSameUser(userId, item.sender_id),
  );
}

function hasIncomingDivisionAccess(record, scope) {
  if (!hasDivisionScope(scope)) return false;

  return (record.target_divisions || []).some(
    (item) =>
      isSameUser(item.division_id, scope.divisionId) ||
      isSameUser(item.manager_id, scope.userId),
  );
}

function hasMemorandumDivisionAccess(record, scope) {
  if (!hasDivisionScope(scope)) return false;

  if (isSameUser(record.origin_division_id, scope.divisionId)) {
    return true;
  }

  return (record.target_divisions || []).some(
    (item) =>
      isSameUser(item.division_id, scope.divisionId) ||
      isSameUser(item.manager_id, scope.userId),
  );
}

function hasOutgoingDivisionAccess(record, scope) {
  if (!hasDivisionScope(scope)) return false;
  return isSameUser(record.creator?.division_id, scope.divisionId);
}

function canViewIncomingMail(record, scope) {
  if (!record || !scope?.userId) return false;
  if (scope.canAccessAllPersuratan) return true;

  return (
    isSameUser(record.created_by, scope.userId) ||
    hasDispositionInvolvement(record.disposition_mails, scope.userId) ||
    hasIncomingDivisionAccess(record, scope)
  );
}

function canViewMemorandum(record, scope) {
  if (!record || !scope?.userId) return false;
  if (scope.canAccessAllPersuratan) return true;

  return (
    isSameUser(record.created_by, scope.userId) ||
    hasDispositionInvolvement(record.dispositions, scope.userId) ||
    hasMemorandumDivisionAccess(record, scope)
  );
}

function canViewOutgoingMail(record, scope) {
  if (!record || !scope?.userId) return false;
  if (scope.canAccessAllPersuratan) return true;

  return (
    isSameUser(record.created_by, scope.userId) ||
    hasOutgoingDivisionAccess(record, scope)
  );
}

function canManageIncomingMail(record, scope) {
  if (!canViewIncomingMail(record, scope)) return false;
  if (scope.canManageAllPersuratan) return true;

  return isSameUser(record.created_by, scope.userId);
}

function canManageMemorandum(record, scope) {
  if (!canViewMemorandum(record, scope)) return false;
  if (scope.canManageAllPersuratan) return true;

  return isSameUser(record.created_by, scope.userId);
}

function canManageOutgoingMail(record, scope) {
  if (!canViewOutgoingMail(record, scope)) return false;
  if (scope.canManageAllPersuratan) return true;

  return isSameUser(record.created_by, scope.userId);
}

module.exports = {
  buildIncomingMailVisibilityWhere,
  buildMemorandumVisibilityWhere,
  buildOutgoingMailVisibilityWhere,
  canManageIncomingMail,
  canManageMemorandum,
  canManageOutgoingMail,
  canViewIncomingMail,
  canViewMemorandum,
  canViewOutgoingMail,
  getPersuratanAccessScope,
  hasDivisionScope,
  PERSURATAN_DATA_SCOPE_URLS,
};
