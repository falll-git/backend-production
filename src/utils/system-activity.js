const SENSITIVE_KEYS = new Set([
  "password",
  "old_password",
  "new_password",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "file",
  "files",
  "raw_data",
  "raw",
]);

const MODULES = Object.freeze({
  AUTH: "AUTH",
  ARCHIVE: "ARSIP_DIGITAL",
  CORRESPONDENCE: "PERSURATAN",
  DEBTOR: "INFORMASI_DEBITUR",
  LEGAL: "MANAJEMEN_LEGAL",
  PARAMETER: "PARAMETER",
  USER_ACCESS: "USER_DAN_AKSES",
  NOTIFICATION: "NOTIFIKASI",
  SYSTEM: "SISTEM",
});

const MODULE_LABELS = Object.freeze({
  [MODULES.AUTH]: "Autentikasi",
  [MODULES.ARCHIVE]: "Arsip Digital",
  [MODULES.CORRESPONDENCE]: "Persuratan",
  [MODULES.DEBTOR]: "Informasi Debitur",
  [MODULES.LEGAL]: "Manajemen Legal",
  [MODULES.PARAMETER]: "Parameter",
  [MODULES.USER_ACCESS]: "User & Akses",
  [MODULES.NOTIFICATION]: "Notifikasi",
  [MODULES.SYSTEM]: "Sistem",
});

const ACTION_LABELS = Object.freeze({
  LOGIN: "Login",
  LOGOUT: "Logout",
  CHANGE_PASSWORD: "Ubah Password",
  CREATE: "Tambah Data",
  CREATED: "Input Baru",
  UPDATE: "Ubah Data",
  UPDATED: "Edit Data",
  DELETE: "Hapus Data",
  DELETED: "Penghapusan Data",
  APPROVE: "Setujui",
  REJECT: "Tolak",
  REVOKE: "Cabut Akses",
  HANDOVER: "Serahkan",
  RETURN: "Kembalikan",
  COMPLETE: "Selesaikan",
  REDISPOSE: "Redisposisi",
  IMPORT: "Impor",
  UPLOAD: "Unggah",
  RETRY: "Coba Ulang",
  RESTORE: "Pulihkan",
  ACTIVATE: "Aktifkan",
  DEACTIVATE: "Nonaktifkan",
  EXPORT: "Export",
  VIEW_FILE: "Buka File",
  ACCESS_REQUESTED: "Ajukan Akses",
  ACCESS_APPROVED: "Setujui Akses",
  ACCESS_REJECTED: "Tolak Akses",
  ACCESS_REVOKED: "Pencabutan Akses",
  LOAN_REQUESTED: "Ajukan Peminjaman",
  LOAN_APPROVED: "Setujui Peminjaman",
  LOAN_REJECTED: "Tolak Peminjaman",
  LOAN_HANDED_OVER: "Serahkan Dokumen",
  LOAN_RETURNED: "Kembalikan Dokumen",
  STORAGE_MOVED: "Pindahkan Penyimpanan",
  BULK_UPDATE_COLLATERAL_EXPIRY: "Upload Monitoring Expired",
  UPDATE_COLLATERAL_EXPIRY: "Ubah Monitoring Expired",
  UPLOAD_DOCUMENT: "Unggah Dokumen",
  UPLOAD_WARNING_LETTER: "Unggah Surat Peringatan",
  UPDATE_WARNING_LETTER: "Ubah Surat Peringatan",
  DELETE_WARNING_LETTER: "Hapus Surat Peringatan",
  RESOLVE_IDEB: "Hubungkan IDEB",
  UPLOAD_IDEB: "Unggah IDEB",
  IMPORT_QUEUED: "Antrekan Impor",
  IMPORT_PROCESSING: "Proses Impor",
  IMPORT_COMPLETED: "Impor Selesai",
  IMPORT_COMPLETED_WITH_ERRORS: "Impor Selesai dengan Catatan",
  IMPORT_FAILED: "Impor Gagal",
  IMPORT_RETRY: "Coba Ulang Impor",
});

