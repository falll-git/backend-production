const incomingMailService = require("../incoming-mail/incomingMail.service");
const outgoingMailService = require("../outgoing-mails/outgoingMails.service");
const memorandumService = require("../memorandum/memorandum.service");
const { AppError } = require("../../utils/errors");
const {
  buildReportSummary,
  toPrintableDocumentItems,
} = require("../../utils/persuratan-serializer");
const { REPORT_ALL_FEATURE } = require("../../utils/menu-access");
const { resolveRequestUser, roleHasFeature } = require("../../utils/rbac");

const ACTIVE_MY_DISPOSITION_STATUSES = new Set(["NEW", "IN_PROGRESS"]);
const REPORT_MENU_URL = "/dashboard/manajemen-surat/laporan";
const PRINT_DOCUMENTS_MENU_URL = "/dashboard/manajemen-surat/cetak-dokumen";

function normalizeKind(value) {
  const normalized = String(value || "all")
    .trim()
    .toLowerCase();

  if (
    normalized === "incoming-mail" ||
    normalized === "incoming_mails" ||
    normalized === "incoming-mails" ||
    normalized === "surat-masuk"
  ) {
    return "incoming-mail";
  }

  if (
    normalized === "outgoing-mail" ||
    normalized === "outgoing_mails" ||
    normalized === "outgoing-mails" ||
    normalized === "surat-keluar"
  ) {
    return "outgoing-mail";
  }

  if (normalized === "memorandum" || normalized === "memorandums") {
    return "memorandum";
  }

  return "all";
}

function hasScopeInput(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function normalizeScope(value, fallback = "my") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (
    normalized === "my" ||
    normalized === "mine" ||
    normalized === "me" ||
    normalized === "saya" ||
    normalized === "laporan-saya" ||
    normalized === "cetak-saya"
  ) {
    return "my";
  }

  if (
    normalized === "all" ||
    normalized === "semua" ||
    normalized === "laporan-semua" ||
    normalized === "cetak-semua"
  ) {
    return "all";
  }

  return fallback;
}

