const ExcelJS = require("exceljs");
const repository = require("./activityCentre.repository");
const {
  ACTION_LABELS,
  MODULE_LABELS,
} = require("../../utils/system-activity");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  resolvePagination,
} = require("../../utils/pagination");
const { AppError } = require("../../utils/errors");

const SOURCE_LABELS = Object.freeze({
  API: "Aplikasi",
  MANUAL: "Input Manual",
  MODULE_AUDIT: "Audit Modul",
  IMPORT: "Impor",
  SLIK_IMPORT: "Impor SLIK",
  IDEB_IMPORT: "Impor IDEB",
  EXCEL: "Upload Excel",
  SYSTEM: "Sistem",
});

const ENTITY_LABELS = Object.freeze({
  SESI: "Sesi Pengguna",
  AKTIVITAS_SISTEM: "Aktivitas Sistem",
  DOKUMEN_ARSIP: "Dokumen Arsip",
  DOKUMEN_WATERMARK: "Dokumen Watermark",
  DISPOSISI_DOKUMEN: "Disposisi Dokumen",
  PEMINJAMAN_DOKUMEN: "Peminjaman Dokumen",
  DOKUMEN_DIGITAL: "Dokumen Digital",
  LAPORAN_ARSIP: "Laporan Arsip",
  PENGGUNAAN_STORAGE: "Penggunaan Storage",
  FILE_PERSURATAN: "File Persuratan",
  SURAT_MASUK: "Surat Masuk",
  SURAT_KELUAR: "Surat Keluar",
  MEMORANDUM: "Memorandum",
  LAPORAN_PERSURATAN: "Laporan Persuratan",
  SURAT_PERINGATAN: "Surat Peringatan",
  IDEB: "IDEB",
  AKTIVITAS_MARKETING: "Aktivitas Marketing",
  KONTRAK_DEBITUR: "Kontrak Debitur",
  IMPORT_SLIK: "Impor SLIK",
  LAPORAN_DEBITUR: "Laporan Debitur",
  DEBITUR: "Debitur",
  DATA_LEGAL: "Data Legal",
  JENIS_AGUNAN: "Jenis Agunan",
  JENIS_PROSES_LEGAL: "Jenis Proses Legal",
  MEDIA_PENGIRIMAN: "Media Pengiriman",
  CHECKLIST_DOKUMEN: "Checklist Dokumen",
  PRODUK_PEMBIAYAAN: "Produk Pembiayaan",
  JENIS_AKAD: "Jenis Akad",
  PRIORITAS_SURAT: "Prioritas Surat",
  JENIS_DOKUMEN: "Jenis Dokumen",
  PIHAK_KETIGA: "Pihak Ketiga",
  JENIS_TITIPAN: "Jenis Titipan",
  WATERMARK: "Watermark",
  CABANG: "Cabang",
  LOKASI_ARSIP: "Lokasi Arsip",
  ROLE_MENU: "Hak Akses Role",
  DIVISI: "Divisi",
  ROLE: "Role",
  USER: "Pengguna",
  MENU: "Menu",
  NOTIFIKASI: "Notifikasi",
  DIGITAL_DEBTORS: "Debitur",
  DEBTOR_CONTRACTS: "Kontrak Debitur",
  DEBTOR_COLLATERALS: "Agunan",
  DEBTOR_DOCUMENTS: "Dokumen Debitur",
  DEBTOR_WARNING_LETTERS: "Surat Peringatan",
  DEBTOR_MARKETING_ACTIVITIES: "Aktivitas Marketing",
  DEBTOR_IMPORT_JOBS: "Pekerjaan Impor",
  DEBTOR_IDEB_UPLOADS: "Upload IDEB",
  LEGAL_NOTARY_PROGRESS: "Progress Notaris",
  LEGAL_INSURANCE_PROGRESS: "Progress Asuransi",
  LEGAL_KJPP_PROGRESS: "Progress KJPP",
  LEGAL_CLAIM: "Klaim Asuransi",
  LEGAL_DEPOSIT: "Dana Titipan",
  LEGAL_DEPOSIT_TRANSACTION: "Transaksi Dana Titipan",
});

