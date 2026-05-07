const {
  buildFileUrl,
  deriveDocumentFileName,
  normalizeStoredPath,
} = require("./persuratan-files");
const {
  getDeliveryMediaLabel,
  getOutgoingStatusCode,
  normalizeMailWorkflowStatus,
  normalizeOutgoingStatus,
} = require("./persuratan-status");
const { serializeRole } = require("./role-types");

const IMAGE_PREVIEW_EXTENSIONS = new Set(["jpg", "jpeg", "png"]);
const OFFICE_PREVIEW_EXTENSIONS = new Set(["doc", "docx", "xls", "xlsx"]);

function toIsoDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function getFileExtension(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  let candidate = value.trim().split("#")[0].split("?")[0];

  if (/^https?:\/\//i.test(candidate)) {
    try {
      candidate = new URL(candidate).pathname;
    } catch {}
  }

  const fileName = candidate.split(/[\\/]/).filter(Boolean).pop() || "";
  const parts = fileName.toLowerCase().split(".");

  return parts.length > 1 ? parts.pop() || null : null;
}

function resolvePrintablePreviewMeta({ fileUrl, fileName }) {
  const extension = getFileExtension(fileName) || getFileExtension(fileUrl);
  const hasFile = Boolean(fileUrl);
  const previewType =
    extension === "pdf"
      ? "pdf"
      : IMAGE_PREVIEW_EXTENSIONS.has(extension)
        ? "image"
        : OFFICE_PREVIEW_EXTENSIONS.has(extension)
          ? "office"
          : null;

  return {
    has_file: hasFile,
    preview_url: hasFile ? fileUrl : null,
    download_url: hasFile ? fileUrl : null,
    file_extension: extension,
    preview_type: hasFile ? previewType : null,
    can_preview_inline: hasFile && ["pdf", "image"].includes(previewType),
  };
}

function buildPrintableDocumentItem(item) {
  const fileUrl = item.file_url || item.file || null;

  return {
    ...item,
    file: fileUrl,
    file_url: fileUrl,
    ...resolvePrintablePreviewMeta({
      fileUrl,
      fileName: item.file_name || fileUrl,
    }),
  };
}

const ACTIVE_DISPOSITION_STATUSES = new Set(["NEW", "IN_PROGRESS"]);

const DISPOSITION_STATUS_LABELS = {
  NEW: "Baru",
  IN_PROGRESS: "Diproses",
  COMPLETED: "Selesai",
  FORWARDED: "Diteruskan",
};

function isActiveDispositionStatus(status) {
  return ACTIVE_DISPOSITION_STATUSES.has(String(status || "").toUpperCase());
}

function normalizeDispositionStatus(status, { isComplete, hasChildren }) {
  const normalized = String(status || "")
    .trim()
    .toUpperCase();

  if (DISPOSITION_STATUS_LABELS[normalized]) {
    return normalized;
  }

  if (isComplete) {
    return "COMPLETED";
  }

  if (hasChildren) {
    return "FORWARDED";
  }

  return "IN_PROGRESS";
}

function buildTimelineLabel(senderName, receiverName) {
  return `${senderName || "Sistem"} -> ${receiverName || "-"}`;
}

function normalizeDispositionSerializeOptions(indexOrOptions) {
  if (typeof indexOrOptions === "object" && indexOrOptions !== null) {
    return indexOrOptions;
  }

  if (typeof indexOrOptions === "number") {
    return {
      sequence: indexOrOptions + 1,
    };
  }

  return {};
}

function buildDispositionWorkflowMeta(dispositions) {
  const currentHolders = [];
  const seenHolderIds = new Set();

  for (const item of dispositions.filter((entry) => entry.is_current)) {
    if (!item.receiver_id || seenHolderIds.has(item.receiver_id)) continue;

    seenHolderIds.add(item.receiver_id);
    currentHolders.push({
      id: item.receiver_id,
      name: item.receiver_name ?? "-",
      email: item.receiver?.email ?? null,
      status_key: item.status_key,
      status_label: item.status_label,
    });
  }

  const lastDisposition =
    dispositions.length > 0 ? dispositions[dispositions.length - 1] : null;

  return {
    current_holders: currentHolders,
    current_holder_names: currentHolders.map((item) => item.name),
    active_dispositions_count: currentHolders.length,
    last_holder: lastDisposition
      ? {
          id: lastDisposition.receiver_id,
          name: lastDisposition.receiver_name ?? "-",
          email: lastDisposition.receiver?.email ?? null,
          status_key: lastDisposition.status_key,
          status_label: lastDisposition.status_label,
        }
      : null,
    last_holder_name: lastDisposition?.receiver_name ?? null,
  };
}

