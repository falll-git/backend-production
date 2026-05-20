const repository = require("./digitalDocumentAccessRequests.repository");
const digitalDocumentRepository = require("../digital-documents/digitalDocuments.repository");
const { AppError } = require("../../utils/errors");
const {
  serializeDigitalDocumentAccessRequest,
} = require("../../utils/digital-archive-serializer");
const {
  getDigitalArchiveAccessScope,
  buildDocumentVisibilityWhere,
  canScopeAccessDocument,
} = require("../../utils/digital-archive-access");
const { APPROVE_FEATURE, REJECT_FEATURE } = require("../../utils/menu-access");
const { roleHasFeature, roleHasPermission } = require("../../utils/rbac");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  resolvePagination,
} = require("../../utils/pagination");

const ACCESS_REQUEST_ACTION_URL =
  "/dashboard/arsip-digital/disposisi/permintaan";

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function isRestrictedDocument(document) {
  return document?.access_level === "RESTRICT" || document?.is_restricted === true;
}

function buildSearchWhere(search) {
  const normalized = normalizeText(search);
  if (!normalized) return {};

  return {
    OR: [
      {
        request_reason: {
          contains: normalized,
          mode: "insensitive",
        },
      },
      {
        action_note: {
          contains: normalized,
          mode: "insensitive",
        },
      },
      {
        document: {
          document_number: {
            contains: normalized,
            mode: "insensitive",
          },
        },
      },
      {
        document: {
          document_name: {
            contains: normalized,
            mode: "insensitive",
          },
        },
      },
      {
        requester: {
          name: {
            contains: normalized,
            mode: "insensitive",
          },
        },
      },
      {
        requester: {
          username: {
            contains: normalized,
            mode: "insensitive",
          },
        },
      },
      {
        owner: {
          name: {
            contains: normalized,
            mode: "insensitive",
          },
        },
      },
      {
        owner: {
          username: {
            contains: normalized,
            mode: "insensitive",
          },
        },
      },
    ],
  };
}

function buildWhere(query, userId) {
  const where = {
    ...buildSearchWhere(query.search),
  };

  if (
    String(query.report || "")
      .trim()
      .toLowerCase() === "history"
  ) {
    where.status = {
      in: ["APPROVED", "REJECTED"],
    };
  } else if (query.status) {
    where.status = String(query.status).trim().toUpperCase();
  }

  if (query.document_id) {
    where.document_id = query.document_id;
  }

  if (query.office_id) {
    where.document = {
      ...(where.document || {}),
      storage: {
        ...((where.document && where.document.storage) || {}),
        cabinet: {
          ...(((where.document && where.document.storage) || {}).cabinet || {}),
          office_id: query.office_id,
        },
      },
    };
  }

  if (query.cabinet_id) {
    where.document = {
      ...(where.document || {}),
      storage: {
        ...((where.document && where.document.storage) || {}),
        cabinet_id: query.cabinet_id,
      },
    };
  }

  switch (
    String(query.scope || "")
      .trim()
      .toLowerCase()
  ) {
    case "requested":
      where.requester_id = userId;
      break;
    case "owned":
      where.owner_id = userId;
      break;
    default:
      break;
  }

  return where;
}

function buildVisibilityWhere(scope, userId) {
  const visibleDocumentWhere = {
    document: buildDocumentVisibilityWhere(scope),
  };

  if (scope?.canViewAllDocuments) {
    return visibleDocumentWhere;
  }

  if (!userId) {
    return visibleDocumentWhere;
  }

  return {
    OR: [
      visibleDocumentWhere,
      {
        requester_id: userId,
      },
      {
        owner_id: userId,
      },
      {
        acted_by: userId,
      },
    ],
  };
}

function canViewAccessRequest(item, scope, userId) {
  if (!item) return false;
  if (scope?.canViewAllDocuments) {
    return canScopeAccessDocument(item.document, scope);
  }
  if (!userId) return false;

  return (
    item.requester_id === userId ||
    item.owner_id === userId ||
    item.acted_by === userId ||
    canScopeAccessDocument(item.document, scope)
  );
}

