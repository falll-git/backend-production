const prisma = require("../config/prisma");
const {
  MANAGE_ALL_FEATURE,
  REPORT_ALL_FEATURE,
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

async function getDigitalArchiveAccessScope(userId) {
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
  const canViewAllDocuments = await roleHasFeature(
    roleId,
    DIGITAL_ARCHIVE_DATA_SCOPE_URLS,
    REPORT_ALL_FEATURE,
  );
  const canAccessDivisionDocuments = await roleHasFeature(
    roleId,
    DIGITAL_ARCHIVE_DATA_SCOPE_URLS,
    VIEW_DIVISION_FEATURE,
  );
  const canManageAllDocuments = await roleHasFeature(
    roleId,
    DIGITAL_ARCHIVE_DATA_SCOPE_URLS,
    MANAGE_ALL_FEATURE,
  );

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

function buildApprovedDocumentAccessWhere(userId, referenceDate = new Date()) {
  return {
    requester_id: userId,
    status: "APPROVED",
    expires_at: {
      gte: referenceDate,
    },
  };
}

function buildDocumentVisibilityWhere(scope) {
  const canAccessRestrictedDocuments = Boolean(
    scope?.canAccessRestrictedDocuments ?? scope?.canAccessRestricted,
  );
  const restrictedDocumentWhere = canAccessRestrictedDocuments
    ? {}
    : { access_level: "NON_RESTRICT" };

  let ownershipWhere = {};

  if (scope?.canViewAllDocuments) {
    ownershipWhere = {};
  } else if (scope?.userId) {
    const conditions = [
      {
        created_by: scope.userId,
      },
      {
        owner_user_id: scope.userId,
      },
      {
        related_users: {
          some: {
            user_id: scope.userId,
          },
        },
      },
      {
        access_requests: {
          some: buildApprovedDocumentAccessWhere(scope.userId),
        },
      },
    ];

    if (scope.canAccessDivisionDocuments && scope.divisionId) {
      conditions.push({
        owner_division_id: scope.divisionId,
      });
    }

    ownershipWhere = {
      OR: conditions,
    };
  } else {
    ownershipWhere = {
      id: "__no_digital_archive_access__",
    };
  }

  if (Object.keys(ownershipWhere).length === 0) return restrictedDocumentWhere;
  if (Object.keys(restrictedDocumentWhere).length === 0) return ownershipWhere;

  return {
    AND: [ownershipWhere, restrictedDocumentWhere],
  };
}

function canScopeAccessDocument(document, scope) {
  if (!document) return false;

  const isRestricted =
    document.access_level === "RESTRICT" || document.is_restricted === true;
  const canAccessRestrictedDocuments = Boolean(
    scope?.canAccessRestrictedDocuments ?? scope?.canAccessRestricted,
  );

  if (isRestricted && !canAccessRestrictedDocuments) return false;
  if (scope?.canViewAllDocuments) return true;
  if (!scope?.userId) return false;

  if (document.created_by === scope.userId) return true;
  if (document.owner_user_id === scope.userId) return true;

  if (
    scope.canAccessDivisionDocuments &&
    scope.divisionId &&
    document.owner_division_id === scope.divisionId
  ) {
    return true;
  }

  const relatedUsers = Array.isArray(document.related_users)
    ? document.related_users
    : [];
  if (relatedUsers.some((item) => item.user_id === scope.userId)) {
    return true;
  }

  const accessRequests = Array.isArray(document.access_requests)
    ? document.access_requests
    : [];
  return accessRequests.some((item) => {
    if (item.requester_id !== scope.userId || item.status !== "APPROVED") {
      return false;
    }

    return new Date(item.expires_at) >= new Date();
  });
}

module.exports = {
  buildApprovedDocumentAccessWhere,
  canScopeAccessDocument,
  DIGITAL_ARCHIVE_DATA_SCOPE_URLS,
  getDigitalArchiveAccessScope,
  buildDocumentVisibilityWhere,
};
