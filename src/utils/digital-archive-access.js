const prisma = require("../config/prisma");
const {
  MANAGE_ALL_FEATURE,
  VIEW_DIVISION_FEATURE,
} = require("./menu-access");
const { roleHasFeature } = require("./rbac");

const DIGITAL_ARCHIVE_DATA_SCOPE_URLS = [
  "/dashboard/arsip-digital/input-dokumen",
  "/dashboard/arsip-digital/ruang-arsip/tempat-penyimpanan",
  "/dashboard/arsip-digital/ruang-arsip/list-dokumen",
  "/dashboard/arsip-digital/ruang-arsip/jatuh-tempo",
  "/dashboard/arsip-digital/disposisi/pengajuan",
  "/dashboard/arsip-digital/disposisi/permintaan",
  "/dashboard/arsip-digital/disposisi/historis",
  "/dashboard/arsip-digital/peminjaman/request",
  "/dashboard/arsip-digital/peminjaman/accept",
  "/dashboard/arsip-digital/peminjaman/laporan",
  "/dashboard/arsip-digital/historis/penyimpanan",
  "/dashboard/arsip-digital/historis/peminjaman",
  "/dashboard/arsip-digital/laporan",
];

async function getDigitalArchiveAccessScope(
  userId,
  menuUrls = DIGITAL_ARCHIVE_DATA_SCOPE_URLS,
) {
  if (!userId) {
    return {
      userId: null,
      roleId: null,
      roleName: null,
      divisionId: null,
      divisionName: null,
      canAccessRestricted: false,
      canAccessRestrictedDocuments: false,
      canViewAllDocuments: false,
      canAccessDivisionDocuments: false,
      canManageAllDocuments: false,
    };
  }

  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: {
      id: true,
      can_access_restricted_documents: true,
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
  const canAccessDivisionDocuments = await roleHasFeature(
    roleId,
    menuUrls,
    VIEW_DIVISION_FEATURE,
  );
  const canManageAllDocuments = await roleHasFeature(
    roleId,
    menuUrls,
    MANAGE_ALL_FEATURE,
  );
  const canViewAllDocuments = canManageAllDocuments;

  return {
    userId: user?.id ?? null,
    roleId,
    roleName: user?.role?.name ?? null,
    divisionId: user?.division_id ?? null,
    divisionName: user?.division?.name ?? null,
    canAccessRestricted: Boolean(user?.can_access_restricted_documents),
    canAccessRestrictedDocuments: Boolean(
      user?.can_access_restricted_documents,
    ),
    canViewAllDocuments,
    canAccessDivisionDocuments,
    canManageAllDocuments,
  };
}

function toValidDate(value) {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfLocalDay(value) {
  const date = toValidDate(value) || new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfLocalDay(value) {
  const date = toValidDate(value);
  if (!date) return null;

  date.setHours(23, 59, 59, 999);
  return date;
}

function normalizeAccessExpiresAt(value) {
  return endOfLocalDay(value);
}

function isAccessRequestActive(item, referenceDate = new Date()) {
  if (!item || item.status !== "APPROVED") return false;
  if (!item.expires_at) return true;

  const expiresAt = normalizeAccessExpiresAt(item.expires_at);
  if (!expiresAt) return false;

  return expiresAt >= referenceDate;
}

function buildActiveApprovedAccessWhere(referenceDate = new Date()) {
  return {
    status: "APPROVED",
    expires_at: {
      gte: startOfLocalDay(referenceDate),
    },
  };
}

function buildApprovedDocumentAccessWhere(userId, referenceDate = new Date()) {
  return {
    requester_id: userId,
    ...buildActiveApprovedAccessWhere(referenceDate),
  };
}

function canAccessRestrictedDocuments(scope) {
  return Boolean(
    scope?.canAccessRestrictedDocuments ?? scope?.canAccessRestricted,
  );
}

function buildDirectDocumentAccessConditions(userId) {
  if (!userId) return [];

  return [
    {
      created_by: userId,
    },
    {
      owner_user_id: userId,
    },
    {
      related_users: {
        some: {
          user_id: userId,
        },
      },
    },
    {
      access_requests: {
        some: buildApprovedDocumentAccessWhere(userId),
      },
    },
  ];
}

function buildRestrictedAwareScopeWhere(baseWhere, canAccessRestricted) {
  if (canAccessRestricted) return baseWhere;

  return {
    ...baseWhere,
    access_level: "NON_RESTRICT",
  };
}

function buildDocumentVisibilityWhere(scope) {
  const canAccessRestricted = canAccessRestrictedDocuments(scope);
  const conditions = buildDirectDocumentAccessConditions(scope?.userId);

  if (scope?.canViewAllDocuments) {
    if (canAccessRestricted) return {};
    conditions.push({ access_level: "NON_RESTRICT" });
  } else if (scope?.canAccessDivisionDocuments && scope?.divisionId) {
    conditions.push(
      buildRestrictedAwareScopeWhere(
        {
          owner_division_id: scope.divisionId,
        },
        canAccessRestricted,
      ),
    );
  }

  if (conditions.length === 0) {
    return {
      id: "__no_digital_archive_access__",
    };
  }

  if (conditions.length === 1) return conditions[0];

  return {
    OR: conditions,
  };
}

function canScopeAccessDocument(document, scope) {
  if (!document) return false;

  const isRestricted =
    document.access_level === "RESTRICT" || document.is_restricted === true;
  const canAccessRestricted = canAccessRestrictedDocuments(scope);
  const userId = scope?.userId;

  if (!userId) return false;

  if (document.created_by === userId) return true;
  if (document.owner_user_id === userId) return true;

  const relatedUsers = Array.isArray(document.related_users)
    ? document.related_users
    : [];
  if (relatedUsers.some((item) => item.user_id === userId)) {
    return true;
  }

  const accessRequests = Array.isArray(document.access_requests)
    ? document.access_requests
    : [];
  if (
    accessRequests.some(
      (item) => item.requester_id === userId && isAccessRequestActive(item),
    )
  ) {
    return true;
  }

  if (scope?.canViewAllDocuments) {
    return !isRestricted || canAccessRestricted;
  }

  if (
    scope?.canAccessDivisionDocuments &&
    scope.divisionId &&
    document.owner_division_id === scope.divisionId
  ) {
    return !isRestricted || canAccessRestricted;
  }

  return false;
}

module.exports = {
  buildActiveApprovedAccessWhere,
  buildApprovedDocumentAccessWhere,
  canScopeAccessDocument,
  DIGITAL_ARCHIVE_DATA_SCOPE_URLS,
  getDigitalArchiveAccessScope,
  buildDocumentVisibilityWhere,
  isAccessRequestActive,
  normalizeAccessExpiresAt,
};
