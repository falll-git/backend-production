const repository = require("./incomingMail.repository");
const userRepository = require("../user/user.repository");
const {
  deleteReplacedStoredFile,
  deleteStoredFile,
  persistPersuratanFile,
} = require("../../utils/persuratan-files");
const {
  serializeIncomingDisposition,
  serializeIncomingMail,
} = require("../../utils/persuratan-serializer");
const { mapPersuratanPrismaError } = require("../../utils/persuratan-errors");
const {
  resolveActiveDivisionManager,
  resolveActiveDivisionManagers,
} = require("../../utils/manager-assignment");
const {
  normalizeMailWorkflowStatus,
} = require("../../utils/persuratan-status");
const { serializeRole } = require("../../utils/role-types");

const ACTIVE_DISPOSITION_STATUSES = new Set(["NEW", "IN_PROGRESS"]);

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

function parsePagination({ page, limit }) {
  if (!page && !limit) {
    return { enabled: false, page: 1, limit: 0 };
  }

  const normalizedPage = Math.max(Number(page) || 1, 1);
  const normalizedLimit = Math.max(Number(limit) || 10, 1);

  return {
    enabled: true,
    page: normalizedPage,
    limit: normalizedLimit,
  };
}

function paginateData(data, pagination) {
  if (!pagination.enabled) {
    return {
      data,
      meta: null,
    };
  }

  const startIndex = (pagination.page - 1) * pagination.limit;
  const paginatedData = data.slice(startIndex, startIndex + pagination.limit);
  const total = data.length;

  return {
    data: paginatedData,
    meta: {
      total,
      page: pagination.page,
      lastPage: Math.ceil(total / pagination.limit) || 1,
    },
  };
}

