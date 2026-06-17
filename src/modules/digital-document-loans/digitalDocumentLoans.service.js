const repository = require("./digitalDocumentLoans.repository");
const digitalDocumentRepository = require("../digital-documents/digitalDocuments.repository");
const notificationService = require("../notifications/notifications.service");
const { AppError } = require("../../utils/errors");
const {
  serializeDigitalDocumentLoan,
} = require("../../utils/digital-archive-serializer");
const {
  getDigitalArchiveAccessScope,
  buildDocumentVisibilityWhere,
  canScopeAccessDocument,
} = require("../../utils/digital-archive-access");
const {
  APPROVE_FEATURE,
  HANDOVER_FEATURE,
  REJECT_FEATURE,
  RETURN_FEATURE,
} = require("../../utils/menu-access");
const { roleHasFeature, roleHasPermission } = require("../../utils/rbac");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  resolvePagination,
} = require("../../utils/pagination");

const LOAN_ACTION_URL = "/dashboard/arsip-digital/peminjaman/accept";
const LOAN_READ_URLS = [
  "/dashboard/arsip-digital/peminjaman/request",
  "/dashboard/arsip-digital/peminjaman/accept",
  "/dashboard/arsip-digital/historis/peminjaman",
  "/dashboard/arsip-digital/ruang-arsip/jatuh-tempo",
];
const LOAN_REQUEST_URL = "/dashboard/arsip-digital/peminjaman/request";

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function buildDateRange(start, end) {
  const range = {};

  if (start) {
    const parsedStart = new Date(start);
    if (!Number.isNaN(parsedStart.getTime())) {
      range.gte = parsedStart;
    }
  }

  if (end) {
    const parsedEnd = new Date(end);
    if (!Number.isNaN(parsedEnd.getTime())) {
      range.lte = parsedEnd;
    }
  }

  return range;
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
        borrower: {
          name: {
            contains: normalized,
            mode: "insensitive",
          },
        },
      },
      {
        borrower: {
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

  if (query.status) {
    const status = String(query.status).trim().toUpperCase();
    if (status === "OVERDUE" || status === "TERLAMBAT") {
      where.status = {
        in: ["HANDED_OVER", "BORROWED"],
      };
      where.requested_due_date = {
        lt: new Date(),
      };
    } else if (status === "ACTIVE" || status === "AKTIF") {
      where.status = {
        in: ["HANDED_OVER", "BORROWED"],
      };
    } else {
      where.status = status;
    }
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

  if (
    String(query.scope || "")
      .trim()
      .toLowerCase() === "borrower"
  ) {
    where.borrower_id = userId;
  }

  if (
    String(query.report || "")
      .trim()
      .toLowerCase() === "history"
  ) {
    where.status = {
      in: ["REJECTED", "RETURNED"],
    };
  }

  if (
    String(query.report || "")
      .trim()
      .toLowerCase() === "overdue"
  ) {
    where.status = {
      in: ["HANDED_OVER", "BORROWED"],
    };
    where.requested_due_date = {
      lt: new Date(),
    };
  }

  const startDateRange = buildDateRange(
    query.requested_start_date_from || query.start_date_from || query.date_from,
    query.requested_start_date_to || query.start_date_to || query.date_to,
  );
  if (Object.keys(startDateRange).length > 0) {
    where.requested_start_date = {
      ...(where.requested_start_date || {}),
      ...startDateRange,
    };
  }

  const dueDateRange = buildDateRange(
    query.requested_due_date_from || query.due_date_from,
    query.requested_due_date_to || query.due_date_to,
  );
  if (Object.keys(dueDateRange).length > 0) {
    where.requested_due_date = {
      ...(where.requested_due_date || {}),
      ...dueDateRange,
    };
  }

  switch (
    String(query.due_status || "")
      .trim()
      .toUpperCase()
  ) {
    case "OVERDUE":
      where.status = {
        in: ["HANDED_OVER", "BORROWED"],
      };
      where.requested_due_date = {
        ...(where.requested_due_date || {}),
        lt: new Date(),
      };
      break;
    case "UPCOMING": {
      const nextThirtyDays = new Date();
      nextThirtyDays.setDate(nextThirtyDays.getDate() + 30);
      where.status = {
        in: ["HANDED_OVER", "BORROWED"],
      };
      where.requested_due_date = {
        ...(where.requested_due_date || {}),
        gte: new Date(),
        lte: nextThirtyDays,
      };
      break;
    }
    default:
      break;
  }

  return where;
}

async function getLoanActionAccess(scope) {
  const [
    canReadActionQueue,
    canApprove,
    canReject,
    canHandover,
    canReturn,
  ] = await Promise.all([
    roleHasPermission(scope?.roleId, LOAN_ACTION_URL, "read"),
    roleHasFeature(scope?.roleId, LOAN_ACTION_URL, APPROVE_FEATURE),
    roleHasFeature(scope?.roleId, LOAN_ACTION_URL, REJECT_FEATURE),
    roleHasFeature(scope?.roleId, LOAN_ACTION_URL, HANDOVER_FEATURE),
    roleHasFeature(scope?.roleId, LOAN_ACTION_URL, RETURN_FEATURE),
  ]);
  const actionableStatuses = new Set();

  if (canApprove || canReject) {
    actionableStatuses.add("PENDING");
  }
  if (canHandover) {
    actionableStatuses.add("APPROVED");
  }
  if (canReturn) {
    actionableStatuses.add("HANDED_OVER");
    actionableStatuses.add("BORROWED");
  }

  return {
    canReadActionQueue: Boolean(canReadActionQueue && actionableStatuses.size > 0),
    actionableStatuses: Array.from(actionableStatuses),
  };
}

function canAccessRestrictedDocuments(scope) {
  return Boolean(
    scope?.canAccessRestrictedDocuments ?? scope?.canAccessRestricted,
  );
}

function buildActionQueueWhere(scope, actionAccess = {}) {
  return {
    status: {
      in: actionAccess.actionableStatuses || [],
    },
    ...(canAccessRestrictedDocuments(scope)
      ? {}
      : {
          document: {
            access_level: "NON_RESTRICT",
          },
        }),
  };
}

function canViewActionQueueItem(item, scope, actionAccess = {}) {
  if (
    !actionAccess.canReadActionQueue ||
    !actionAccess.actionableStatuses?.includes(item?.status)
  ) {
    return false;
  }

  const document = item.document;
  const isRestricted =
    document?.access_level === "RESTRICT" || document?.is_restricted === true;

  return !isRestricted || canAccessRestrictedDocuments(scope);
}

function buildVisibilityWhere(scope, userId, actionAccess = {}) {
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
      ...(actionAccess.canReadActionQueue
        ? [buildActionQueueWhere(scope, actionAccess)]
        : []),
      {
        borrower_id: userId,
      },
      {
        approved_by: userId,
      },
      {
        rejected_by: userId,
      },
      {
        handed_over_by: userId,
      },
      {
        returned_by: userId,
      },
    ],
  };
}

