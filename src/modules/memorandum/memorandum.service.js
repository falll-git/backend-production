const repository = require("./memorandum.repository");
const userRepository = require("../user/user.repository");
const {
  deleteReplacedStoredFile,
  deleteStoredFile,
  persistPersuratanFile,
} = require("../../utils/persuratan-files");
const {
  serializeMemorandum,
  serializeMemorandumDisposition,
} = require("../../utils/persuratan-serializer");
const { mapPersuratanPrismaError } = require("../../utils/persuratan-errors");
const {
  buildTargetDivisionDataFromAssignments,
  resolveActiveDivisionManagers,
} = require("../../utils/manager-assignment");
const {
  normalizeMailWorkflowStatus,
} = require("../../utils/persuratan-status");
const { serializeRole } = require("../../utils/role-types");
const { AppError } = require("../../utils/errors");
const {
  buildMemorandumVisibilityWhere,
  canManageMemorandum,
  canViewMemorandum,
  getPersuratanAccessScope,
} = require("../../utils/persuratan-access");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  paginateArray,
  resolvePagination,
} = require("../../utils/pagination");
const {
  resolveActiveStorageId,
} = require("../../utils/persuratan-storage");
const {
  enqueueRecordWatermark,
} = require("../watermark-settings/watermarkProcessor.service");
const { toSizeBytesBigInt } = require("../../utils/size-bytes");

const ACTIVE_DISPOSITION_STATUSES = new Set(["NEW", "IN_PROGRESS"]);
const MEMORANDUM_MENU_URL =
  "/dashboard/manajemen-surat/kelola-surat/input-memorandum";

async function queueMemorandumWatermark(entityId) {
  try {
    await enqueueRecordWatermark({
      module: "memorandum",
      entityId,
    });
  } catch (error) {
    console.error("Failed to queue memorandum watermark:", error);
  }
}

function normalizeText(value) {
  if (typeof value !== "string") return value ?? null;

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function serializeAssignableUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    phone: user.phone,
    role_id: user.role_id,
    division_id: user.division_id,
    role: serializeRole(user.role),
    division: user.division || null,
  };
}

function normalizeDate(value) {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Format tanggal tidak valid.");
  }

  return date;
}

function normalizeOptionalDate(value) {
  if (!value) return null;
  return normalizeDate(value);
}

function normalizeDivisionIdsInput(value) {
  const source = Array.isArray(value) ? value : [value];
  const normalized = [];

  for (const item of source) {
    if (Array.isArray(item)) {
      normalized.push(...normalizeDivisionIdsInput(item));
      continue;
    }

    if (typeof item !== "string") {
      if (item !== undefined && item !== null) {
        normalized.push(String(item).trim());
      }
      continue;
    }

    const trimmed = item.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        normalized.push(...normalizeDivisionIdsInput(parsed));
        continue;
      }
    } catch {
    }

    normalized.push(
      ...trimmed
        .split(",")
        .map((divisionId) => divisionId.trim())
        .filter(Boolean),
    );
  }

  return [...new Set(normalized.filter(Boolean))];
}

function resolveTargetDivisionIds(payload) {
  return normalizeDivisionIdsInput([
    ...(payload.target_division_ids !== undefined
      ? [payload.target_division_ids]
      : []),
    ...(payload.target_division_id !== undefined
      ? [payload.target_division_id]
      : []),
  ]);
}

function normalizeReceiverIdsInput(payload) {
  const receiverIds = [
    ...(Array.isArray(payload.receiver_ids) ? payload.receiver_ids : []),
    ...(payload.receiver_id ? [payload.receiver_id] : []),
  ]
    .map((receiverId) =>
      typeof receiverId === "string" ? receiverId.trim() : "",
    )
    .filter(Boolean);

  return [...new Set(receiverIds)];
}

function appendAndFilter(where, condition) {
  where.AND = Array.isArray(where.AND) ? where.AND : [];
  where.AND.push(condition);
}

function isActiveDispositionStatus(status) {
  return ACTIVE_DISPOSITION_STATUSES.has(String(status || "").toUpperCase());
}

