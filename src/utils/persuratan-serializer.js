const {
  buildFileUrl,
  deriveDocumentFileName,
  normalizeStoredPath,
} = require("./persuratan-files");
const {
  buildWatermarkMeta,
  resolveEffectiveFileUrl,
} = require("../modules/watermark-settings/watermarkProcessor.service");
const {
  appendFileAccessToken,
} = require("./file-access-token");
const { toSizeBytesNumber } = require("./size-bytes");
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

function serializeStorageSummary(storage) {
  if (!storage) return null;

  const cabinet = storage.cabinet || null;
  const office = cabinet?.office || null;
  const locationLabel =
    office && cabinet
      ? `${office.name} - ${cabinet.code} (${storage.name})`
      : storage.name || null;

  return {
    id: storage.id,
    office_id: office?.id ?? null,
    office_code: office?.code ?? null,
    office_name: office?.name ?? null,
    cabinet_id: cabinet?.id ?? storage.cabinet_id ?? null,
    cabinet_code: cabinet?.code ?? null,
    rack_name: storage.name ?? null,
    capacity: storage.capacity ?? 0,
    is_active: Boolean(storage.is_active),
    location_label: locationLabel,
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

function uniqueUsersById(users) {
  const seen = new Set();
  const unique = [];

  for (const user of Array.isArray(users) ? users : []) {
    if (!user?.id || seen.has(user.id)) continue;
    seen.add(user.id);
    unique.push(user);
  }

  return unique;
}

function mapInitialDispositionManagersByDivision(dispositions) {
  const managersByDivision = new Map();

  for (const disposition of Array.isArray(dispositions) ? dispositions : []) {
    if (disposition.parent_disposition_id) continue;

    const receiver = disposition.receiver;
    const divisionId = receiver?.division_id;
    if (!receiver?.id || !divisionId) continue;

    const current = managersByDivision.get(divisionId) ?? [];
    current.push(receiver);
    managersByDivision.set(divisionId, uniqueUsersById(current));
  }

  return managersByDivision;
}

function attachTargetDivisionManagers(targetDivisions, dispositions) {
  const managersByDivision = mapInitialDispositionManagersByDivision(dispositions);

  return targetDivisions.map((target) => {
    const dispositionManagers = managersByDivision.get(target.division_id) ?? [];
    const managers = uniqueUsersById([
      ...(target.manager ? [target.manager] : []),
      ...dispositionManagers,
    ]);

    return {
      ...target,
      manager: target.manager ?? managers[0] ?? null,
      manager_id: target.manager_id ?? (managers.length === 1 ? managers[0].id : null),
      manager_name:
        target.manager_name ?? (managers.length === 1 ? managers[0].name : null),
      managers,
      manager_ids: managers.map((manager) => manager.id),
      manager_names: managers.map((manager) => manager.name).filter(Boolean),
    };
  });
}

function flattenTargetManagers(targetDivisions) {
  return uniqueUsersById(
    targetDivisions.flatMap((target) => [
      ...(Array.isArray(target.managers) ? target.managers : []),
      ...(target.manager ? [target.manager] : []),
    ]),
  );
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
  record,
  module,
  currentValue,
  fallbackBaseName,
}) {
  const normalizedStoredPath = normalizeStoredPath(currentValue) || null;
  const originalFileUrl = normalizedStoredPath
    ? appendFileAccessToken(req, buildFileUrl(req, normalizedStoredPath), {
        storedPath: normalizedStoredPath,
        module,
        entityId: record?.id,
      })
    : null;
  const watermark = buildWatermarkMeta(req, record || {}, module);
  const fileUrl = resolveEffectiveFileUrl(
    req,
    record || {},
    originalFileUrl,
    module,
  );
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
    original_file_url: originalFileUrl,
    file_path: normalizedStoredPath,
    filePath: normalizedStoredPath,
    file_name: fileName,
    fileName: fileName,
    watermark,
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
    record,
    module: "incoming_mail",
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
  const effectiveTargetDivisions = attachTargetDivisionManagers(
    targetDivisions,
    dispositions,
  );
  const targetManagers = flattenTargetManagers(effectiveTargetDivisions);
  const storage = serializeStorageSummary(record.storage);

  return {
    ...record,
    file_size_bytes: toSizeBytesNumber(record.file_size_bytes),
    watermark_file_size_bytes: toSizeBytesNumber(
      record.watermark_file_size_bytes,
    ),
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
    target_managers: targetManagers,
    target_manager_ids: targetManagers.map((manager) => manager.id),
    target_manager_names: targetManagers
      .map((manager) => manager.name)
      .filter(Boolean),
    disposition_mails: dispositions,
    receive_date: toIsoDateTime(record.receive_date),
    storage_id: record.storage_id ?? storage?.id ?? null,
    storage,
    physical_storage: storage,
    physical_storage_label: storage?.location_label ?? null,
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
    record,
    module: "outgoing_mail",
    currentValue: record.file,
    fallbackBaseName,
  });
  const status = resolveOutgoingMailStatus(record);
  const storage = serializeStorageSummary(record.storage);

  return {
    ...record,
    file_size_bytes: toSizeBytesNumber(record.file_size_bytes),
    watermark_file_size_bytes: toSizeBytesNumber(
      record.watermark_file_size_bytes,
    ),
    delivery_media: getDeliveryMediaLabel(record.delivery_media),
    delivery_media_key: record.delivery_media,
    creator: serializeUser(record.creator),
    updater: serializeUser(record.updater),
    deleter: serializeUser(record.deleter),
    letter_prioritie: record.letter_prioritie
      ? { ...record.letter_prioritie }
      : null,
    storage_id: record.storage_id ?? storage?.id ?? null,
    storage,
    physical_storage: storage,
    physical_storage_label: storage?.location_label ?? null,
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
    record,
    module: "memorandum",
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
  const effectiveTargetDivisions = attachTargetDivisionManagers(
    targetDivisions,
    dispositions,
  );
  const targetManagers = flattenTargetManagers(effectiveTargetDivisions);
  const storage = serializeStorageSummary(record.storage);

  return {
    ...record,
    file_size_bytes: toSizeBytesNumber(record.file_size_bytes),
    watermark_file_size_bytes: toSizeBytesNumber(
      record.watermark_file_size_bytes,
    ),
    origin_division: originDivision,
    origin_division_id: record.origin_division_id ?? null,
    origin_division_name: originDivision?.name ?? null,
    storage_id: record.storage_id ?? storage?.id ?? null,
    storage,
    physical_storage: storage,
    physical_storage_label: storage?.location_label ?? null,
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
    target_managers: targetManagers,
    target_manager_ids: targetManagers.map((manager) => manager.id),
    target_manager_names: targetManagers
      .map((manager) => manager.name)
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
      storage_id: item.storage_id,
      storage: item.storage,
      physical_storage: item.physical_storage,
      physical_storage_label: item.physical_storage_label,
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
      storage_id: item.storage_id,
      storage: item.storage,
      physical_storage: item.physical_storage,
      physical_storage_label: item.physical_storage_label,
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
      storage_id: item.storage_id,
      storage: item.storage,
      physical_storage: item.physical_storage,
      physical_storage_label: item.physical_storage_label,
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