function canViewLoan(item, scope, userId, actionAccess = {}) {
  if (!item) return false;
  if (scope?.canViewAllDocuments) {
    return canScopeAccessDocument(item.document, scope);
  }
  if (!userId) return false;
  if (canViewActionQueueItem(item, scope, actionAccess)) {
    return true;
  }

  return (
    item.borrower_id === userId ||
    item.approved_by === userId ||
    item.rejected_by === userId ||
    item.handed_over_by === userId ||
    item.returned_by === userId ||
    canScopeAccessDocument(item.document, scope)
  );
}

function validateLoanRequestDates(payload) {
  const startDate = new Date(payload.requested_start_date);
  const dueDate = new Date(payload.requested_due_date);

  if (dueDate.getTime() < startDate.getTime()) {
    throw new AppError(
      "Tanggal pengembalian tidak boleh lebih awal dari tanggal peminjaman",
      422,
    );
  }
}

async function assertLoanActionActor({ item, userId, feature }) {
  if (item.borrower_id === userId) {
    throw new AppError(
      "Peminjam tidak dapat memproses pengajuan peminjaman miliknya sendiri",
      403,
    );
  }

  const scope = await getDigitalArchiveAccessScope(userId, LOAN_ACTION_URL);
  const [canUpdate, hasFeature] = await Promise.all([
    roleHasPermission(scope.roleId, LOAN_ACTION_URL, "update"),
    roleHasFeature(scope.roleId, LOAN_ACTION_URL, feature),
  ]);

  if (!canUpdate || !hasFeature) {
    throw new AppError(
      "Anda tidak memiliki izin untuk memproses peminjaman fisik",
      403,
    );
  }

  if (
    hasFeature &&
    canViewActionQueueItem(item, scope, {
      canReadActionQueue: true,
      actionableStatuses: [item.status],
    })
  ) {
    return;
  }

  if (canScopeAccessDocument(item.document, scope)) return;

  throw new AppError("Peminjaman dokumen tidak ditemukan", 404);
}