function resolveDocumentStatusFromDispositions(dispositions) {
  const activeDispositions = dispositions.filter((item) =>
    isActiveDispositionStatus(item.status),
  );

  if (activeDispositions.length === 0) {
    return "COMPLETED";
  }

  const hasOverdue = activeDispositions.some((item) => {
    if (!item.due_date) return false;

    const dueDate = new Date(item.due_date);
    return !Number.isNaN(dueDate.getTime()) && dueDate.getTime() < Date.now();
  });

  return hasOverdue ? "OVERDUE" : "IN_PROGRESS";
}

function buildWhere({
  search,
  dateFrom,
  dateTo,
  divisionId,
  originDivisionId,
  targetDivisionId,
  receiverId,
}) {
  const where = {
    deleted_at: null,
  };

  if (search) {
    where.OR = [
      { memo_number: { contains: search, mode: "insensitive" } },
      { regarding: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { origin_division: { name: { contains: search, mode: "insensitive" } } },
      { storage: { is: { name: { contains: search, mode: "insensitive" } } } },
      {
        storage: {
          is: {
            cabinet: {
              is: { code: { contains: search, mode: "insensitive" } },
            },
          },
        },
      },
      {
        storage: {
          is: {
            cabinet: {
              is: {
                office: {
                  is: { name: { contains: search, mode: "insensitive" } },
                },
              },
            },
          },
        },
      },
      {
        target_divisions: {
          some: {
            division: { name: { contains: search, mode: "insensitive" } },
          },
        },
      },
    ];
  }

  if (divisionId) {
    appendAndFilter(where, {
      OR: [
        { origin_division_id: divisionId },
        {
          target_divisions: {
            some: {
              division_id: divisionId,
            },
          },
        },
      ],
    });
  }

  if (originDivisionId) {
    appendAndFilter(where, {
      origin_division_id: originDivisionId,
    });
  }

  if (targetDivisionId) {
    appendAndFilter(where, {
      target_divisions: {
        some: {
          division_id: targetDivisionId,
        },
      },
    });
  }

  const memoDateFilter = {};
  if (dateFrom) {
    memoDateFilter.gte = normalizeDate(dateFrom);
  }
  if (dateTo) {
    memoDateFilter.lte = normalizeDate(dateTo);
  }
  if (Object.keys(memoDateFilter).length > 0) {
    where.memo_date = memoDateFilter;
  }

  if (receiverId) {
    where.dispositions = {
      some: {
        receiver_id: receiverId,
      },
    };
  }

  return where;
}

async function serializeList(req, records) {
  const serialized = [];

  for (const record of records) {
    const item = await serializeMemorandum({
      req,
      record,
    });

    serialized.push(item);
  }

  return serialized;
}

function filterByStatus(records, status) {
  if (status === undefined || status === null || status === "") {
    return records;
  }

  const normalized = String(status).trim().toUpperCase();

  return records.filter((item) => {
    if (normalized === "0" || normalized === "NEW") {
      return item.status_key === "NEW";
    }
    if (normalized === "1" || normalized === "IN_PROGRESS") {
      return item.status_key === "IN_PROGRESS";
    }
    if (normalized === "2" || normalized === "COMPLETED") {
      return item.status_key === "COMPLETED";
    }
    if (normalized === "3" || normalized === "OVERDUE") {
      return item.status_key === "OVERDUE";
    }

    return true;
  });
}

function hasSpecificStatusFilter(status) {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();

  return Boolean(normalized && !["ALL", "SEMUA"].includes(normalized));
}

exports.getMemorandums = async ({
  req,
  query,
  userId,
  scopeOverride = null,
}) => {
  const scope = scopeOverride || (await getPersuratanAccessScope(userId));
  const receiverId =
    normalizeText(query.receiver_id) ||
    (String(query.assigned_to_me).toLowerCase() === "true" ? userId : null);
  const where = {
    AND: [
      buildWhere({
        search: normalizeText(query.search),
        dateFrom: query.date_from,
        dateTo: query.date_to,
        divisionId: normalizeText(query.division_id),
        originDivisionId: normalizeText(query.origin_division_id),
        targetDivisionId: normalizeText(query.target_division_id),
        receiverId,
      }),
      buildMemorandumVisibilityWhere(scope),
    ],
  };

  const pagination = resolvePagination(query, {
    ...PAGINATION_PROFILES.TABLE,
    allowAll: true,
  });

  if (pagination.enabled && !hasSpecificStatusFilter(query.status)) {
    const [records, total] = await Promise.all([
      repository.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
      }),
      repository.count(where),
    ]);

    return {
      data: await serializeList(req, records),
      meta: buildPaginationMeta(total, pagination),
    };
  }

  const records = await repository.findMany({ where });
  const serialized = await serializeList(req, records);
  const filtered = filterByStatus(serialized, query.status);

  return paginateArray(filtered, pagination);
};