function serializeUser(user) {
  if (!user) return null;

  const serialized = {
    ...user,
    created_at: toIsoDateTime(user.created_at),
    updated_at: toIsoDateTime(user.updated_at),
    email_verified_at: toIsoDateTime(user.email_verified_at),
    password_set_at: toIsoDateTime(user.password_set_at),
  };

  if (Object.prototype.hasOwnProperty.call(user, "role")) {
    serialized.role = serializeRole(user.role);
  }

  return serialized;
}

function serializeDivision(division) {
  if (!division) return null;

  return {
    ...division,
    created_at: toIsoDateTime(division.created_at),
    updated_at: toIsoDateTime(division.updated_at),
  };
}

function serializeIncomingMailTargetDivision(item) {
  if (!item) return null;

  const division = serializeDivision(item.division);
  const manager = serializeUser(item.manager);

  return {
    id: item.id ?? null,
    incoming_mails_id: item.incoming_mails_id ?? null,
    division_id: item.division_id,
    manager_id: item.manager_id ?? null,
    division,
    manager,
    division_name: division?.name ?? null,
    manager_name: manager?.name ?? null,
    created_at: toIsoDateTime(item.created_at),
    updated_at: toIsoDateTime(item.updated_at),
  };
}

function serializeMemorandumTargetDivision(item) {
  if (!item) return null;

  const division = serializeDivision(item.division);
  const manager = serializeUser(item.manager);

  return {
    id: item.id ?? null,
    memorandums_id: item.memorandums_id ?? null,
    division_id: item.division_id,
    manager_id: item.manager_id ?? null,
    division,
    manager,
    division_name: division?.name ?? null,
    manager_name: manager?.name ?? null,
    created_at: toIsoDateTime(item.created_at),
    updated_at: toIsoDateTime(item.updated_at),
  };
}

function isOverdueDate(value, referenceDate = new Date()) {
  if (!value) return false;

  const dueDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dueDate.getTime())) return false;

  return dueDate.getTime() < referenceDate.getTime();
}

function resolveIncomingMailStatus(record) {
  const dispositions = Array.isArray(record.disposition_mails)
    ? record.disposition_mails
    : [];
  const activeDispositions = dispositions.filter((item) =>
    isActiveDispositionStatus(item.status_key || item.status),
  );
  const hasOverdueOpenDisposition = activeDispositions.some(
    (item) => item.due_date && isOverdueDate(item.due_date),
  );

  const documentStatus = normalizeMailWorkflowStatus(record.status, "NEW");

  if (hasOverdueOpenDisposition || documentStatus === "OVERDUE") {
    return { code: 3, key: "OVERDUE", label: "Terlambat" };
  }

  if (activeDispositions.length > 0 || documentStatus === "IN_PROGRESS") {
    return { code: 1, key: "IN_PROGRESS", label: "Dalam Proses" };
  }

  if (
    documentStatus === "COMPLETED" ||
    dispositions.some((item) =>
      ["COMPLETED", "FORWARDED"].includes(item.status_key || item.status),
    )
  ) {
    return { code: 2, key: "COMPLETED", label: "Selesai" };
  }

  return { code: 0, key: "NEW", label: "Baru" };
}

function resolveOutgoingMailStatus(record) {
  const normalizedStatus = normalizeOutgoingStatus(record.status, "ACTIVE");
  const code = getOutgoingStatusCode(normalizedStatus);

  if (code === 0) {
    return { code: 0, key: "INACTIVE", label: "Nonaktif" };
  }

  return { code: 1, key: "ACTIVE", label: "Aktif" };
}

function resolveMemorandumStatus(record) {
  const dispositions = Array.isArray(record.dispositions)
    ? record.dispositions
    : [];
  const activeDispositions = dispositions.filter((item) =>
    isActiveDispositionStatus(item.status_key || item.status),
  );
  const hasOverdueOpenDisposition = activeDispositions.some(
    (item) => item.due_date && isOverdueDate(item.due_date),
  );

  const documentStatus = normalizeMailWorkflowStatus(record.status, "NEW");

  if (hasOverdueOpenDisposition || documentStatus === "OVERDUE") {
    return { code: 3, key: "OVERDUE", label: "Terlambat" };
  }

  if (activeDispositions.length > 0 || documentStatus === "IN_PROGRESS") {
    return { code: 1, key: "IN_PROGRESS", label: "Dalam Proses" };
  }

  if (
    documentStatus === "COMPLETED" ||
    dispositions.some((item) =>
      ["COMPLETED", "FORWARDED"].includes(item.status_key || item.status),
    )
  ) {
    return { code: 2, key: "COMPLETED", label: "Selesai" };
  }

  return { code: 0, key: "NEW", label: "Baru" };
}

