const repository = require("./digitalDocumentLoans.repository");
const digitalDocumentRepository = require("../digital-documents/digitalDocuments.repository");
const { AppError } = require("../../utils/errors");
const {
  serializeDigitalDocumentLoan,
} = require("../../utils/digital-archive-serializer");
const {
  getDigitalArchiveAccessScope,
  buildDocumentVisibilityWhere,
} = require("../../utils/digital-archive-access");

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
    where.status = "BORROWED";
    where.requested_due_date = {
      lt: new Date(),
    };
  }

  return where;
}

function buildVisibilityWhere(scope, userId) {
  if (scope?.canAccessRestricted) {
    return {};
  }

  const visibleDocumentWhere = {
    document: buildDocumentVisibilityWhere(scope),
  };

  if (!userId) {
    return visibleDocumentWhere;
  }

  return {
    OR: [
      visibleDocumentWhere,
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

function canViewLoan(item, scope, userId) {
  if (!item) return false;
  if (scope?.canAccessRestricted) return true;
  if (!item.document?.is_restricted) return true;
  if (!userId) return false;

  return (
    item.borrower_id === userId ||
    item.approved_by === userId ||
    item.rejected_by === userId ||
    item.handed_over_by === userId ||
    item.returned_by === userId ||
    item.document?.created_by === userId
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

exports.getAll = async ({ req, query, userId }) => {
  const scope = await getDigitalArchiveAccessScope(userId);
  const where = {
    AND: [buildWhere(query, userId), buildVisibilityWhere(scope, userId)],
  };
  const page = parsePositiveInteger(query.page, 1);
  const limit = Math.min(parsePositiveInteger(query.limit, 20), 100);
  const skip = (page - 1) * limit;

  const data = await repository.findMany({ where, skip, take: limit });
  const total = await repository.count(where);

  return {
    data: data.map((item) => serializeDigitalDocumentLoan(req, item)),
    meta: {
      total,
      page,
      lastPage: Math.ceil(total / limit),
    },
  };
};

exports.getById = async ({ req, id, userId }) => {
  const item = await repository.findById(id);
  if (!item) {
    throw new AppError("Peminjaman dokumen tidak ditemukan", 404);
  }

  const scope = await getDigitalArchiveAccessScope(userId);
  if (!canViewLoan(item, scope, userId)) {
    throw new AppError("Peminjaman dokumen tidak ditemukan", 404);
  }

  return serializeDigitalDocumentLoan(req, item);
};

exports.create = async ({ req, payload, userId }) => {
  if (!userId) {
    throw new AppError("User tidak dikenali", 401);
  }

  const scope = await getDigitalArchiveAccessScope(userId);
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

  const items = [];
  for (const createdId of createdIds) {
    const item = await repository.findById(createdId);
    if (item) {
      items.push(item);
    }
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
        status: "BORROWED",
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

  if (item.status !== "BORROWED") {
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
  return serializeDigitalDocumentLoan(req, updated);
};