exports.getMemorandumById = async ({ req, id, userId }) => {
  const memorandum = await repository.findById(id);

  if (!memorandum) {
    throw new Error("Memorandum tidak ditemukan.");
  }

  const scope = await getPersuratanAccessScope(userId);
  if (!canViewMemorandum(memorandum, scope)) {
    throw new AppError("Memorandum tidak ditemukan.", 404);
  }

  return serializeMemorandum({
    req,
    record: memorandum,
  });
};

exports.getDispositionRecipients = async ({ query, currentUserId }) => {
  const recipients = await userRepository.findAssignableDispositionRecipients({
    search: normalizeText(query.search),
    divisionId: normalizeText(query.division_id),
    excludeUserId:
      String(query.exclude_self ?? "true").toLowerCase() === "false"
        ? null
        : currentUserId,
    limit: query.limit,
  });

  return recipients.map(serializeAssignableUser);
};

exports.createMemorandum = async ({ req, payload, userId }) => {
  const assignments = await resolveActiveDivisionManagers(
    resolveTargetDivisionIds(payload),
    { menuUrls: [MEMORANDUM_MENU_URL] },
  );
  const storageId = await resolveActiveStorageId(payload.storage_id);
  const storedFile = persistPersuratanFile({
    entity: "memorandums",
    input: payload.file,
    previousPath: null,
    fallbackBaseName: payload.memo_number || payload.regarding || "memorandum",
  });
  if (!storedFile.storedPath) {
    throw new Error("Dokumen memorandum wajib diunggah.");
  }

  const memorandumData = {
    origin_division_id: normalizeText(payload.origin_division_id),
    storage_id: storageId,
    memo_number: normalizeText(payload.memo_number),
    memo_date: normalizeDate(payload.memo_date),
    received_date: normalizeDate(payload.received_date),
    regarding: normalizeText(payload.regarding),
    description: normalizeText(payload.description),
    file: storedFile.storedPath,
    file_size_bytes: toSizeBytesBigInt(storedFile.sizeBytes),
    status: "IN_PROGRESS",
    created_by: userId,
  };

  const receiversData = assignments.map(({ manager }) => ({
    receiver_id: manager.id,
    sender_id: userId,
    parent_disposition_id: null,
    start_date: null,
    due_date: null,
    note: null,
    status: "NEW",
  }));
  const targetDivisionsData =
    buildTargetDivisionDataFromAssignments(assignments);

  let created;

  try {
    created = await repository.createWithInitialReceivers(
      memorandumData,
      receiversData,
      targetDivisionsData,
    );
  } catch (error) {
    if (storedFile.isNewUpload) {
      deleteStoredFile(storedFile.storedPath);
    }
    throw mapPersuratanPrismaError(error, "memorandum");
  }

  if (created?.file) {
    await queueMemorandumWatermark(created.id);
    created = await repository.findById(created.id);
  }

  return serializeMemorandum({
    req,
    record: created,
  });
};