async function serializePersuratanFile({
  req,
  currentValue,
  fallbackBaseName,
}) {
  const normalizedStoredPath = normalizeStoredPath(currentValue) || null;
  const fileUrl = normalizedStoredPath
    ? buildFileUrl(req, normalizedStoredPath)
    : null;
  const fileName = currentValue
    ? deriveDocumentFileName(
        normalizedStoredPath || currentValue,
        fallbackBaseName,
      )
    : null;

  return {
    file: fileUrl,
    file_url: fileUrl,
    fileUrl: fileUrl,
    file_path: normalizedStoredPath,
    filePath: normalizedStoredPath,
    file_name: fileName,
    fileName: fileName,
  };
}

function serializeIncomingDisposition(item, indexOrOptions = 0) {
  const options = normalizeDispositionSerializeOptions(indexOrOptions);
  const normalizedStatus = normalizeDispositionStatus(item.status, {
    isComplete: item.is_complete,
    hasChildren: Boolean(options.hasChildren),
  });
  const sender = serializeUser(item.sender);
  const receiver = serializeUser(item.receiver);
  const senderName = sender?.name ?? null;
  const receiverName = receiver?.name ?? null;

  return {
    ...item,
    sender,
    receiver,
    sender_name: senderName,
    senderName: senderName,
    receiver_name: receiverName,
    receiverName: receiverName,
    start_date: toIsoDateTime(item.start_date),
    due_date: toIsoDateTime(item.due_date),
    completed_at: toIsoDateTime(item.completed_at),
    disposed_at: toIsoDateTime(item.disposed_at),
    parent_disposition_id: item.parent_disposition_id ?? null,
    status: normalizedStatus,
    status_key: normalizedStatus,
    status_label: DISPOSITION_STATUS_LABELS[normalizedStatus],
    sequence: options.sequence ?? null,
    is_current: isActiveDispositionStatus(normalizedStatus),
    timeline_label: buildTimelineLabel(senderName, receiverName),
    is_disposisi_ulang:
      Boolean(item.parent_disposition_id) ||
      Boolean((options.sequence ?? 1) > 1),
    can_start: normalizedStatus === "NEW",
    can_complete: ["NEW", "IN_PROGRESS"].includes(normalizedStatus),
    can_redispose: isActiveDispositionStatus(normalizedStatus),
  };
}

function serializeMemorandumDisposition(item, indexOrOptions = 0) {
  const options = normalizeDispositionSerializeOptions(indexOrOptions);
  const normalizedStatus = normalizeDispositionStatus(item.status, {
    isComplete: item.is_complete,
    hasChildren: Boolean(options.hasChildren),
  });
  const sender = serializeUser(item.sender);
  const receiver = serializeUser(item.receiver);
  const senderName = sender?.name ?? null;
  const receiverName = receiver?.name ?? null;

  return {
    ...item,
    sender,
    receiver,
    sender_name: senderName,
    senderName: senderName,
    receiver_name: receiverName,
    receiverName: receiverName,
    start_date: toIsoDateTime(item.start_date),
    due_date: toIsoDateTime(item.due_date),
    completed_at: toIsoDateTime(item.completed_at),
    disposed_at: toIsoDateTime(item.disposed_at),
    parent_disposition_id: item.parent_disposition_id ?? null,
    status: normalizedStatus,
    status_key: normalizedStatus,
    status_label: DISPOSITION_STATUS_LABELS[normalizedStatus],
    sequence: options.sequence ?? null,
    is_current: isActiveDispositionStatus(normalizedStatus),
    timeline_label: buildTimelineLabel(senderName, receiverName),
    is_disposisi_ulang:
      Boolean(item.parent_disposition_id) ||
      Boolean((options.sequence ?? 1) > 1),
    can_start: normalizedStatus === "NEW",
    can_complete: ["NEW", "IN_PROGRESS"].includes(normalizedStatus),
    can_redispose: isActiveDispositionStatus(normalizedStatus),
  };
}