exports.getAll = async ({ req, query, userId, scopeOverride = null }) => {
  const scope =
    scopeOverride ||
    (await getDigitalArchiveAccessScope(userId, LOAN_READ_URLS));
  const actionAccess = await getLoanActionAccess(scope);
  const where = {
    AND: [buildWhere(query, userId), buildVisibilityWhere(scope, userId, actionAccess)],
  };
  const pagination = resolvePagination(query, {
    ...PAGINATION_PROFILES.TABLE,
    allowAll: true,
  });

  if (pagination.all) {
    const data = await repository.findMany({ where });
    return {
      data: data.map((item) => serializeDigitalDocumentLoan(req, item)),
    };
  }

  const data = await repository.findMany({
    where,
    skip: pagination.skip,
    take: pagination.take,
  });
  const total = await repository.count(where);

  return {
    data: data.map((item) => serializeDigitalDocumentLoan(req, item)),
    meta: buildPaginationMeta(total, pagination),
  };
};

exports.getById = async ({ req, id, userId }) => {
  const item = await repository.findById(id);
  if (!item) {
    throw new AppError("Peminjaman dokumen tidak ditemukan", 404);
  }

  const scope = await getDigitalArchiveAccessScope(userId, LOAN_READ_URLS);
  const actionAccess = await getLoanActionAccess(scope);
  if (!canViewLoan(item, scope, userId, actionAccess)) {
    throw new AppError("Peminjaman dokumen tidak ditemukan", 404);
  }

  return serializeDigitalDocumentLoan(req, item);
};

exports.create = async ({ req, payload, userId }) => {
  if (!userId) {
    throw new AppError("User tidak dikenali", 401);
  }

  const scope = await getDigitalArchiveAccessScope(userId, LOAN_REQUEST_URL);
  const visibilityWhere = buildDocumentVisibilityWhere(scope);
  const documentIds = Array.from(new Set(payload.document_ids));
  const createdIds = [];

  validateLoanRequestDates(payload);

  await repository.withTransaction(async (client) => {
    for (const documentId of documentIds) {
      const document = await digitalDocumentRepository.findById(documentId, {
        deleted_at: null,
        ...visibilityWhere,
      });

      if (!document) {
        throw new AppError("Dokumen yang diajukan tidak ditemukan", 404);
      }

      const existingActiveLoan = await repository.findActiveByDocumentId(
        document.id,
        client,
      );

      if (existingActiveLoan) {
        throw new AppError(
          `Dokumen ${document.document_number} sedang memiliki proses peminjaman aktif`,
          409,
        );
      }

      const created = await repository.create(
        {
          document_id: document.id,
          borrower_id: userId,
          request_reason: normalizeText(payload.request_reason),
          requested_start_date: new Date(payload.requested_start_date),
          requested_due_date: new Date(payload.requested_due_date),
        },
        client,
      );

      await digitalDocumentRepository.createActivityLog(
        {
          document_id: document.id,
          actor_id: userId,
          action: "LOAN_REQUESTED",
          to_storage_id: document.storage_id,
          reference_type: "LOAN",
          reference_id: created.id,
          description: "Pengajuan peminjaman dokumen dibuat",
        },
        client,
      );

      createdIds.push(created.id);
    }
  });

  const items = await repository.findManyByIds(createdIds);
  for (const item of items) {
    await notificationService.notifyArchiveLoanRequested({
      item,
      actorId: userId,
    });
  }

  return {
    count: items.length,
    items: items.map((item) => serializeDigitalDocumentLoan(req, item)),
  };
};

exports.approve = async ({ req, id, payload, userId }) => {
  if (!userId) {
    throw new AppError("User tidak dikenali", 401);
  }

  const item = await repository.findById(id);
  if (!item) {
    throw new AppError("Peminjaman dokumen tidak ditemukan", 404);
  }

  await assertLoanActionActor({
    item,
    userId,
    feature: APPROVE_FEATURE,
  });

  if (item.status !== "PENDING") {
    throw new AppError("Peminjaman dokumen sudah diproses", 409);
  }

  await repository.withTransaction(async (client) => {
    const result = await repository.update(
      id,
      {
        status: "APPROVED",
        approved_by: userId,
        approved_at: new Date(),
        approval_note: normalizeText(payload.approval_note),
      },
      client,
    );

    await digitalDocumentRepository.createActivityLog(
      {
        document_id: result.document_id,
        actor_id: userId,
        action: "LOAN_APPROVED",
        to_storage_id: item.document.storage_id,
        reference_type: "LOAN",
        reference_id: result.id,
        description: "Pengajuan peminjaman disetujui",
      },
      client,
    );
  });

  const updated = await repository.findById(id);
  await notificationService.notifyArchiveLoanResolved({
    item: updated,
    actorId: userId,
    status: "APPROVED",
  });
  return serializeDigitalDocumentLoan(req, updated);
};