exports.redispose = async ({ id, payload, senderId }) => {
  const memorandum = await repository.findById(id);

  if (!memorandum) {
    throw new Error("Memorandum tidak ditemukan.");
  }

  if (normalizeMailWorkflowStatus(memorandum.status) === "COMPLETED") {
    throw new Error("Memorandum yang sudah selesai tidak dapat didisposisikan.");
  }

  const currentDisposition = await repository.findCurrentDispositionForReceiver(
    {
      memorandumId: id,
      receiverId: senderId,
    },
  );

  if (!currentDisposition) {
    throw new Error(
      "Hanya pemegang disposisi aktif yang dapat meneruskan disposisi.",
    );
  }

  const receiverIds = normalizeReceiverIdsInput(payload);

  if (receiverIds.length === 0) {
    throw new Error("Penerima disposisi wajib dipilih.");
  }

  if (receiverIds.includes(senderId)) {
    throw new Error("Penerima disposisi tidak boleh diri sendiri.");
  }

  const receivers = await userRepository.findAssignableUsersByIds(receiverIds);
  const foundReceiverIds = new Set(receivers.map((receiver) => receiver.id));
  const missingReceiverIds = receiverIds.filter(
    (receiverId) => !foundReceiverIds.has(receiverId),
  );

  if (missingReceiverIds.length > 0) {
    throw new Error(
      "Penerima disposisi harus merupakan pengguna aktif dengan akun teraktivasi.",
    );
  }

  const dispositions = await repository.forwardDispositionToReceivers({
    memorandumId: id,
    currentDispositionId: currentDisposition.id,
    senderId,
    receiverIds,
    note: normalizeText(payload.note),
    startDate: normalizeOptionalDate(payload.start_date),
    dueDate: normalizeOptionalDate(payload.due_date),
  });

  return dispositions.map((disposition, index) =>
    serializeMemorandumDisposition(disposition, { sequence: index + 1 }),
  );
};

exports.completeMemorandum = async ({ req, memoId, userId }) => {
  const memorandum = await repository.findById(memoId);

  if (!memorandum) {
    throw new Error("Memorandum tidak ditemukan.");
  }

  const currentDisposition = await repository.findCurrentDispositionForReceiver({
    memorandumId: memoId,
    receiverId: userId,
  });

  if (!currentDisposition) {
    throw new AppError(
      "Hanya penerima disposisi aktif yang dapat menandai memorandum selesai.",
      403,
    );
  }

  await repository.updateDisposition(currentDisposition.id, {
    status: "COMPLETED",
    is_complete: true,
    completed_at: new Date(),
    start_date: currentDisposition.start_date || new Date(),
  });

  const refreshedMemorandum = await repository.findById(memoId);
  const updated = await repository.update(memoId, {
    status: resolveDocumentStatusFromDispositions(
      refreshedMemorandum?.dispositions || [],
    ),
    updated_by: userId,
  });

  return serializeMemorandum({
    req,
    record: updated,
  });
};

exports.updateDispositionStatus = async ({
  req,
  memorandumId,
  dispositionId,
  status,
  userId,
}) => {
  const memorandum = await repository.findById(memorandumId);

  if (!memorandum) {
    throw new Error("Memorandum tidak ditemukan.");
  }

  const disposition = await repository.findDispositionById({
    memorandumId,
    dispositionId,
  });

  if (!disposition) {
    throw new Error("Disposisi memorandum tidak ditemukan.");
  }

  if (disposition.receiver_id !== userId) {
    throw new Error("Hanya penerima disposisi yang dapat memperbarui status.");
  }

  const normalizedStatus = String(status || "")
    .trim()
    .toUpperCase();
  const currentStatus = String(disposition.status || "")
    .trim()
    .toUpperCase();

  if (!["IN_PROGRESS", "COMPLETED"].includes(normalizedStatus)) {
    throw new Error("Status disposisi tidak valid.");
  }

  if (currentStatus === "FORWARDED") {
    throw new Error("Disposisi yang sudah diteruskan tidak dapat diperbarui.");
  }

  if (currentStatus === "COMPLETED") {
    throw new Error("Disposisi yang sudah selesai tidak dapat diperbarui.");
  }

  if (normalizedStatus === "IN_PROGRESS" && currentStatus !== "NEW") {
    throw new Error("Hanya disposisi baru yang dapat diproses.");
  }

  if (
    normalizedStatus === "COMPLETED" &&
    !["NEW", "IN_PROGRESS"].includes(currentStatus)
  ) {
    throw new Error("Disposisi tidak dapat ditandai selesai.");
  }

  const updateData = {
    status: normalizedStatus,
  };

  if (normalizedStatus === "IN_PROGRESS") {
    updateData.start_date = disposition.start_date || new Date();
    updateData.is_complete = false;
    updateData.completed_at = null;
  }

  if (normalizedStatus === "COMPLETED") {
    updateData.start_date = disposition.start_date || new Date();
    updateData.is_complete = true;
    updateData.completed_at = new Date();
  }

  await repository.updateDisposition(dispositionId, updateData);

  const refreshedMemorandum = await repository.findById(memorandumId);
  await repository.update(memorandumId, {
    status: resolveDocumentStatusFromDispositions(
      refreshedMemorandum?.dispositions || [],
    ),
    updated_by: userId,
  });

  const updatedMemorandum = await repository.findById(memorandumId);
  return serializeMemorandum({
    req,
    record: updatedMemorandum,
  });
};