async function serializeIncomingMail({ req, record }) {
  const fallbackBaseName =
    record.mail_number || record.regarding || record.name || record.id;
  const fileData = await serializePersuratanFile({
    req,
    currentValue: record.file,
    fallbackBaseName,
  });
  const rawDispositions = Array.isArray(record.disposition_mails)
    ? record.disposition_mails
    : [];
  const childIds = new Set(
    rawDispositions.map((item) => item.parent_disposition_id).filter(Boolean),
  );
  const dispositions = rawDispositions.map((item, index) =>
    serializeIncomingDisposition(item, {
      sequence: index + 1,
      hasChildren: childIds.has(item.id),
    }),
  );
  const status = resolveIncomingMailStatus({
    ...record,
    disposition_mails: dispositions,
  });
  const workflowMeta = buildDispositionWorkflowMeta(dispositions);
  const targetDivisions = (
    Array.isArray(record.target_divisions) ? record.target_divisions : []
  )
    .map(serializeIncomingMailTargetDivision)
    .filter(Boolean);
  const effectiveTargetDivisions = targetDivisions;

  return {
    ...record,
    letter_prioritie: record.letter_prioritie
      ? { ...record.letter_prioritie }
      : null,
    target_divisions: effectiveTargetDivisions,
    target_division_ids: effectiveTargetDivisions.map(
      (item) => item.division_id,
    ),
    target_division_names: effectiveTargetDivisions
      .map((item) => item.division_name)
      .filter(Boolean),
    target_managers: effectiveTargetDivisions
      .map((item) => item.manager)
      .filter(Boolean),
    disposition_mails: dispositions,
    receive_date: toIsoDateTime(record.receive_date),
    created_at: toIsoDateTime(record.created_at),
    updated_at: toIsoDateTime(record.updated_at),
    status: status.code,
    status_key: status.key,
    status_label: status.label,
    is_overdue: status.key === "OVERDUE",
    ...workflowMeta,
    ...fileData,
  };
}

async function serializeOutgoingMail({ req, record }) {
  const fallbackBaseName = record.mail_number || record.name || record.id;
  const fileData = await serializePersuratanFile({
    req,
    currentValue: record.file,
    fallbackBaseName,
  });
  const status = resolveOutgoingMailStatus(record);

  return {
    ...record,
    delivery_media: getDeliveryMediaLabel(record.delivery_media),
    delivery_media_key: record.delivery_media,
    creator: serializeUser(record.creator),
    updater: serializeUser(record.updater),
    deleter: serializeUser(record.deleter),
    letter_prioritie: record.letter_prioritie
      ? { ...record.letter_prioritie }
      : null,
    send_date: toIsoDateTime(record.send_date),
    created_at: toIsoDateTime(record.created_at),
    updated_at: toIsoDateTime(record.updated_at),
    deleted_at: toIsoDateTime(record.deleted_at),
    status: status.code,
    status_key: status.key,
    status_label: status.label,
    ...fileData,
  };
}

async function serializeMemorandum({ req, record }) {
  const fallbackBaseName = record.memo_number || record.regarding || record.id;
  const fileData = await serializePersuratanFile({
    req,
    currentValue: record.file,
    fallbackBaseName,
  });
  const rawDispositions = Array.isArray(record.dispositions)
    ? record.dispositions
    : [];
  const childIds = new Set(
    rawDispositions.map((item) => item.parent_disposition_id).filter(Boolean),
  );
  const dispositions = rawDispositions.map((item, index) =>
    serializeMemorandumDisposition(item, {
      sequence: index + 1,
      hasChildren: childIds.has(item.id),
    }),
  );
  const status = resolveMemorandumStatus({ ...record, dispositions });
  const workflowMeta = buildDispositionWorkflowMeta(dispositions);
  const targetDivisions = (
    Array.isArray(record.target_divisions) ? record.target_divisions : []
  )
    .map(serializeMemorandumTargetDivision)
    .filter(Boolean);
  const originDivision = serializeDivision(record.origin_division);
  const effectiveTargetDivisions = targetDivisions;

  return {
    ...record,
    origin_division: originDivision,
    origin_division_id: record.origin_division_id ?? null,
    origin_division_name: originDivision?.name ?? null,
    creator: serializeUser(record.creator),
    updater: serializeUser(record.updater),
    deleter: serializeUser(record.deleter),
    target_divisions: effectiveTargetDivisions,
    target_division_ids: effectiveTargetDivisions.map(
      (item) => item.division_id,
    ),
    target_division_names: effectiveTargetDivisions
      .map((item) => item.division_name)
      .filter(Boolean),
    target_managers: effectiveTargetDivisions
      .map((item) => item.manager)
      .filter(Boolean),
    dispositions,
    memo_date: toIsoDateTime(record.memo_date),
    received_date: toIsoDateTime(record.received_date),
    due_date: toIsoDateTime(record.due_date),
    created_at: toIsoDateTime(record.created_at),
    updated_at: toIsoDateTime(record.updated_at),
    deleted_at: toIsoDateTime(record.deleted_at),
    status: status.code,
    status_key: status.key,
    status_label: status.label,
    is_overdue: status.key === "OVERDUE",
    ...workflowMeta,
    ...fileData,
  };
}

