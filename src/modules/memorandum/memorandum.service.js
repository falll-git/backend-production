const repository = require("./memorandum.repository");
const {
  deleteStoredFile,
  persistPersuratanFile,
} = require("../../utils/persuratan-files");
const {
  serializeMemorandum,
  serializeMemorandumDisposition,
} = require("../../utils/persuratan-serializer");
const {
  resolveActiveDivisionManager,
} = require("../../utils/manager-assignment");
const {
  normalizeMailWorkflowStatus,
} = require("../../utils/persuratan-status");

const ACTIVE_DISPOSITION_STATUSES = new Set(["NEW", "IN_PROGRESS"]);

function normalizeText(value) {
  if (typeof value !== "string") return value ?? null;

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeDate(value) {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Tanggal tidak valid");
  }

  return date;
}

function normalizeOptionalDate(value) {
  if (!value) return null;
  return normalizeDate(value);
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

function parsePagination({ page, limit }) {
  if (!page && !limit) {
    return { enabled: false, page: 1, limit: 0 };
  }

  return {
    enabled: true,
    page: Math.max(Number(page) || 1, 1),
    limit: Math.max(Number(limit) || 10, 1),
  };
}

function paginateData(data, pagination) {
  if (!pagination.enabled) {
    return { data, meta: null };
  }

  const startIndex = (pagination.page - 1) * pagination.limit;
  const paginatedData = data.slice(startIndex, startIndex + pagination.limit);

  return {
    data: paginatedData,
    meta: {
      total: data.length,
      page: pagination.page,
      lastPage: Math.ceil(data.length / pagination.limit) || 1,
    },
  };
}

function buildWhere({ search, dateFrom, dateTo, divisionId, receiverId }) {
  const where = {
    deleted_at: null,
  };

  if (search) {
    where.OR = [
      { memo_number: { contains: search, mode: "insensitive" } },
      { regarding: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { division: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  if (divisionId) {
    where.division_id = divisionId;
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
      updateStoredPath: (storedPath) =>
        repository.updateStoredFile(record.id, storedPath),
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

exports.getMemorandums = async ({ req, query, userId }) => {
  const receiverId =
    normalizeText(query.receiver_id) ||
    (String(query.assigned_to_me).toLowerCase() === "true" ? userId : null);
  const where = buildWhere({
    search: normalizeText(query.search),
    dateFrom: query.date_from,
    dateTo: query.date_to,
    divisionId: normalizeText(query.division_id),
    receiverId,
  });

  const records = await repository.findMany({ where });
  const serialized = await serializeList(req, records);
  const filtered = filterByStatus(serialized, query.status);

  return paginateData(
    filtered,
    parsePagination({ page: query.page, limit: query.limit }),
  );
};

exports.getMemorandumById = async ({ req, id }) => {
  const memorandum = await repository.findById(id);

  if (!memorandum) {
    throw new Error("Memorandum tidak ditemukan");
  }

  return serializeMemorandum({
    req,
    record: memorandum,
    updateStoredPath: (storedPath) =>
      repository.updateStoredFile(id, storedPath),
  });
};

exports.createMemorandum = async ({ req, payload, userId }) => {
  const { manager } = await resolveActiveDivisionManager(payload.division_id);
  const storedFile = persistPersuratanFile({
    entity: "memorandums",
    input: payload.file,
    previousPath: null,
    fallbackBaseName: payload.memo_number || payload.regarding || "memorandum",
  });

  const memorandumData = {
    division_id: payload.division_id,
    memo_number: normalizeText(payload.memo_number),
    memo_date: normalizeDate(payload.memo_date),
    received_date: normalizeDate(payload.received_date),
    due_date: normalizeOptionalDate(payload.due_date),
    regarding: normalizeText(payload.regarding),
    description: normalizeText(payload.description),
    file: storedFile.storedPath,
    status: "IN_PROGRESS",
    created_by: userId,
  };

  const receiversData = [
    {
      receiver_id: manager.id,
      sender_id: userId,
      parent_disposition_id: null,
      start_date: null,
      due_date: normalizeOptionalDate(payload.due_date),
      note: null,
      status: "NEW",
    },
  ];

  const created = await repository.createWithInitialReceivers(
    memorandumData,
    receiversData,
  );

  return serializeMemorandum({
    req,
    record: created,
    updateStoredPath: (storedPath) =>
      repository.updateStoredFile(created.id, storedPath),
  });
};

exports.redispose = async ({ id, payload, senderId }) => {
  const memorandum = await repository.findById(id);

  if (!memorandum) {
    throw new Error("Memorandum tidak ditemukan");
  }

  if (normalizeMailWorkflowStatus(memorandum.status) === "COMPLETED") {
    throw new Error("Memorandum yang sudah selesai tidak bisa redisposisi");
  }

  const currentDisposition = await repository.findCurrentDispositionForReceiver(
    {
      memorandumId: id,
      receiverId: senderId,
    },
  );

  if (!currentDisposition) {
    throw new Error(
      "Hanya pemegang disposisi aktif yang dapat meneruskan redisposisi",
    );
  }

  await repository.updateDisposition(currentDisposition.id, {
    status: "FORWARDED",
    is_complete: true,
  });

  const disposition = await repository.createDisposition({
    memorandums_id: id,
    sender_id: senderId,
    receiver_id: payload.receiver_id,
    parent_disposition_id: currentDisposition.id,
    note: normalizeText(payload.note),
    start_date: normalizeOptionalDate(payload.start_date),
    due_date: normalizeOptionalDate(payload.due_date),
    status: payload.start_date ? "IN_PROGRESS" : "NEW",
  });

  await repository.update(id, { status: "IN_PROGRESS" });

  return serializeMemorandumDisposition(disposition, 1);
};

exports.completeMemorandum = async ({ req, memoId, userId }) => {
  const memorandum = await repository.findById(memoId);

  if (!memorandum) {
    throw new Error("Memorandum tidak ditemukan");
  }

  await repository.completeDispositions(memoId);
  const updated = await repository.update(memoId, {
    status: "COMPLETED",
    updated_by: userId,
  });

  return serializeMemorandum({
    req,
    record: updated,
    updateStoredPath: (storedPath) =>
      repository.updateStoredFile(memoId, storedPath),
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
    throw new Error("Memorandum tidak ditemukan");
  }

  const disposition = await repository.findDispositionById({
    memorandumId,
    dispositionId,
  });

  if (!disposition) {
    throw new Error("Disposisi memorandum tidak ditemukan");
  }

  if (disposition.receiver_id !== userId) {
    throw new Error("Hanya penerima disposisi yang dapat memperbarui status");
  }

  const normalizedStatus = String(status || "")
    .trim()
    .toUpperCase();
  const currentStatus = String(disposition.status || "")
    .trim()
    .toUpperCase();

  if (!["IN_PROGRESS", "COMPLETED"].includes(normalizedStatus)) {
    throw new Error("Status disposisi tidak valid");
  }

  if (currentStatus === "FORWARDED") {
    throw new Error("Disposisi yang sudah diteruskan tidak dapat diperbarui");
  }

  if (currentStatus === "COMPLETED") {
    throw new Error("Disposisi yang sudah selesai tidak dapat diperbarui");
  }

  if (normalizedStatus === "IN_PROGRESS" && currentStatus !== "NEW") {
    throw new Error("Hanya disposisi baru yang dapat diproses");
  }

  if (
    normalizedStatus === "COMPLETED" &&
    !["NEW", "IN_PROGRESS"].includes(currentStatus)
  ) {
    throw new Error("Disposisi tidak dapat ditandai selesai");
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
    updateStoredPath: (storedPath) =>
      repository.updateStoredFile(memorandumId, storedPath),
  });
};

exports.updateMemorandum = async ({ req, id, payload, userId }) => {
  const memorandum = await repository.findById(id);

  if (!memorandum) {
    throw new Error("Memorandum tidak ditemukan");
  }

  if (normalizeMailWorkflowStatus(memorandum.status) === "COMPLETED") {
    throw new Error("Memorandum yang sudah selesai tidak bisa diubah");
  }

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

  if (
    payload.division_id !== undefined &&
    payload.division_id !== memorandum.division_id
  ) {
    throw new Error("Divisi tujuan memorandum tidak dapat diubah");
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
  if (payload.due_date !== undefined) {
    updateData.due_date = normalizeOptionalDate(payload.due_date);
  }
  if (payload.regarding !== undefined) {
    updateData.regarding = normalizeText(payload.regarding);
  }
  if (payload.description !== undefined) {
    updateData.description = normalizeText(payload.description);
  }
  if (payload.file !== undefined) {
    updateData.file = storedFile.storedPath;
  }
  if (payload.status !== undefined) {
    updateData.status = normalizeMailWorkflowStatus(payload.status);
  }

  const updated = await repository.update(id, updateData);

  return serializeMemorandum({
    req,
    record: updated,
    updateStoredPath: (storedPath) =>
      repository.updateStoredFile(id, storedPath),
  });
};

exports.deleteMemorandum = async (id, userId) => {
  const memorandum = await repository.findById(id);

  if (!memorandum) {
    throw new Error("Memorandum tidak ditemukan");
  }

  if (memorandum.file && memorandum.file.startsWith("/api/persuratan-files/")) {
    deleteStoredFile(memorandum.file);
  }

  return repository.delete(id, userId);
};