const MODULE_TARGET_PATHS = Object.freeze({
  ARSIP_DIGITAL: "/dashboard/arsip-digital/ruang-arsip/list-dokumen",
  PERSURATAN: "/dashboard/manajemen-surat/laporan",
  INFORMASI_DEBITUR: "/dashboard/informasi-debitur",
  MANAJEMEN_LEGAL: "/dashboard/legal",
  USER_DAN_AKSES: "/dashboard/users",
});

const ENTITY_TARGET_PATHS = Object.freeze({
  IDEB: "/dashboard/informasi-debitur/laporan-ideb",
  DEBTOR_IDEB_UPLOADS: "/dashboard/informasi-debitur/laporan-ideb",
  DEBTOR_IMPORT_JOBS:
    "/dashboard/informasi-debitur/admin/monitoring-import",
  IMPORT_SLIK: "/dashboard/informasi-debitur/admin/monitoring-import",
  AKTIVITAS_MARKETING:
    "/dashboard/informasi-debitur/marketing/hasil-kunjungan",
  DEBTOR_MARKETING_ACTIVITIES:
    "/dashboard/informasi-debitur/marketing/hasil-kunjungan",
  JENIS_AGUNAN: "/dashboard/parameter/jenis-agunan",
  JENIS_PROSES_LEGAL: "/dashboard/parameter/jenis-proses-legal",
  MEDIA_PENGIRIMAN: "/dashboard/parameter/media-pengiriman-surat",
  CHECKLIST_DOKUMEN: "/dashboard/parameter/checklist-dokumen",
  PRODUK_PEMBIAYAAN: "/dashboard/parameter/produk-pembiayaan",
  JENIS_AKAD: "/dashboard/parameter/jenis-akad",
  PRIORITAS_SURAT: "/dashboard/parameter/prioritas-surat",
  JENIS_DOKUMEN: "/dashboard/parameter/jenis-dokumen",
  JENIS_TITIPAN: "/dashboard/parameter/jenis-titipan",
  WATERMARK: "/dashboard/parameter/watermark-dokumen",
  CABANG: "/dashboard/parameter/cabang",
  LOKASI_ARSIP: "/dashboard/parameter/tempat-penyimpanan",
  DIVISI: "/dashboard/parameter/divisi",
  ROLE: "/dashboard/parameter/role",
  ROLE_MENU: "/dashboard/parameter/role-menu",
  USER: "/dashboard/users",
});

const SENSITIVE_DETAIL_KEYS = new Set([
  "password",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "secret",
  "file_path",
  "path",
  "checksum",
  "raw",
  "raw_data",
  "error_message",
  "error_detail",
  "request_ip",
  "user_agent",
]);

const TECHNICAL_CHANGE_KEYS = new Set([
  "id",
  "created_at",
  "updated_at",
  "deleted_at",
  "created_by",
  "updated_by",
  "deleted_by",
  "file_path",
  "checksum",
  "mime_type",
  "size_bytes",
]);

const METADATA_FIELD_DEFINITIONS = Object.freeze([
  ["file_name", "Nama File"],
  ["file_names", "Nama File"],
  ["file_count", "Jumlah File"],
  ["files_count", "Jumlah File"],
  ["total_size_bytes", "Total Ukuran File"],
  ["worksheet", "Worksheet"],
  ["row_number", "Nomor Baris"],
  ["period_month", "Periode Data"],
  ["import_segment", "Segmen Impor"],
  ["cif_status", "Status CIF"],
  ["total_parts", "Total Bagian"],
  ["received_parts", "Bagian Diterima"],
  ["part_numbers", "Nomor Bagian"],
  ["source_format", "Format Sumber"],
  ["report_number", "Nomor Laporan"],
  ["reference_number", "Nomor Referensi"],
  ["link_status", "Status Hubungan"],
  ["match_status", "Status Pencocokan"],
  ["error_total", "Jumlah Kesalahan"],
  ["document_number", "Nomor Dokumen"],
  ["document_name", "Nama Dokumen"],
  ["reference_type", "Jenis Referensi"],
  ["reference_id", "Referensi"],
  ["category", "Kategori"],
]);