function buildReportSummary({ incoming, outgoing, memorandums }) {
  const incomingSummary = {
    total: incoming.length,
    baru: incoming.filter((item) => item.status_key === "NEW").length,
    dalam_proses: incoming.filter((item) => item.status_key === "IN_PROGRESS")
      .length,
    selesai: incoming.filter((item) => item.status_key === "COMPLETED").length,
    terlambat: incoming.filter((item) => item.status_key === "OVERDUE").length,
  };

  const outgoingSummary = {
    total: outgoing.length,
    aktif: outgoing.filter((item) => item.status_key === "ACTIVE").length,
    nonaktif: outgoing.filter((item) => item.status_key === "INACTIVE").length,
  };

  const memorandumSummary = {
    total: memorandums.length,
    baru: memorandums.filter((item) => item.status_key === "NEW").length,
    dalam_proses: memorandums.filter(
      (item) => item.status_key === "IN_PROGRESS",
    ).length,
    selesai: memorandums.filter((item) => item.status_key === "COMPLETED")
      .length,
    terlambat: memorandums.filter((item) => item.status_key === "OVERDUE")
      .length,
  };

  return {
    incoming_mails: incomingSummary,
    outgoing_mails: outgoingSummary,
    memorandums: memorandumSummary,
    total_documents:
      incomingSummary.total + outgoingSummary.total + memorandumSummary.total,
  };
}

function toPrintableDocumentItems({ incoming, outgoing, memorandums }) {
  const incomingItems = incoming.map((item) =>
    buildPrintableDocumentItem({
      id: item.id,
      kind: "incoming-mail",
      document_number: item.mail_number,
      subject: item.regarding,
      primary_text: item.name,
      secondary_text: item.address,
      document_date: item.receive_date,
      status_key: item.status_key,
      status_label: item.status_label,
      file: item.file,
      file_url: item.file_url,
      file_path: item.file_path,
      file_name: item.file_name,
      record: item,
    }),
  );

  const outgoingItems = outgoing.map((item) =>
    buildPrintableDocumentItem({
      id: item.id,
      kind: "outgoing-mail",
      document_number: item.mail_number,
      subject: item.name,
      primary_text: item.address,
      secondary_text: item.delivery_media,
      document_date: item.send_date,
      status_key: item.status_key,
      status_label: item.status_label,
      file: item.file,
      file_url: item.file_url,
      file_path: item.file_path,
      file_name: item.file_name,
      record: item,
    }),
  );

  const memorandumItems = memorandums.map((item) =>
    buildPrintableDocumentItem({
      id: item.id,
      kind: "memorandum",
      document_number: item.memo_number,
      subject: item.regarding,
      primary_text: item.origin_division?.name ?? "-",
      secondary_text: item.creator?.name ?? "-",
      document_date: item.memo_date,
      status_key: item.status_key,
      status_label: item.status_label,
      file: item.file,
      file_url: item.file_url,
      file_path: item.file_path,
      file_name: item.file_name,
      record: item,
    }),
  );

  return [...incomingItems, ...outgoingItems, ...memorandumItems].sort(
    (left, right) =>
      new Date(right.document_date || 0).getTime() -
      new Date(left.document_date || 0).getTime(),
  );
}

module.exports = {
  buildReportSummary,
  resolveIncomingMailStatus,
  resolveMemorandumStatus,
  resolveOutgoingMailStatus,
  serializeIncomingMail,
  serializeIncomingDisposition,
  serializeMemorandum,
  serializeMemorandumDisposition,
  serializeOutgoingMail,
  toIsoDateTime,
  toPrintableDocumentItems,
};