async function assertAccessRequestActionActor({ item, userId, feature }) {
  const scope = await getDigitalArchiveAccessScope(userId);
  const [canUpdate, hasFeature] = await Promise.all([
    roleHasPermission(scope.roleId, ACCESS_REQUEST_ACTION_URL, "update"),
    roleHasFeature(scope.roleId, ACCESS_REQUEST_ACTION_URL, feature),
  ]);

  if (!canUpdate) {
    throw new AppError(
      "Anda tidak memiliki izin untuk memproses permintaan disposisi",
      403,
    );
  }

  if (!canScopeAccessDocument(item.document, scope)) {
    throw new AppError("Pengajuan akses dokumen tidak ditemukan", 404);
  }

  if (item.owner_id === userId) {
    return;
  }

  if (!hasFeature) {
    throw new AppError(
      "Anda tidak memiliki izin untuk memproses permintaan disposisi",
      403,
    );
  }
}

exports.getAll = async ({ req, query, userId, scopeOverride = null }) => {
  const scope = scopeOverride || (await getDigitalArchiveAccessScope(userId));
  const where = {
    AND: [buildWhere(query, userId), buildVisibilityWhere(scope, userId)],
  };
  const pagination = resolvePagination(query, {
    ...PAGINATION_PROFILES.TABLE,
    allowAll: true,
  });

  if (pagination.all) {
    const data = await repository.findMany({ where });
    return {
      data: data.map((item) => serializeDigitalDocumentAccessRequest(req, item)),
    };
  }

  const data = await repository.findMany({
    where,
    skip: pagination.skip,
    take: pagination.take,
  });
  const total = await repository.count(where);

  return {
    data: data.map((item) => serializeDigitalDocumentAccessRequest(req, item)),
    meta: buildPaginationMeta(total, pagination),
  };
};

exports.getById = async ({ req, id, userId }) => {
  const item = await repository.findById(id);
  if (!item) {
    throw new AppError("Pengajuan akses dokumen tidak ditemukan", 404);
  }

  const scope = await getDigitalArchiveAccessScope(userId);
  if (!canViewAccessRequest(item, scope, userId)) {
    throw new AppError("Pengajuan akses dokumen tidak ditemukan", 404);
  }

  return serializeDigitalDocumentAccessRequest(req, item);
};

exports.create = async ({ req, payload, userId }) => {
  if (!userId) {
    throw new AppError("User tidak dikenali", 401);
  }

  const documentIds = Array.from(new Set(payload.document_ids));
  const createdIds = [];
  const requesterScope = await getDigitalArchiveAccessScope(userId);
  const expiresAt = new Date(payload.expires_at);

  if (expiresAt.getTime() <= Date.now()) {
    throw new AppError(
      "Tanggal berakhir akses harus lebih besar dari waktu saat ini",
      422,
    );
  }

  await repository.withTransaction(async (client) => {
    for (const documentId of documentIds) {
      const document = await digitalDocumentRepository.findById(documentId, {
        deleted_at: null,
      });

      if (!document) {
        throw new AppError("Dokumen yang diajukan tidak ditemukan", 404);
      }

      if (
        isRestrictedDocument(document) &&
        !Boolean(
          requesterScope.canAccessRestrictedDocuments ??
            requesterScope.canAccessRestricted,
        )
      ) {
        throw new AppError("Dokumen yang diajukan tidak ditemukan", 404);
      }

      if (canScopeAccessDocument(document, requesterScope)) {
        throw new AppError(
          "Anda sudah memiliki akses ke dokumen yang diajukan",
          409,
        );
      }

      const existingPending =
        await repository.findPendingByDocumentAndRequester(
          document.id,
          userId,
          client,
        );

      if (existingPending) {
        throw new AppError(
          `Masih ada pengajuan akses yang menunggu untuk dokumen ${document.document_number}`,
          409,
        );
      }

      const existingActiveAccess =
        await repository.findActiveApprovedByDocumentAndRequester(
          document.id,
          userId,
          client,
        );

      if (existingActiveAccess) {
        throw new AppError(
          `Akses untuk dokumen ${document.document_number} masih aktif`,
          409,
        );
      }

      const created = await repository.create(
        {
          document_id: document.id,
          requester_id: userId,
          owner_id: document.owner_user_id || document.created_by,
          request_reason: normalizeText(payload.request_reason),
          expires_at: expiresAt,
        },
        client,
      );

      await digitalDocumentRepository.createActivityLog(
        {
          document_id: document.id,
          actor_id: userId,
          action: "ACCESS_REQUESTED",
          to_storage_id: document.storage_id,
          reference_type: "ACCESS_REQUEST",
          reference_id: created.id,
          description: "Pengajuan akses dokumen dibuat",
        },
        client,
      );

      createdIds.push(created.id);
    }
  });

  const items = await repository.findManyByIds(createdIds);

  return {
    count: items.length,
    items: items.map((item) =>
      serializeDigitalDocumentAccessRequest(req, item),
    ),
  };
};