exports.reject = async ({ req, id, payload, userId }) => {
  if (!userId) {
    throw new AppError("User tidak dikenali", 401);
  }

  const item = await repository.findById(id);
  if (!item) {
    throw new AppError("Peminjaman dokumen tidak ditemukan", 404);
  }

  await assertLoanActionActor({
    item,
    userId,
    feature: REJECT_FEATURE,
  });

  if (item.status !== "PENDING") {
    throw new AppError("Peminjaman dokumen sudah diproses", 409);
  }

  await repository.withTransaction(async (client) => {
    const result = await repository.update(
      id,
      {
        status: "REJECTED",
        rejected_by: userId,
        rejected_at: new Date(),
        rejection_note: normalizeText(payload.rejection_note),
      },
      client,
    );

    await digitalDocumentRepository.createActivityLog(
      {
        document_id: result.document_id,
        actor_id: userId,
        action: "LOAN_REJECTED",
        to_storage_id: item.document.storage_id,
        reference_type: "LOAN",
        reference_id: result.id,
        description: "Pengajuan peminjaman ditolak",
      },
      client,
    );
  });

  const updated = await repository.findById(id);
  await notificationService.notifyArchiveLoanResolved({
    item: updated,
    actorId: userId,
    status: "REJECTED",
  });
  return serializeDigitalDocumentLoan(req, updated);
};

exports.handover = async ({ req, id, payload, userId }) => {
  if (!userId) {
    throw new AppError("User tidak dikenali", 401);
  }

  const item = await repository.findById(id);
  if (!item) {
    throw new AppError("Peminjaman dokumen tidak ditemukan", 404);
  }

  await assertLoanActionActor({
    item,
    userId,
    feature: HANDOVER_FEATURE,
  });

  if (item.status !== "APPROVED") {
    throw new AppError("Dokumen hanya bisa diserahkan setelah disetujui", 409);
  }

  const handoverAt = new Date(payload.handover_at);
  if (
    item.approved_at &&
    handoverAt.getTime() < new Date(item.approved_at).getTime()
  ) {
    throw new AppError(
      "Tanggal penyerahan tidak boleh lebih awal dari waktu persetujuan",
      422,
    );
  }

  await repository.withTransaction(async (client) => {
    const result = await repository.update(
      id,
      {
        status: "HANDED_OVER",
        handed_over_by: userId,
        handover_at: handoverAt,
        handover_note: normalizeText(payload.handover_note),
      },
      client,
    );

    await digitalDocumentRepository.createActivityLog(
      {
        document_id: result.document_id,
        actor_id: userId,
        action: "LOAN_HANDED_OVER",
        to_storage_id: item.document.storage_id,
        reference_type: "LOAN",
        reference_id: result.id,
        description: "Dokumen diserahkan kepada peminjam",
      },
      client,
    );
  });

  const updated = await repository.findById(id);
  await notificationService.notifyArchiveLoanResolved({
    item: updated,
    actorId: userId,
    status: "HANDED_OVER",
  });
  return serializeDigitalDocumentLoan(req, updated);
};

exports.returnLoan = async ({ req, id, payload, userId }) => {
  if (!userId) {
    throw new AppError("User tidak dikenali", 401);
  }

  const item = await repository.findById(id);
  if (!item) {
    throw new AppError("Peminjaman dokumen tidak ditemukan", 404);
  }

  await assertLoanActionActor({
    item,
    userId,
    feature: RETURN_FEATURE,
  });

  if (!["HANDED_OVER", "BORROWED"].includes(item.status)) {
    throw new AppError(
      "Hanya dokumen yang sedang dipinjam yang dapat dikembalikan",
      409,
    );
  }

  const returnedAt = new Date(payload.returned_at);
  if (
    item.handover_at &&
    returnedAt.getTime() < new Date(item.handover_at).getTime()
  ) {
    throw new AppError(
      "Tanggal pengembalian tidak boleh lebih awal dari waktu penyerahan",
      422,
    );
  }

  await repository.withTransaction(async (client) => {
    const result = await repository.update(
      id,
      {
        status: "RETURNED",
        returned_by: userId,
        returned_at: returnedAt,
        return_note: normalizeText(payload.return_note),
      },
      client,
    );

    await digitalDocumentRepository.createActivityLog(
      {
        document_id: result.document_id,
        actor_id: userId,
        action: "LOAN_RETURNED",
        to_storage_id: item.document.storage_id,
        reference_type: "LOAN",
        reference_id: result.id,
        description: "Dokumen dikembalikan",
      },
      client,
    );
  });

  const updated = await repository.findById(id);
  await notificationService.notifyArchiveLoanReturned({
    item: updated,
    actorId: userId,
  });
  return serializeDigitalDocumentLoan(req, updated);
};