exports.updateMemorandum = async ({ req, id, payload, userId }) => {
  const memorandum = await repository.findById(id);

  if (!memorandum) {
    throw new Error("Memorandum tidak ditemukan.");
  }

  const scope = await getPersuratanAccessScope(userId);
  if (!canManageMemorandum(memorandum, scope)) {
    throw new AppError("Anda tidak memiliki akses untuk mengubah memorandum ini.", 403);
  }

  if (normalizeMailWorkflowStatus(memorandum.status) === "COMPLETED") {
    throw new Error("Memorandum yang sudah selesai tidak dapat diubah.");
  }

  const nextStorageId =
    payload.storage_id !== undefined
      ? await resolveActiveStorageId(payload.storage_id)
      : null;

  const storedFile = persistPersuratanFile({
    entity: "memorandums",
    input: payload.file,
    previousPath: memorandum.file,
    fallbackBaseName:
      payload.memo_number ||
      payload.regarding ||
      memorandum.memo_number ||
      memorandum.regarding ||
      "memorandum",
  });

  const updateData = {
    updated_by: userId,
  };

  if (payload.target_division_id !== undefined) {
    throw new Error("Divisi tujuan memorandum tidak dapat diubah.");
  }
  if (payload.target_division_ids !== undefined) {
    throw new Error("Divisi tujuan memorandum tidak dapat diubah.");
  }
  if (payload.origin_division_id !== undefined) {
    updateData.origin_division_id = normalizeText(payload.origin_division_id);
  }
  if (payload.storage_id !== undefined) {
    updateData.storage_id = nextStorageId;
  }
  if (payload.memo_number !== undefined) {
    updateData.memo_number = normalizeText(payload.memo_number);
  }
  if (payload.memo_date !== undefined) {
    updateData.memo_date = normalizeDate(payload.memo_date);
  }
  if (payload.received_date !== undefined) {
    updateData.received_date = normalizeDate(payload.received_date);
  }
  if (payload.regarding !== undefined) {
    updateData.regarding = normalizeText(payload.regarding);
  }
  if (payload.description !== undefined) {
    updateData.description = normalizeText(payload.description);
  }
  if (payload.file !== undefined) {
    updateData.file = storedFile.storedPath;
    updateData.file_size_bytes = toSizeBytesBigInt(
      storedFile.sizeBytes ?? memorandum.file_size_bytes ?? null,
    );
  }
  if (payload.status !== undefined) {
    updateData.status = normalizeMailWorkflowStatus(payload.status);
  }

  let updated;

  try {
    updated = await repository.update(id, updateData);
  } catch (error) {
    if (storedFile.isNewUpload) {
      deleteStoredFile(storedFile.storedPath);
    }
    throw mapPersuratanPrismaError(error, "memorandum");
  }

  if (payload.file !== undefined) {
    deleteReplacedStoredFile(memorandum.file, updated.file);
  }

  if (storedFile.isNewUpload && updated?.file) {
    await queueMemorandumWatermark(updated.id);
    updated = await repository.findById(updated.id);
  }

  return serializeMemorandum({
    req,
    record: updated,
  });
};

exports.deleteMemorandum = async (id, userId) => {
  const memorandum = await repository.findById(id);

  if (!memorandum) {
    throw new Error("Memorandum tidak ditemukan.");
  }

  const scope = await getPersuratanAccessScope(userId);
  if (!canManageMemorandum(memorandum, scope)) {
    throw new AppError("Anda tidak memiliki akses untuk menghapus memorandum ini.", 403);
  }

  const deleted = await repository.delete(id, userId);
  deleteStoredFile(memorandum.file);

  return deleted;
};