const ROUTE_DEFINITIONS = [
  ["/api/digital-archive-files", MODULES.ARCHIVE, "DOKUMEN_ARSIP"],
  ["/api/watermarked-files", MODULES.ARCHIVE, "DOKUMEN_WATERMARK"],
  ["/api/digital-document-access-requests", MODULES.ARCHIVE, "DISPOSISI_DOKUMEN"],
  ["/api/digital-document-loans", MODULES.ARCHIVE, "PEMINJAMAN_DOKUMEN"],
  ["/api/digital-documents", MODULES.ARCHIVE, "DOKUMEN_DIGITAL"],
  ["/api/digital-archives", MODULES.ARCHIVE, "LAPORAN_ARSIP"],
  ["/api/storage-usage", MODULES.ARCHIVE, "PENGGUNAAN_STORAGE"],

  ["/api/persuratan-files", MODULES.CORRESPONDENCE, "FILE_PERSURATAN"],
  ["/api/incoming-mails", MODULES.CORRESPONDENCE, "SURAT_MASUK"],
  ["/api/outgoing-mails", MODULES.CORRESPONDENCE, "SURAT_KELUAR"],
  ["/api/memorandums", MODULES.CORRESPONDENCE, "MEMORANDUM"],
  ["/api/correspondence", MODULES.CORRESPONDENCE, "LAPORAN_PERSURATAN"],

  ["/api/debtor-warning-letters", MODULES.DEBTOR, "SURAT_PERINGATAN"],
  ["/api/debtor-ideb-reports", MODULES.DEBTOR, "IDEB"],
  ["/api/debtor-marketing", MODULES.DEBTOR, "AKTIVITAS_MARKETING"],
  ["/api/debtor-contracts", MODULES.DEBTOR, "KONTRAK_DEBITUR"],
  ["/api/debtor-imports", MODULES.DEBTOR, "IMPORT_SLIK"],
  ["/api/debtor-reports", MODULES.DEBTOR, "LAPORAN_DEBITUR"],
  ["/api/debtors", MODULES.DEBTOR, "DEBITUR"],

  ["/api/legal", MODULES.LEGAL, "DATA_LEGAL"],

  ["/api/collateral-types", MODULES.PARAMETER, "JENIS_AGUNAN"],
  ["/api/legal-process-types", MODULES.PARAMETER, "JENIS_PROSES_LEGAL"],
  ["/api/mail-delivery-media", MODULES.PARAMETER, "MEDIA_PENGIRIMAN"],
  ["/api/document-checklists", MODULES.PARAMETER, "CHECKLIST_DOKUMEN"],
  ["/api/financing-products", MODULES.PARAMETER, "PRODUK_PEMBIAYAAN"],
  ["/api/contract-types", MODULES.PARAMETER, "JENIS_AKAD"],
  ["/api/letter-priorities", MODULES.PARAMETER, "PRIORITAS_SURAT"],
  ["/api/document-types", MODULES.PARAMETER, "JENIS_DOKUMEN"],
  ["/api/third-parties", MODULES.PARAMETER, "PIHAK_KETIGA"],
  ["/api/deposit-types", MODULES.PARAMETER, "JENIS_TITIPAN"],
  ["/api/watermark-settings", MODULES.PARAMETER, "WATERMARK"],
  ["/api/branches", MODULES.PARAMETER, "CABANG"],
  ["/api/storages", MODULES.PARAMETER, "LOKASI_ARSIP"],

  ["/api/role-menus", MODULES.USER_ACCESS, "ROLE_MENU"],
  ["/api/divisions", MODULES.USER_ACCESS, "DIVISI"],
  ["/api/roles", MODULES.USER_ACCESS, "ROLE"],
  ["/api/users", MODULES.USER_ACCESS, "USER"],
  ["/api/menus", MODULES.USER_ACCESS, "MENU"],

  ["/api/notifications", MODULES.NOTIFICATION, "NOTIFIKASI"],
  ["/api/auth", MODULES.AUTH, "SESI"],
];

const TRACKED_GET_PATTERNS = [
  /\/export(?:\/|$|\?)/i,
  /\/download(?:\/|$|\?)/i,
  /\/preview(?:\/|$|\?)/i,
  /^\/api\/(?:digital-archive-files|persuratan-files|watermarked-files)(?:\/|$)/i,
];

function normalizePath(value) {
  return String(value || "").split("?")[0].replace(/\/+$/, "") || "/";
}

function normalizeRouteLookupPath(value) {
  return normalizePath(value).replace(/^\/api\/v\d+(?=\/|$)/i, "/api");
}

function resolveRouteDefinition(pathValue) {
  const path = normalizeRouteLookupPath(pathValue);
  const definition = ROUTE_DEFINITIONS.find(([prefix]) =>
    path === prefix || path.startsWith(`${prefix}/`),
  );

  if (!definition) {
    return {
      module: MODULES.SYSTEM,
      entity_type: "AKTIVITAS_SISTEM",
    };
  }

  return {
    module: definition[1],
    entity_type: definition[2],
  };
}

function classifyAction(methodValue, pathValue) {
  const method = String(methodValue || "GET").toUpperCase();
  const path = normalizeRouteLookupPath(pathValue).toLowerCase();

  if (path.endsWith("/login")) return "LOGIN";
  if (path.endsWith("/logout")) return "LOGOUT";
  if (path.endsWith("/change-password")) return "CHANGE_PASSWORD";
  if (/\/approve(?:\/|$)/.test(path)) return "APPROVE";
  if (/\/reject(?:\/|$)/.test(path)) return "REJECT";
  if (/\/revoke(?:\/|$)/.test(path)) return "REVOKE";
  if (/\/handover(?:\/|$)/.test(path)) return "HANDOVER";
  if (/\/return(?:\/|$)/.test(path)) return "RETURN";
  if (/\/(?:complete|finish)(?:\/|$)/.test(path)) return "COMPLETE";
  if (/\/redispose(?:\/|$)/.test(path)) return "REDISPOSE";
  if (/\/retry(?:\/|$)/.test(path)) return "RETRY";
  if (/\/restore(?:\/|$)/.test(path)) return "RESTORE";
  if (/\/(?:reactivate|activate)(?:\/|$)/.test(path)) return "ACTIVATE";
  if (/\/deactivate(?:\/|$)/.test(path)) return "DEACTIVATE";
  if (/\/export(?:\/|$)/.test(path)) return "EXPORT";
  if (/\/download(?:\/|$)/.test(path)) return "VIEW_FILE";
  if (/\/preview(?:\/|$)/.test(path)) return "VIEW_FILE";
  if (TRACKED_GET_PATTERNS.slice(3).some((pattern) => pattern.test(path))) {
    return "VIEW_FILE";
  }
  if (/\/import(?:\/|$)/.test(path)) return "IMPORT";
  if (/\/upload(?:\/|$)/.test(path)) return "UPLOAD";
  if (method === "POST") return "CREATE";
  if (method === "PUT" || method === "PATCH") return "UPDATE";
  if (method === "DELETE") return "DELETE";
  return null;
}

