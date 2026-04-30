const incomingMailService = require("../incoming-mail/incomingMail.service");
const outgoingMailService = require("../outgoing-mails/outgoingMails.service");
const memorandumService = require("../memorandum/memorandum.service");
const {
  buildReportSummary,
  toPrintableDocumentItems,
} = require("../../utils/persuratan-serializer");

const ACTIVE_MY_DISPOSITION_STATUSES = new Set(["NEW", "IN_PROGRESS"]);

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

function normalizeScope(value) {
  const normalized = String(value || "all")
    .trim()
    .toLowerCase();

  if (
    normalized === "my" ||
    normalized === "mine" ||
    normalized === "me" ||
    normalized === "saya" ||
    normalized === "laporan-saya"
  ) {
    return "my";
  }

  return "all";
}

function normalizeMyFilter(value, scope) {
  if (scope !== "my") {
    return "all";
  }

  const normalized = String(value || "active")
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

function filterOutgoingRecordsForScope(records, { scope }) {
  if (scope !== "my") {
    return records;
  }

  return [];
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

exports.getReport = async ({ req, query, userId }) => {
  const kind = normalizeKind(query.kind);
  const scope = normalizeScope(query.scope);
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
  const filteredOutgoing = filterOutgoingRecordsForScope(outgoing.data, {
    scope,
  });
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
      my_filter: scope === "my" ? myFilter : null,
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

exports.getPrintableDocuments = async ({ req, query, userId }) => {
  const report = await exports.getReport({ req, query, userId });
  const onlyWithFile = String(query.only_with_file).toLowerCase() === "true";

  const items = toPrintableDocumentItems({
    incoming: report.records.incoming_mails,
    outgoing: report.records.outgoing_mails,
    memorandums: report.records.memorandums,
  }).filter((item) => (onlyWithFile ? Boolean(item.file_url) : true));

  return {
    summary: report.summary,
    total: items.length,
    items,
  };
};
