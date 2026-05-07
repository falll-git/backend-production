const prisma = require("../config/prisma");

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isLegalIdentity(userOrScope) {
  const roleName = normalizeName(userOrScope?.roleName || userOrScope?.role?.name);
  const divisionName = normalizeName(
    userOrScope?.divisionName || userOrScope?.division?.name,
  );

  return roleName === "legal" || divisionName === "legal";
}

function canReadDivisionDocuments(userOrScope) {
  const roleName = normalizeName(userOrScope?.roleName || userOrScope?.role?.name);

  return (
    roleName === "manager" ||
    roleName === "supervisor" ||
    isLegalIdentity(userOrScope)
  );
}

async function getDigitalArchiveAccessScope(userId) {
  if (!userId) {
    return {
      userId: null,
      roleId: null,
      roleName: null,
      divisionId: null,
      divisionName: null,
      canAccessRestricted: false,
      canAccessDivisionDocuments: false,
      isLegalUser: false,
    };
  }

  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: {
      id: true,
      is_restrict: true,
      role_id: true,
      division_id: true,
      role: {
        select: {
          id: true,
          name: true,
          type: true,
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
  const scopeUser = {
    roleName: user?.role?.name,
    divisionName: user?.division?.name,
  };

  return {
    userId: user?.id ?? null,
    roleId: user?.role_id ?? null,
    roleName: user?.role?.name ?? null,
    divisionId: user?.division_id ?? null,
    divisionName: user?.division?.name ?? null,
    canAccessRestricted: Boolean(user?.is_restrict),
    canAccessDivisionDocuments: canReadDivisionDocuments(scopeUser),
    isLegalUser: isLegalIdentity(scopeUser),
  };
}

function buildApprovedDocumentAccessWhere(userId, referenceDate = new Date()) {
  return {
    requester_id: userId,
    status: "APPROVED",
    OR: [
      {
        expires_at: null,
      },
      {
        expires_at: {
          gte: referenceDate,
        },
      },
    ],
  };
}

function buildDocumentVisibilityWhere(scope) {
  if (scope?.canAccessRestricted) {
    return {};
  }

  if (scope?.userId) {
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

    return {
      OR: conditions,
    };
  }

  return {
    id: "__no_digital_archive_access__",
  };
}

function canScopeAccessDocument(document, scope) {
  if (!document) return false;
  if (scope?.canAccessRestricted) return true;
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

    if (!item.expires_at) return true;
    return new Date(item.expires_at) >= new Date();
  });
}

module.exports = {
  buildApprovedDocumentAccessWhere,
  canReadDivisionDocuments,
  canScopeAccessDocument,
  getDigitalArchiveAccessScope,
  buildDocumentVisibilityWhere,
  isLegalIdentity,
};