const IMPORT_SNAPSHOT_FIELD_DEFINITIONS = Object.freeze([
  ["type", "Jenis Impor"],
  ["status", "Status Impor"],
  ["period_month", "Periode Data"],
  ["import_segment", "Segmen Impor"],
  ["cif_status", "Status CIF"],
  ["total_rows", "Total Baris"],
  ["success_rows", "Baris Berhasil"],
  ["failed_rows", "Baris Gagal"],
]);

const IMPORT_STAT_LABELS = Object.freeze({
  debtors: "Debitur Terbentuk",
  contracts: "Kontrak Terbentuk",
  contract_snapshots: "Snapshot Kontrak",
  collectibilities: "Kolektibilitas Terbentuk",
  collaterals: "Agunan Terbentuk",
  raw_records: "Raw Record Tersimpan",
});

const WORKFLOW_ACTIONS = new Set([
  "APPROVE",
  "REJECT",
  "REVOKE",
  "HANDOVER",
  "RETURN",
  "COMPLETE",
  "REDISPOSE",
  "ACCESS_REQUESTED",
  "ACCESS_APPROVED",
  "ACCESS_REJECTED",
  "ACCESS_REVOKED",
  "LOAN_REQUESTED",
  "LOAN_APPROVED",
  "LOAN_REJECTED",
  "LOAN_HANDED_OVER",
  "LOAN_RETURNED",
]);

function normalizeText(value) {
  return String(value || "").trim();
}

