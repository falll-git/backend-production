const prisma = require("../config/prisma");

async function getDigitalArchiveAccessScope(userId) {
  if (!userId) {
    return {
      userId: null,
      canAccessRestricted: false,
    };
  }

  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: {
      id: true,
      is_restrict: true,
    },
  });

  return {
    userId: user?.id ?? null,
    canAccessRestricted: Boolean(user?.is_restrict),
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
    return {
      OR: [
        {
          is_restricted: false,
        },
        {
          created_by: scope.userId,
        },
        {
          access_requests: {
            some: buildApprovedDocumentAccessWhere(scope.userId),
          },
        },
      ],
    };
  }

  return {
    is_restricted: false,
  };
}

module.exports = {
  buildApprovedDocumentAccessWhere,
  getDigitalArchiveAccessScope,
  buildDocumentVisibilityWhere,
};