function buildWhere({
  search,
  dateFrom,
  dateTo,
  letterPrioritieId,
  divisionId,
  receiverId,
}) {
  const where = {
    deleted_at: null,
  };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { mail_number: { contains: search, mode: "insensitive" } },
      { regarding: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { address: { contains: search, mode: "insensitive" } },
    ];
  }

  if (letterPrioritieId) {
    where.letter_prioritie_id = letterPrioritieId;
  }

  if (divisionId) {
    appendAndFilter(where, {
      target_divisions: {
        some: {
          division_id: divisionId,
        },
      },
    });
  }

  const receiveDateFilter = {};
  if (dateFrom) {
    receiveDateFilter.gte = normalizeDate(dateFrom);
  }
  if (dateTo) {
    receiveDateFilter.lte = normalizeDate(dateTo);
  }
  if (Object.keys(receiveDateFilter).length > 0) {
    where.receive_date = receiveDateFilter;
  }

  if (receiverId) {
    where.disposition_mails = {
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
    const item = await serializeIncomingMail({
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

function buildIncomingMailData(payload, filePath, status) {
  return {
    letter_prioritie_id: payload.letter_prioritie_id,
    regarding: normalizeText(payload.regarding),
    description: normalizeText(payload.description),
    name: normalizeText(payload.name),
    receive_date: normalizeDate(payload.receive_date),
    address: normalizeText(payload.address),
    mail_number: normalizeText(payload.mail_number),
    file: filePath,
    status,
    created_by: payload.created_by ?? null,
  };
}

exports.getIncomingMails = async ({ req, query, userId }) => {
  const receiverId =
    normalizeText(query.receiver_id) ||
    (String(query.assigned_to_me).toLowerCase() === "true" ? userId : null);
  const where = buildWhere({
    search: normalizeText(query.search),
    dateFrom: query.date_from,
    dateTo: query.date_to,
    letterPrioritieId: normalizeText(query.letter_prioritie_id),
    divisionId: normalizeText(query.target_division_id ?? query.division_id),
    receiverId,
  });

  const records = await repository.findMany({ where });
  const serialized = await serializeList(req, records);
  const filtered = filterByStatus(serialized, query.status);
  const pagination = parsePagination({
    page: query.page,
    limit: query.limit,
  });

  return paginateData(filtered, pagination);
};

exports.getIncomingMailsById = async ({ req, id }) => {
  const incomingMail = await repository.findById(id);

  if (!incomingMail) {
    throw new Error("Surat masuk tidak ditemukan.");
  }

  return serializeIncomingMail({
    req,
    record: incomingMail,
  });
};

exports.getInitialManager = async ({ divisionId }) => {
  const { division, manager } = await resolveActiveDivisionManager(divisionId);

  return {
    division,
    manager: serializeAssignableUser(manager),
  };
};

exports.getInitialManagers = async ({ divisionIds }) => {
  const assignments = await resolveActiveDivisionManagers(
    normalizeDivisionIdsInput(divisionIds),
  );

  return {
    targets: assignments.map(({ division, manager }) => ({
      division,
      manager: serializeAssignableUser(manager),
    })),
  };
};

exports.getDispositionRecipients = async ({ query, currentUserId }) => {
  const recipients = await userRepository.findAssignableDispositionRecipients({
    search: normalizeText(query.search),
    divisionId: normalizeText(query.target_division_id ?? query.division_id),
    excludeUserId:
      String(query.exclude_self ?? "true").toLowerCase() === "false"
        ? null
        : currentUserId,
    limit: query.limit,
  });

  return recipients.map(serializeAssignableUser);
};

exports.createIncomingMailsWithDispo = async ({ req, payload, senderId }) => {
  const assignments = await resolveActiveDivisionManagers(
    resolveTargetDivisionIds(payload),
  );
  const storedFile = persistPersuratanFile({
    entity: "incoming-mails",
    input: payload.file,
    previousPath: null,
    fallbackBaseName:
      payload.mail_number || payload.regarding || payload.name || "surat-masuk",
  });
  if (!storedFile.storedPath) {
    throw new Error("Dokumen surat masuk wajib diunggah.");
  }

  const mailData = buildIncomingMailData(
    {
      ...payload,
      created_by: senderId,
    },
    storedFile.storedPath,
    "IN_PROGRESS",
  );
  const dispositionsData = assignments.map(({ manager }) => ({
    receiver_id: manager.id,
    sender_id: senderId,
    note: null,
    parent_disposition_id: null,
    start_date: null,
    due_date: null,
    status: "NEW",
    is_complete: false,
    completed_at: null,
  }));
  const targetDivisionsData = assignments.map(({ division, manager }) => ({
    division_id: division.id,
    manager_id: manager.id,
  }));

  let created;

  try {
    created = await repository.createWithDisposition(
      mailData,
      dispositionsData,
      targetDivisionsData,
    );
  } catch (error) {
    if (storedFile.isNewUpload) {
      deleteStoredFile(storedFile.storedPath);
    }
    throw mapPersuratanPrismaError(error, "incoming-mail");
  }

  return serializeIncomingMail({
    req,
    record: created,
  });
};

exports.redispose = async ({ id, payload, senderId }) => {
  const incomingMail = await repository.findById(id);

  if (!incomingMail) {
    throw new Error("Surat masuk tidak ditemukan.");
  }

  if (normalizeMailWorkflowStatus(incomingMail.status) === "COMPLETED") {
    throw new Error("Surat masuk yang sudah selesai tidak dapat didisposisikan kembali.");
  }

  const currentDisposition = await repository.findCurrentDispositionForReceiver(
    {
      incomingMailId: id,
      receiverId: senderId,
    },
  );

  if (!currentDisposition) {
    throw new Error(
      "Hanya pemegang disposisi aktif yang dapat meneruskan redisposisi.",
    );
  }

  if (payload.receiver_id === senderId) {
    throw new Error("Penerima redisposisi tidak boleh diri sendiri.");
  }

  const receiver = await userRepository.findAssignableUserById(
    payload.receiver_id,
  );

  if (!receiver) {
    throw new Error(
      "Penerima redisposisi harus merupakan pengguna aktif dengan akun teraktivasi.",
    );
  }

  await repository.updateDisposition(currentDisposition.id, {
    status: "FORWARDED",
    is_complete: true,
  });

  const disposition = await repository.createDisposition({
    incoming_mails_id: id,
    sender_id: senderId,
    receiver_id: payload.receiver_id,
    parent_disposition_id: currentDisposition.id,
    note: normalizeText(payload.note),
    start_date: normalizeOptionalDate(payload.start_date),
    due_date: normalizeOptionalDate(payload.due_date),
    status: payload.start_date ? "IN_PROGRESS" : "NEW",
  });

  await repository.update(id, { status: "IN_PROGRESS", updated_by: senderId });

  return serializeIncomingDisposition(disposition, 1);
};

exports.completeIncomingMail = async ({ req, id, userId }) => {
  const incomingMail = await repository.findById(id);

  if (!incomingMail) {
    throw new Error("Surat masuk tidak ditemukan.");
  }

  await repository.completeDispositions(id);
  const updated = await repository.update(id, {
    status: "COMPLETED",
    updated_by: userId,
  });
  return serializeIncomingMail({
    req,
    record: updated,
  });
};

exports.updateDispositionStatus = async ({
  req,
  incomingMailId,
  dispositionId,
  status,
  userId,
}) => {
  const incomingMail = await repository.findById(incomingMailId);

  if (!incomingMail) {
    throw new Error("Surat masuk tidak ditemukan.");
  }

  const disposition = await repository.findDispositionById({
    incomingMailId,
    dispositionId,
  });

  if (!disposition) {
    throw new Error("Disposisi surat masuk tidak ditemukan.");
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

  const refreshedMail = await repository.findById(incomingMailId);
  await repository.update(incomingMailId, {
    status: resolveDocumentStatusFromDispositions(
      refreshedMail?.disposition_mails || [],
    ),
    updated_by: userId,
  });

  const updatedMail = await repository.findById(incomingMailId);
  return serializeIncomingMail({
    req,
    record: updatedMail,
  });
};

exports.updateIncomingMail = async ({ req, id, payload, userId }) => {
  const incomingMail = await repository.findById(id);

  if (!incomingMail) {
    throw new Error("Surat masuk tidak ditemukan.");
  }

  if (normalizeMailWorkflowStatus(incomingMail.status) === "COMPLETED") {
    throw new Error("Surat masuk yang sudah selesai tidak dapat diubah.");
  }

  const storedFile = persistPersuratanFile({
    entity: "incoming-mails",
    input: payload.file,
    previousPath: incomingMail.file,
    fallbackBaseName:
      payload.mail_number ||
      payload.regarding ||
      payload.name ||
      incomingMail.mail_number ||
      incomingMail.regarding ||
      incomingMail.name ||
      "surat-masuk",
  });

  const updateData = {
    updated_by: userId,
  };

  if (payload.letter_prioritie_id !== undefined) {
    updateData.letter_prioritie_id = payload.letter_prioritie_id;
  }
  if (payload.target_division_id !== undefined) {
    throw new Error("Divisi tujuan surat masuk tidak dapat diubah.");
  }
  if (payload.target_division_ids !== undefined) {
    throw new Error("Divisi tujuan surat masuk tidak dapat diubah.");
  }
  if (payload.regarding !== undefined) {
    updateData.regarding = normalizeText(payload.regarding);
  }
  if (payload.description !== undefined) {
    updateData.description = normalizeText(payload.description);
  }
  if (payload.name !== undefined) {
    updateData.name = normalizeText(payload.name);
  }
  if (payload.receive_date !== undefined) {
    updateData.receive_date = normalizeDate(payload.receive_date);
  }
  if (payload.address !== undefined) {
    updateData.address = normalizeText(payload.address);
  }
  if (payload.mail_number !== undefined) {
    updateData.mail_number = normalizeText(payload.mail_number);
  }
  if (payload.file !== undefined) {
    updateData.file = storedFile.storedPath;
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
    throw mapPersuratanPrismaError(error, "incoming-mail");
  }

  if (payload.file !== undefined) {
    deleteReplacedStoredFile(incomingMail.file, updated.file);
  }

  return serializeIncomingMail({
    req,
    record: updated,
  });
};

exports.deleteIncomingMail = async (id, userId) => {
  const incomingMail = await repository.findById(id);

  if (!incomingMail) {
    throw new Error("Surat masuk tidak ditemukan.");
  }

  const deleted = await repository.delete(id, userId);
  deleteStoredFile(incomingMail.file);

  return deleted;
};