function isSuccessfulStatus(statusCode) {
  return Number(statusCode) >= 200 && Number(statusCode) < 400;
}

function shouldTrackRequest({ method, path, statusCode }) {
  if (!isSuccessfulStatus(statusCode)) return false;

  const normalizedPath = normalizeRouteLookupPath(path);
  if (
    normalizedPath === "/api" ||
    normalizedPath === "/api/health" ||
    normalizedPath === "/health" ||
    (normalizedPath.startsWith("/api/activity-centre") &&
      !/\/export(?:\/|$)/i.test(normalizedPath))
  ) {
    return false;
  }

  if (
    /\/auth\/(?:refresh|forgot-password|reset-password|set-password)(?:\/|$)/i.test(
      normalizedPath,
    )
  ) {
    return false;
  }

  const normalizedMethod = String(method || "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(normalizedMethod)) {
    return Boolean(classifyAction(normalizedMethod, normalizedPath));
  }

  return (
    normalizedMethod === "GET" &&
    TRACKED_GET_PATTERNS.some((pattern) => pattern.test(normalizedPath))
  );
}

function isSensitiveKey(keyValue) {
  const normalized = String(keyValue || "").toLowerCase();
  return (
    SENSITIVE_KEYS.has(normalized) ||
    normalized.includes("password") ||
    normalized.includes("token") ||
    normalized.includes("secret")
  );
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function unwrapResponseData(value) {
  let current = asRecord(value);
  for (let depth = 0; depth < 3 && current; depth += 1) {
    const next = asRecord(current.data);
    if (!next) break;
    current = next;
  }
  return current;
}

function firstSafeString(record, keys) {
  for (const key of keys) {
    if (isSensitiveKey(key)) continue;
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function extractSafeResponseContext(body) {
  const root = asRecord(body);
  const data = unwrapResponseData(body);
  const record = data || root || {};
  return {
    actor_id: firstSafeString(record, ["id", "user_id"]),
    entity_id: firstSafeString(record, [
      "id",
      "document_id",
      "debtor_id",
      "contract_id",
      "mail_id",
      "memorandum_id",
    ]),
    object_label: firstSafeString(record, [
      "document_number",
      "mail_number",
      "memo_number",
      "no_kontrak",
      "debtor_number",
      "username",
      "name",
      "title",
      "code",
    ]),
    message: firstSafeString(root, ["message"]),
  };
}

function extractPathEntityId(pathValue) {
  const path = normalizePath(pathValue);
  const segments = path.split("/").filter(Boolean);
  const candidate = segments.at(-1);
  if (!candidate) return null;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(candidate)) return candidate;
  if (/^\d+$/.test(candidate)) return candidate;
  return null;
}

function buildActivityPayload({
  actor_id,
  method,
  path,
  statusCode,
  requestId,
  userAgent,
  responseContext = {},
}) {
  const route = resolveRouteDefinition(path);
  const action = classifyAction(method, path);
  const actionLabel = ACTION_LABELS[action] || action || "Aktivitas";
  const moduleLabel = MODULE_LABELS[route.module] || route.module;
  const entityId = responseContext.entity_id || extractPathEntityId(path);
  const objectLabel = responseContext.object_label || entityId || null;
  const responseMessage = responseContext.message || null;

  return {
    actor_id: actor_id || null,
    module: route.module,
    action: action || "ACTIVITY",
    source: "API",
    entity_type: route.entity_type,
    entity_id: entityId,
    object_label: objectLabel,
    title: `${actionLabel} ${moduleLabel}`,
    summary: responseMessage || `${actionLabel} pada ${moduleLabel}`,
    request_method: String(method || "").toUpperCase() || null,
    request_path: normalizePath(path),
    response_status: Number(statusCode) || null,
    request_id: requestId || null,
    metadata: objectLabel ? { object_label: objectLabel } : undefined,
    user_agent: userAgent || null,
  };
}

module.exports = {
  ACTION_LABELS,
  MODULES,
  MODULE_LABELS,
  buildActivityPayload,
  classifyAction,
  extractSafeResponseContext,
  resolveRouteDefinition,
  shouldTrackRequest,
};