exports.approve = async ({ req, id, payload, userId }) => {
  if (!userId) {
    throw new AppError("User tidak dikenali", 401);
  }

  const item = await repository.findById(id);
  if (!item) {
    throw new AppError("Pengajuan akses dokumen tidak ditemukan", 404);
  }

  if (item.status !== "PENDING") {
    throw new AppError("Pengajuan akses sudah diproses", 409);
  }

  await assertAccessRequestActionActor({
    item,
    userId,
    feature: APPROVE_FEATURE,
  });

  const expiresAt = new Date(payload.expires_at || item.expires_at);
  if (expiresAt.getTime() <= Date.now()) {
    throw new AppError(
      "Tanggal berakhir akses harus lebih besar dari waktu saat ini",
      422,
    );
  }

  await repository.withTransaction(async (client) => {
    const actedAt = new Date();
    const result = await repository.update(
      id,
      {
        status: "APPROVED",
        expires_at: expiresAt,
        action_note: normalizeText(payload.action_note),
        acted_by: userId,
        acted_at: actedAt,
        approved_at: actedAt,
      },
      client,
    );

    await digitalDocumentRepository.createActivityLog(
      {
        document_id: result.document_id,
        actor_id: userId,
        action: "ACCESS_APPROVED",
        to_storage_id: item.document.storage_id,
        reference_type: "ACCESS_REQUEST",
        reference_id: result.id,
        description: "Akses dokumen disetujui",
      },
      client,
    );
  });

  const updated = await repository.findById(id);
  return serializeDigitalDocumentAccessRequest(req, updated);
};

exports.reject = async ({ req, id, payload, userId }) => {
  if (!userId) {
    throw new AppError("User tidak dikenali", 401);
  }

  const item = await repository.findById(id);
  if (!item) {
    throw new AppError("Pengajuan akses dokumen tidak ditemukan", 404);
  }

  if (item.status !== "PENDING") {
    throw new AppError("Pengajuan akses sudah diproses", 409);
  }

  await assertAccessRequestActionActor({
    item,
    userId,
    feature: REJECT_FEATURE,
  });

  await repository.withTransaction(async (client) => {
    const actedAt = new Date();
    const result = await repository.update(
      id,
      {
        status: "REJECTED",
        action_note: normalizeText(payload.action_note),
        acted_by: userId,
        acted_at: actedAt,
        rejected_at: actedAt,
      },
      client,
    );

    await digitalDocumentRepository.createActivityLog(
      {
        document_id: result.document_id,
        actor_id: userId,
        action: "ACCESS_REJECTED",
        to_storage_id: item.document.storage_id,
        reference_type: "ACCESS_REQUEST",
        reference_id: result.id,
        description: "Akses dokumen ditolak",
      },
      client,
    );
  });

  const updated = await repository.findById(id);
  return serializeDigitalDocumentAccessRequest(req, updated);
};