function normalizeMyFilter(value, scope) {
  if (scope !== "my") {
    return "all";
  }

  const normalized = String(value || "all")
    .trim()
    .toLowerCase();

  if (
    normalized === "active" ||
    normalized === "aktif" ||
    normalized === "masih-aktif" ||
    normalized === "masih_aktif"
  ) {
    return "active";
  }

  if (
    normalized === "completed" ||
    normalized === "selesai" ||
    normalized === "done"
  ) {
    return "completed";
  }

  if (
    normalized === "forwarded" ||
    normalized === "diteruskan" ||
    normalized === "redisposed"
  ) {
    return "forwarded";
  }

  return "all";
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "ya"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "tidak"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function stripPagination(query) {
  return {
    ...query,
    page: undefined,
    limit: undefined,
  };
}

function toDispositionStatus(item) {
  return String(item?.status_key || item?.status || "")
    .trim()
    .toUpperCase();
}

function matchesMyDispositionFilter(dispositions, userId, myFilter) {
  const relatedDispositions = dispositions.filter(
    (item) => String(item.receiver_id) === String(userId),
  );

  if (relatedDispositions.length === 0) {
    return false;
  }

  if (myFilter === "all") {
    return true;
  }

  if (myFilter === "active") {
    return relatedDispositions.some((item) =>
      ACTIVE_MY_DISPOSITION_STATUSES.has(toDispositionStatus(item)),
    );
  }

  if (myFilter === "completed") {
    return relatedDispositions.some(
      (item) => toDispositionStatus(item) === "COMPLETED",
    );
  }

  if (myFilter === "forwarded") {
    return relatedDispositions.some(
      (item) => toDispositionStatus(item) === "FORWARDED",
    );
  }

  return true;
}

function filterIncomingRecordsForScope(records, { scope, myFilter, userId }) {
  if (scope !== "my") {
    return records;
  }

  return records.filter((item) =>
    matchesMyDispositionFilter(item.disposition_mails || [], userId, myFilter),
  );
}

function filterMemorandumRecordsForScope(records, { scope, myFilter, userId }) {
  if (scope !== "my") {
    return records;
  }

  return records.filter((item) =>
    matchesMyDispositionFilter(item.dispositions || [], userId, myFilter),
  );
}

function filterPrintableRecords(records, onlyWithFile) {
  if (!onlyWithFile) {
    return records;
  }

  return records.filter((item) => Boolean(item.file_url || item.file));
}

function getDispositionBasedScopes(canReportAll) {
  return canReportAll ? ["my", "all"] : ["my"];
}

function buildDocumentScopeMetadata({ kind, canReportAll }) {
  const dispositionScopes = getDispositionBasedScopes(canReportAll);
  const allDocumentScopes = {
    incoming_mails: {
      kind: "incoming-mail",
      available_scopes: dispositionScopes,
      scope_applies: true,
      scope_basis: "disposition_receiver",
    },
    outgoing_mails: {
      kind: "outgoing-mail",
      available_scopes: ["all"],
      scope_applies: false,
      scope_basis: "document_collection",
    },
    memorandums: {
      kind: "memorandum",
      available_scopes: dispositionScopes,
      scope_applies: true,
      scope_basis: "disposition_receiver",
    },
  };

  if (kind === "incoming-mail") {
    return { incoming_mails: allDocumentScopes.incoming_mails };
  }

  if (kind === "outgoing-mail") {
    return { outgoing_mails: allDocumentScopes.outgoing_mails };
  }

  if (kind === "memorandum") {
    return { memorandums: allDocumentScopes.memorandums };
  }

  return allDocumentScopes;
}

function buildScopedQuery(query, scope, userId) {
  if (scope !== "my") {
    return query;
  }

  return {
    ...query,
    assigned_to_me: undefined,
    receiver_id: userId,
  };
}

async function resolveReportScope({
  requestUser,
  query,
  kind,
  scopeMenuUrl = REPORT_MENU_URL,
}) {
  const user = await resolveRequestUser(requestUser);
  if (!user) {
    throw new AppError("Sesi pengguna tidak valid.", 401);
  }

  if (kind === "outgoing-mail") {
    return {
      user,
      scope: "all",
      requested_scope: hasScopeInput(query.scope)
        ? normalizeScope(query.scope, "all")
        : null,
      available_scopes: ["all"],
      can_report_all: false,
    };
  }

  const canReportAll = await roleHasFeature(
    user.role_id,
    scopeMenuUrl,
    REPORT_ALL_FEATURE,
  );
  const requestedScope = hasScopeInput(query.scope)
    ? normalizeScope(query.scope, "my")
    : null;

  if (requestedScope === "all" && !canReportAll) {
    throw new AppError(
      "Anda tidak memiliki izin untuk melihat laporan semua.",
      403,
    );
  }

  return {
    user,
    scope: requestedScope || "my",
    requested_scope: requestedScope,
    available_scopes: canReportAll ? ["my", "all"] : ["my"],
    can_report_all: canReportAll,
  };
}

exports.getReport = async ({
  req,
  query,
  userId,
  requestUser,
  scopeMenuUrl = REPORT_MENU_URL,
}) => {
  const kind = normalizeKind(query.kind);
  const scopeAccess = await resolveReportScope({
    requestUser,
    query,
    kind,
    scopeMenuUrl,
  });
  const scope = scopeAccess.scope;
  const myFilter = normalizeMyFilter(query.my_filter, scope);
  const listQuery = stripPagination(query);
  const scopedIncomingQuery = buildScopedQuery(listQuery, scope, userId);
  const scopedMemorandumQuery = buildScopedQuery(listQuery, scope, userId);
  const incoming =
    kind === "all" || kind === "incoming-mail"
      ? await incomingMailService.getIncomingMails({
          req,
          query: scopedIncomingQuery,
          userId,
        })
      : { data: [] };
  const outgoing =
    kind === "all" || kind === "outgoing-mail"
      ? await outgoingMailService.getAll({ req, query: listQuery })
      : { data: [] };
  const memorandums =
    kind === "all" || kind === "memorandum"
      ? await memorandumService.getMemorandums({
          req,
          query: scopedMemorandumQuery,
          userId,
        })
      : { data: [] };

  const filteredIncoming = filterIncomingRecordsForScope(incoming.data, {
    scope,
    myFilter,
    userId,
  });
  const filteredOutgoing = outgoing.data;
  const filteredMemorandums = filterMemorandumRecordsForScope(
    memorandums.data,
    {
      scope,
      myFilter,
      userId,
    },
  );

  return {
    filters: {
      scope,
      requested_scope: scopeAccess.requested_scope,
      available_scopes: scopeAccess.available_scopes,
      can_report_all: scopeAccess.can_report_all,
      my_filter: scope === "my" ? myFilter : null,
      scope_applies_to:
        kind === "outgoing-mail" ? [] : ["incoming_mails", "memorandums"],
      document_scopes: buildDocumentScopeMetadata({
        kind,
        canReportAll: scopeAccess.can_report_all,
      }),
    },
    summary: buildReportSummary({
      incoming: filteredIncoming,
      outgoing: filteredOutgoing,
      memorandums: filteredMemorandums,
    }),
    records: {
      incoming_mails: filteredIncoming,
      outgoing_mails: filteredOutgoing,
      memorandums: filteredMemorandums,
    },
  };
};

exports.getPrintableDocuments = async ({ req, query, userId, requestUser }) => {
  const report = await exports.getReport({
    req,
    query,
    userId,
    requestUser,
    scopeMenuUrl: PRINT_DOCUMENTS_MENU_URL,
  });
  const onlyWithFile = parseBoolean(query.only_with_file, true);
  const printableIncoming = filterPrintableRecords(
    report.records.incoming_mails,
    onlyWithFile,
  );
  const printableOutgoing = filterPrintableRecords(
    report.records.outgoing_mails,
    onlyWithFile,
  );
  const printableMemorandums = filterPrintableRecords(
    report.records.memorandums,
    onlyWithFile,
  );

  const items = toPrintableDocumentItems({
    incoming: printableIncoming,
    outgoing: printableOutgoing,
    memorandums: printableMemorandums,
  });

  return {
    filters: {
      ...report.filters,
      only_with_file: onlyWithFile,
    },
    summary: buildReportSummary({
      incoming: printableIncoming,
      outgoing: printableOutgoing,
      memorandums: printableMemorandums,
    }),
    total: items.length,
    items,
  };
};