function humanize(value) {
  const normalized = normalizeText(value);
  if (!normalized) return "-";
  return normalized
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeText(value, maxLength = 300) {
  if (value === null || value === undefined) return null;
  const normalized = String(value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function normalizeEntityType(value) {
  return normalizeText(value).toUpperCase();
}

function entityLabel(value) {
  const normalized = normalizeEntityType(value);
  return ENTITY_LABELS[normalized] || humanize(value);
}

function actionLabel(value) {
  return ACTION_LABELS[value] || humanize(value);
}

function sourceLabel(value) {
  return SOURCE_LABELS[value] || humanize(value);
}

function basename(value) {
  const normalized = safeText(value, 180);
  return normalized ? normalized.split(/[\\/]/).pop() || normalized : null;
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} byte`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatDetailValue(key, value) {
  if (value === null || value === undefined || value === "") return null;
  if (SENSITIVE_DETAIL_KEYS.has(String(key).toLowerCase())) return null;

  if (Array.isArray(value)) {
    const values = value
      .slice(0, 6)
      .map((item) =>
        key === "file_names" ? basename(item) : safeText(item, 120),
      )
      .filter(Boolean);
    if (!values.length) return null;
    const suffix = value.length > values.length ? ` (+${value.length - values.length})` : "";
    return `${values.join(", ")}${suffix}`;
  }

  if (typeof value === "object") return null;
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  if (key === "total_size_bytes") return formatBytes(value);
  if (key === "file_name") return basename(value);
  if (
    ["status", "link_status", "match_status", "source_format", "type"].includes(
      key,
    )
  ) {
    return humanize(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat("id-ID").format(value);
  }
  return safeText(value);
}

function addDetailField(fields, key, label, value) {
  const formatted = formatDetailValue(key, value);
  if (!formatted) return;
  if (fields.some((field) => field.label === label && field.value === formatted)) {
    return;
  }
  fields.push({ key, label, value: formatted });
}

function resolveContextKind(item) {
  const action = normalizeText(item.action).toUpperCase();
  const source = normalizeText(item.source).toUpperCase();
  const entityType = normalizeEntityType(item.entity_type);

  if (item.module === "AUTH") return "AUTH";
  if (
    action.includes("IMPORT") ||
    ["UPLOAD_IDEB", "RESOLVE_IDEB", "BULK_UPDATE_COLLATERAL_EXPIRY"].includes(
      action,
    ) ||
    source.includes("IMPORT") ||
    source === "EXCEL"
  ) {
    return "IMPORT";
  }
  if (action === "EXPORT") return "EXPORT";
  if (item.module === "USER_DAN_AKSES") return "ACCESS";
  if (item.module === "PARAMETER") return "PARAMETER";
  if (
    ["VIEW_FILE", "UPLOAD", "UPLOAD_DOCUMENT", "UPLOAD_WARNING_LETTER"].includes(
      action,
    )
  ) {
    return "DOCUMENT";
  }
  if (WORKFLOW_ACTIONS.has(action)) return "WORKFLOW";
  if (entityType.includes("DOKUMEN") || entityType.includes("FILE")) {
    return "DOCUMENT";
  }
  if (
    ["CREATE", "CREATED", "UPDATE", "UPDATED", "DELETE", "DELETED"].includes(
      action,
    ) ||
    action.startsWith("UPDATE_") ||
    action.startsWith("DELETE_")
  ) {
    return "CHANGE";
  }
  return "GENERAL";
}

function contextTitle(kind) {
  const labels = {
    AUTH: "Konteks Sesi",
    IMPORT: "Konteks Impor Data",
    EXPORT: "Konteks Export",
    DOCUMENT: "Konteks Dokumen",
    WORKFLOW: "Konteks Alur Kerja",
    ACCESS: "Konteks User & Akses",
    PARAMETER: "Konteks Parameter",
    CHANGE: "Konteks Perubahan Data",
    GENERAL: "Konteks Aktivitas",
  };
  return labels[kind] || labels.GENERAL;
}

function changedFieldLabels(beforeValue, afterValue) {
  const before = asRecord(beforeValue);
  const after = asRecord(afterValue);
  if (!before || !after) return [];

  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => {
      const normalized = key.toLowerCase();
      if (
        TECHNICAL_CHANGE_KEYS.has(normalized) ||
        SENSITIVE_DETAIL_KEYS.has(normalized) ||
        normalized.includes("password") ||
        normalized.includes("token") ||
        normalized.includes("secret")
      ) {
        return false;
      }
      return JSON.stringify(before[key]) !== JSON.stringify(after[key]);
    })
    .sort((left, right) => left.localeCompare(right, "id"))
    .map(humanize)
    .slice(0, 20);
}

function addStatusTransition(fields, beforeValue, afterValue) {
  const before = asRecord(beforeValue);
  const after = asRecord(afterValue);
  const beforeStatus = before?.status;
  const afterStatus = after?.status;
  if (
    beforeStatus === null ||
    beforeStatus === undefined ||
    afterStatus === null ||
    afterStatus === undefined ||
    String(beforeStatus) === String(afterStatus)
  ) {
    return;
  }
  addDetailField(fields, "status", "Status Sebelum", beforeStatus);
  addDetailField(fields, "status", "Status Sesudah", afterStatus);
}

function buildContext(item) {
  const kind = resolveContextKind(item);
  const fields = [];
  const metadata = asRecord(item.metadata) || {};
  const afterData = asRecord(item.after_data) || {};
  const beforeData = asRecord(item.before_data) || {};
  const normalizedEntityType = normalizeEntityType(item.entity_type);

  if (item.object_label && item.object_label !== item.entity_id) {
    addDetailField(fields, "object_label", "Referensi Data", item.object_label);
  }

  if (kind === "AUTH") {
    addDetailField(
      fields,
      "action",
      "Aktivitas Sesi",
      actionLabel(item.action),
    );
  } else if (kind === "EXPORT") {
    const exportSubject = String(item.request_path || "")
      .split("?")[0]
      .replace(/\/+$/, "") === "/api/activity-centre/export"
      ? "Pusat Log Aktivitas"
      : MODULE_LABELS[item.module] || humanize(item.module);
    addDetailField(
      fields,
      "module",
      "Data yang Diexport",
      exportSubject,
    );
  } else if (kind === "WORKFLOW") {
    addDetailField(
      fields,
      "action",
      "Tahap Proses",
      actionLabel(item.action),
    );
  } else if (kind === "ACCESS") {
    addDetailField(
      fields,
      "action",
      "Perubahan Akses",
      actionLabel(item.action),
    );
  } else if (kind === "PARAMETER") {
    addDetailField(
      fields,
      "entity_type",
      "Parameter",
      entityLabel(item.entity_type),
    );
  } else if (kind === "DOCUMENT") {
    addDetailField(
      fields,
      "action",
      "Aktivitas Dokumen",
      actionLabel(item.action),
    );
  } else if (kind === "CHANGE") {
    addDetailField(
      fields,
      "action",
      "Operasi Data",
      actionLabel(item.action),
    );
  }

  for (const [key, label] of METADATA_FIELD_DEFINITIONS) {
    addDetailField(fields, key, label, metadata[key]);
  }

  if (kind === "IMPORT") {
    for (const [key, label] of IMPORT_SNAPSHOT_FIELD_DEFINITIONS) {
      addDetailField(
        fields,
        key,
        label,
        afterData[key] ?? beforeData[key],
      );
    }

    const stats = asRecord(metadata.stats);
    if (stats) {
      for (const [key, label] of Object.entries(IMPORT_STAT_LABELS)) {
        addDetailField(fields, key, label, stats[key]);
      }
    }
  }

  addStatusTransition(fields, item.before_data, item.after_data);

  const changedFields = changedFieldLabels(item.before_data, item.after_data);
  const targetPath =
    ENTITY_TARGET_PATHS[normalizedEntityType] ||
    MODULE_TARGET_PATHS[item.module] ||
    null;

  return {
    kind,
    title: contextTitle(kind),
    fields,
    changed_fields: changedFields,
    empty_message:
      fields.length === 0 && changedFields.length === 0
        ? "Detail tambahan tidak tercatat untuk aktivitas ini."
        : null,
    target_path: targetPath,
    target_label: targetPath ? "Buka Modul Terkait" : null,
  };
}

function resultMeta(responseStatus) {
  const status = Number(responseStatus);
  if (Number.isFinite(status) && status >= 200 && status < 400) {
    return { label: "Berhasil", tone: "emerald" };
  }
  if (Number.isFinite(status) && status >= 400) {
    return { label: "Gagal", tone: "red" };
  }
  return { label: "Tercatat", tone: "slate" };
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildWhere(query = {}) {
  const clauses = [];
  const search = normalizeText(query.search);

  if (search) {
    const contains = { contains: search, mode: "insensitive" };
    clauses.push({
      OR: [
        { title: contains },
        { summary: contains },
        { object_label: contains },
        { entity_type: contains },
        { module: contains },
        { action: contains },
        { actor: { is: { name: contains } } },
        { actor: { is: { username: contains } } },
        { actor: { is: { email: contains } } },
        { actor: { is: { role: { is: { name: contains } } } } },
        { actor: { is: { division: { is: { name: contains } } } } },
      ],
    });
  }

  if (query.module) clauses.push({ module: normalizeText(query.module) });
  if (query.action) clauses.push({ action: normalizeText(query.action) });
  if (query.actor_id) clauses.push({ actor_id: normalizeText(query.actor_id) });
  if (query.source) clauses.push({ source: normalizeText(query.source) });
  if (query.entity_type) {
    clauses.push({ entity_type: normalizeText(query.entity_type) });
  }

  const dateFrom = parseDate(query.date_from);
  const dateTo = parseDate(query.date_to);
  if (dateFrom || dateTo) {
    clauses.push({
      created_at: {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      },
    });
  }

  return clauses.length ? { AND: clauses } : {};
}

function getOrderBy(sort) {
  return [
    { created_at: sort === "oldest" ? "asc" : "desc" },
    { id: sort === "oldest" ? "asc" : "desc" },
  ];
}

function serializeActor(actor) {
  if (!actor) return null;
  return {
    id: actor.id,
    name: actor.name,
    username: actor.username,
    email: actor.email,
    role: actor.role ? { id: actor.role.id, name: actor.role.name } : null,
    division: actor.division
      ? { id: actor.division.id, name: actor.division.name }
      : null,
  };
}

function serialize(item) {
  return {
    id: item.id,
    actor_id: item.actor_id,
    actor: serializeActor(item.actor),
    module: item.module,
    module_label: MODULE_LABELS[item.module] || humanize(item.module),
    action: item.action,
    action_label: actionLabel(item.action),
    created_at: item.created_at,
  };
}

function serializeDetail(item) {
  const result = resultMeta(item.response_status);
  return {
    ...serialize(item),
    source: item.source,
    source_label: sourceLabel(item.source),
    entity_type: item.entity_type,
    entity_label: entityLabel(item.entity_type),
    entity_id: item.entity_id,
    object_label: safeText(item.object_label),
    title: safeText(item.title),
    summary: safeText(item.summary, 500),
    response_status: item.response_status,
    result_label: result.label,
    result_tone: result.tone,
    context: buildContext(item),
  };
}

exports.list = async (query = {}) => {
  const pagination = resolvePagination(query, PAGINATION_PROFILES.HISTORY);
  const where = buildWhere(query);
  const [items, total] = await Promise.all([
    repository.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: getOrderBy(query.sort),
    }),
    repository.count(where),
  ]);

  return {
    data: items.map((item) => serialize(item)),
    meta: buildPaginationMeta(total, pagination),
  };
};

exports.getById = async (id) => {
  const item = await repository.findById(id);
  if (!item) throw new AppError("Log aktivitas tidak ditemukan.", 404);
  return serializeDetail(item);
};

exports.summary = async (query = {}) => {
  const where = buildWhere(query);
  const [total, byModule, byAction] = await Promise.all([
    repository.count(where),
    repository.groupByModule(where),
    repository.groupByAction(where),
  ]);

  return {
    total,
    modules: byModule.map((item) => ({
      value: item.module,
      label: MODULE_LABELS[item.module] || item.module,
      total: item._count.id,
    })),
    actions: byAction.map((item) => ({
      value: item.action,
      label: actionLabel(item.action),
      total: item._count.id,
    })),
  };
};

exports.options = async () => {
  const [rows, actorRows] = await Promise.all([
    repository.distinctOptions(),
    repository.distinctActors(),
  ]);

  const unique = (key, labels = {}, supportedValues = []) =>
    [
      ...new Set([
        ...supportedValues,
        ...rows.map((item) => item[key]).filter(Boolean),
      ]),
    ]
      .sort((a, b) => String(labels[a] || a).localeCompare(String(labels[b] || b), "id"))
      .map((value) => ({ value, label: labels[value] || value }));

  return {
    modules: unique("module", MODULE_LABELS, Object.keys(MODULE_LABELS)),
    actions: unique("action", ACTION_LABELS, Object.keys(ACTION_LABELS)),
    sources: unique("source"),
    entity_types: unique("entity_type"),
    actors: actorRows
      .filter((item) => item.actor_id && item.actor)
      .map((item) => ({
        value: item.actor_id,
        label: item.actor.name || item.actor.username,
        username: item.actor.username,
        role: item.actor.role?.name || null,
        division: item.actor.division?.name || null,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "id")),
  };
};

function formatDateTime(value) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

function styleWorksheet(worksheet) {
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: "A1",
    to: `${worksheet.getColumn(worksheet.columnCount).letter}1`,
  };
  worksheet.getRow(1).height = 24;
  worksheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF157EC3" },
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
  });
}

exports.exportExcel = async (query = {}) => {
  const where = buildWhere(query);
  const rows = await repository.findAll({
    where,
    orderBy: getOrderBy(query.sort),
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Ruwang Arsip";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("Pusat Log Aktivitas");
  worksheet.columns = [
    { header: "No", key: "number", width: 8 },
    { header: "Tanggal & Waktu", key: "time", width: 24 },
    { header: "User", key: "actor", width: 24 },
    { header: "Username", key: "username", width: 20 },
    { header: "Role", key: "role", width: 18 },
    { header: "Divisi", key: "division", width: 22 },
    { header: "Modul", key: "module", width: 22 },
    { header: "Aksi", key: "action", width: 20 },
  ];

  rows.forEach((item, index) => {
    worksheet.addRow({
      number: index + 1,
      time: formatDateTime(item.created_at),
      actor: item.actor?.name || "-",
      username: item.actor?.username || "-",
      role: item.actor?.role?.name || "-",
      division: item.actor?.division?.name || "-",
      module: MODULE_LABELS[item.module] || humanize(item.module),
      action: actionLabel(item.action),
    });
  });

  styleWorksheet(worksheet);
  const buffer = await workbook.xlsx.writeBuffer();
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
  return {
    buffer,
    filename: `pusat-log-aktivitas-${stamp}.xlsx`,
  };
};

exports.buildWhere = buildWhere;
exports.serializeDetail = serializeDetail;
