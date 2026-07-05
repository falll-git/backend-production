const repository = require("./legal.repository");
const { AppError } = require("../../utils/errors");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  resolvePagination,
} = require("../../utils/pagination");
const {
  normalizeUploadFiles,
  persistDomainFiles,
  serializeFile,
  serializeFiles,
} = require("../../utils/domain-files");
const {
  LEGAL_DATA_SCOPE_URLS,
  buildContractManageWhere,
  buildContractVisibilityWhere,
  buildDebtorManageWhere,
  getDebtorAccessScope,
} = require("../../utils/debtor-access");
const { REPORT_ALL_FEATURE } = require("../../utils/menu-access");
const { roleHasFeature } = require("../../utils/rbac");
const {
  auditSnapshot,
  requestMetadata,
  safeRecordLegalActivity,
} = require("../../utils/legal-audit-log");

const LEGAL_REPORT_URLS = {
  summary: "/dashboard/legal/laporan",
  thirdPartyDocuments: "/dashboard/legal/laporan/pihak-ketiga/dokumen",
  thirdPartyDepositFunds: "/dashboard/legal/laporan/pihak-ketiga/dana-titipan",
  activity: "/dashboard/legal/laporan",
};

const DEPOSIT_THIRD_PARTY_CATEGORY_BY_TYPE = {
  NOTARIS: "NOTARY",
  ASURANSI: "INSURANCE",
};
const DEPOSIT_TYPES = new Set(["NOTARIS", "ASURANSI", "ANGSURAN", "LAINNYA"]);
const DEPOSIT_TRANSACTION_ACTIONS = new Set(["TITIPAN", "PEMBAYARAN", "REFUND"]);
const LEGAL_PROCESS_CATEGORY_BY_THIRD_PARTY = {
  NOTARY: "NOTARY_DEED",
  INSURANCE: "INSURANCE_TYPE",
  KJPP: "KJPP_APPRAISAL",
};

const LEGAL_AUDIT_ENTITY_BY_MODEL = {
  legal_notary_progress: "LEGAL_NOTARY_PROGRESS",
  legal_insurance_progress: "LEGAL_INSURANCE_PROGRESS",
  legal_kjpp_progress: "LEGAL_KJPP_PROGRESS",
  legal_claims: "LEGAL_CLAIM",
  legal_deposits: "LEGAL_DEPOSIT",
  legal_deposit_transactions: "LEGAL_DEPOSIT_TRANSACTION",
};

const LEGAL_AUDIT_LABEL_BY_MODEL = {
  legal_notary_progress: "progress notaris",
  legal_insurance_progress: "progress asuransi",
  legal_kjpp_progress: "progress KJPP",
  legal_claims: "klaim asuransi",
  legal_deposits: "dana titipan",
  legal_deposit_transactions: "transaksi titipan",
};

const LEGAL_AUDIT_FIELDS_BY_MODEL = {
  legal_notary_progress: [
    "id",
    "contract_id",
    "collateral_id",
    "third_party_id",
    "deed_type",
    "received_at",
    "estimated_completed_at",
    "completed_at",
    "status",
    "deed_number",
    "notes",
    "file_name",
    "file_path",
  ],
  legal_insurance_progress: [
    "id",
    "contract_id",
    "collateral_id",
    "third_party_id",
    "insurance_type",
    "coverage_amount",
    "premium_amount",
    "period_start",
    "period_end",
    "policy_number",
    "status",
    "notes",
    "file_name",
    "file_path",
  ],
  legal_kjpp_progress: [
    "id",
    "contract_id",
    "collateral_id",
    "third_party_id",
    "appraisal_type",
    "received_at",
    "estimated_completed_at",
    "completed_at",
    "status",
    "report_number",
    "collateral_object",
    "appraisal_value",
    "notes",
    "file_name",
    "file_path",
  ],
  legal_claims: [
    "id",
    "contract_id",
    "collateral_id",
    "insurance_progress_id",
    "policy_number",
    "claim_type",
    "claim_amount",
    "submitted_at",
    "status",
    "approved_amount",
    "disbursed_amount",
    "disbursed_at",
    "rejection_reason",
    "notes",
    "file_name",
    "file_path",
  ],
  legal_deposits: [
    "id",
    "deposit_type_id",
    "type",
    "contract_id",
    "third_party_id",
    "nominal",
    "paid_amount",
    "processed_amount",
    "remaining_amount",
    "status",
    "notes",
  ],
  legal_deposit_transactions: [
    "id",
    "deposit_id",
    "transaction_date",
    "action",
    "amount",
    "notes",
    "file_name",
    "file_path",
  ],
};

function buildStoredFiles(fileMetas = []) {
  return fileMetas.map((fileMeta) => ({
    file_path: fileMeta.file_path,
    file_name: fileMeta.file_name,
    mime_type: fileMeta.mime_type,
    size_bytes: fileMeta.size_bytes,
    checksum: fileMeta.checksum,
  }));
}

function normalizeText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = String(value).trim().replace(/\s+/g, " ");
  return normalized || null;
}

function normalizeUpper(value) {
  const text = normalizeText(value);
  return typeof text === "string" ? text.toUpperCase() : text;
}

function number(value) {
  return Number(value || 0);
}

function toJsonSafe(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, toJsonSafe(nested)]),
    );
  }
  return value;
}

function serializeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    division_id: user.division_id,
    division_name: user.division?.name ?? null,
  };
}

function serializeAuditContract(contract) {
  if (!contract) return null;
  return {
    id: contract.id,
    no_kontrak: contract.no_kontrak,
    status: contract.status,
    debtor: contract.debtor
      ? {
          id: contract.debtor.id,
          debtor_number: contract.debtor.debtor_number,
          identity_number: contract.debtor.identity_number,
          name: contract.debtor.name,
        }
      : null,
  };
}

function serializeActivityLog(item) {
  if (!item) return null;
  return {
    id: item.id,
    actor_id: item.actor_id,
    actor: serializeUser(item.actor),
    action: item.action,
    source: item.source,
    entity_type: item.entity_type,
    entity_id: item.entity_id,
    debtor_id: item.debtor_id,
    contract_id: item.contract_id,
    collateral_id: item.collateral_id,
    third_party_id: item.third_party_id,
    deposit_id: item.deposit_id,
    deposit_transaction_id: item.deposit_transaction_id,
    title: item.title,
    before_data: toJsonSafe(item.before_data),
    after_data: toJsonSafe(item.after_data),
    metadata: toJsonSafe(item.metadata),
    request_ip: item.request_ip,
    user_agent: item.user_agent,
    created_at: item.created_at,
    contract: serializeAuditContract(item.contract),
    third_party: item.third_party
      ? {
          id: item.third_party.id,
          code: item.third_party.code,
          name: item.third_party.name,
          category: item.third_party.category,
        }
      : null,
  };
}

function pickRecordDebtorId(record) {
  return (
    record?.contract?.debtor?.id ||
    record?.contract?.debtor_id ||
    record?.deposit?.contract?.debtor?.id ||
    null
  );
}

function buildLegalAuditContext(record) {
  if (!record) return {};
  return {
    debtor_id: pickRecordDebtorId(record),
    contract_id: record.contract_id || record.deposit?.contract_id || null,
    collateral_id:
      record.collateral_id ||
      record.insurance_progress?.collateral_id ||
      null,
    third_party_id:
      record.third_party_id ||
      record.insurance_progress?.third_party_id ||
      record.deposit?.third_party_id ||
      null,
    deposit_id: record.deposit_id || record.deposit?.id || null,
    deposit_transaction_id:
      record.deposit_id && record.action ? record.id : null,
  };
}

function buildLegalAuditTitle(action, modelName, record) {
  const label = LEGAL_AUDIT_LABEL_BY_MODEL[modelName] || "aktivitas legal";
  const contractNo =
    record?.contract?.no_kontrak ||
    record?.deposit?.contract?.no_kontrak ||
    null;
  const suffix = contractNo ? ` - ${contractNo}` : "";
  return `${action} ${label}${suffix}`;
}

async function recordLegalAudit(db, {
  req,
  actorId,
  action,
  modelName,
  before,
  after,
  metadata,
}) {
  const target = after || before || {};
  await safeRecordLegalActivity(db, {
    ...requestMetadata(req),
    ...buildLegalAuditContext(target),
    actor_id: actorId || null,
    action,
    source: "MANUAL",
    entity_type: LEGAL_AUDIT_ENTITY_BY_MODEL[modelName] || modelName,
    entity_id: target.id || null,
    title: buildLegalAuditTitle(action, modelName, target),
    before_data: auditSnapshot(before, LEGAL_AUDIT_FIELDS_BY_MODEL[modelName] || []),
    after_data: auditSnapshot(after, LEGAL_AUDIT_FIELDS_BY_MODEL[modelName] || []),
    metadata,
  });
}

function buildSearchWhere(search, fields, relationSearch = null) {
  const normalized = normalizeText(search);
  if (!normalized) return {};

  const contains = {
    contains: normalized,
    mode: "insensitive",
  };
  const relationClauses =
    typeof relationSearch === "function" ? relationSearch(contains) : [];
  const clauses = [
    ...fields.map((field) => ({
      [field]: contains,
    })),
    ...(Array.isArray(relationClauses) ? relationClauses : []),
  ];

  if (clauses.length === 0) return {};

  return {
    OR: clauses,
  };
}

function listWhere(query, extra = {}, fields = [], options = {}) {
  const clauses = [];
  if (options.includeSoftDeleteFilter !== false) {
    clauses.push({ deleted_at: null });
  }
  clauses.push(extra || {});
  const search = buildSearchWhere(query.search, fields, options.relationSearch);
  if (Object.keys(search).length) clauses.push(search);
  if (query.status) clauses.push({ status: normalizeUpper(query.status) });
  if (query.contract_id) clauses.push({ contract_id: query.contract_id });
  if (query.collateral_id) clauses.push({ collateral_id: query.collateral_id });
  if (query.third_party_id) clauses.push({ third_party_id: query.third_party_id });
  if (query.type) clauses.push({ type: normalizeUpper(query.type) });

  return { AND: clauses.filter((item) => Object.keys(item).length > 0) };
}

function contractSearchClauses(contains) {
  return [
    { contract: { is: { no_kontrak: contains } } },
    { contract: { is: { debtor: { is: { name: contains } } } } },
    { contract: { is: { debtor: { is: { debtor_number: contains } } } } },
    { contract: { is: { debtor: { is: { identity_number: contains } } } } },
  ];
}

function progressSearchClauses(contains) {
  return [
    ...contractSearchClauses(contains),
    { third_party: { is: { name: contains } } },
    { third_party: { is: { code: contains } } },
  ];
}

function claimSearchClauses(contains) {
  return [
    ...contractSearchClauses(contains),
    {
      insurance_progress: {
        is: {
          third_party: {
            is: {
              name: contains,
            },
          },
        },
      },
    },
    {
      insurance_progress: {
        is: {
          third_party: {
            is: {
              code: contains,
            },
          },
        },
      },
    },
  ];
}

function depositSearchClauses(contains) {
  return [
    ...contractSearchClauses(contains),
    { third_party: { is: { name: contains } } },
    { third_party: { is: { code: contains } } },
    { deposit_type: { is: { name: contains } } },
  ];
}

function depositTransactionSearchClauses(contains) {
  return [
    { deposit: { is: { contract: { is: { no_kontrak: contains } } } } },
    { deposit: { is: { contract: { is: { debtor: { is: { name: contains } } } } } } },
    { deposit: { is: { contract: { is: { debtor: { is: { debtor_number: contains } } } } } } },
    { deposit: { is: { contract: { is: { debtor: { is: { identity_number: contains } } } } } } },
    { deposit: { is: { third_party: { is: { name: contains } } } } },
    { deposit: { is: { third_party: { is: { code: contains } } } } },
  ];
}

function parseDateBoundary(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date;
}

async function buildActivityLogWhere(query = {}, userId = null) {
  const scope = await getLegalReportScope(userId, LEGAL_REPORT_URLS.activity);
  const clauses = [];
  const contractAccessWhere = buildContractAccessWhereFromScope(scope);
  if (!isEmptyObject(contractAccessWhere)) clauses.push(contractAccessWhere);

  const search = normalizeText(query.search);
  if (search) {
    const contains = {
      contains: search,
      mode: "insensitive",
    };
    clauses.push({
      OR: [
        { title: contains },
        { action: contains },
        { entity_type: contains },
        { contract: { is: { no_kontrak: contains } } },
        { contract: { is: { debtor: { is: { name: contains } } } } },
        { third_party: { is: { name: contains } } },
      ],
    });
  }

  if (query.action) clauses.push({ action: normalizeUpper(query.action) });
  if (query.source) clauses.push({ source: normalizeUpper(query.source) });
  if (query.entity_type) clauses.push({ entity_type: normalizeUpper(query.entity_type) });
  if (query.contract_id) clauses.push({ contract_id: query.contract_id });
  if (query.debtor_id) clauses.push({ debtor_id: query.debtor_id });
  if (query.third_party_id) clauses.push({ third_party_id: query.third_party_id });
  if (query.actor_id) clauses.push({ actor_id: query.actor_id });

  const dateFrom = parseDateBoundary(query.date_from || query.start_date);
  const dateTo = parseDateBoundary(query.date_to || query.end_date, true);
  if (dateFrom || dateTo) {
    clauses.push({
      created_at: {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      },
    });
  }

  return {
    where: clauses.length ? { AND: clauses } : {},
    scope,
  };
}

function paginate(query) {
  return resolvePagination(query, PAGINATION_PROFILES.TABLE);
}

function serializeWithFile(req, item, fallbackBaseName = "dokumen") {
  return {
    ...item,
    file: serializeFile(req, item, {
      module: "legal_management",
      entityId: item.id,
      fallbackBaseName,
    }),
    files: serializeFiles(req, item, {
      module: "legal_management",
      fallbackBaseName,
    }),
  };
}

function normalizeDepositAction(action) {
  const normalized = normalizeUpper(action);
  if (!normalized) return null;
  if (normalized === "TITIPAN") return "TITIPAN";
  if (["PEMBAYARAN", "BAYAR", "PAID", "PROSES", "PROCESS", "KOREKSI"].includes(normalized)) {
    return "PEMBAYARAN";
  }
  if (normalized === "REFUND") return "REFUND";
  return normalized;
}

function assertDepositType(value) {
  const type = normalizeUpper(value);
  if (!DEPOSIT_TYPES.has(type)) {
    throw new AppError("Tipe dana titipan tidak valid.", 422);
  }
  return type;
}

function assertDepositTransactionAction(value) {
  const action = normalizeDepositAction(value);
  if (!DEPOSIT_TRANSACTION_ACTIONS.has(action)) {
    throw new AppError("Jenis transaksi dana titipan tidak valid.", 422);
  }
  return action;
}

function depositTransactionFile(req, item) {
  return serializeFile(req, item, {
    module: "legal_management",
    entityId: item.id,
    fallbackBaseName: `bukti-${normalizeDepositAction(item.action) || "titipan"}`,
  });
}

function depositTransactionFileFields(fileMeta) {
  if (!fileMeta) return {};
  return {
    file_path: fileMeta.file_path,
    file_name: fileMeta.file_name,
    mime_type: fileMeta.mime_type,
    size_bytes: fileMeta.size_bytes,
  };
}

function serializeDepositTransaction(req, item) {
  const action = normalizeDepositAction(item.action) || item.action;
  return {
    ...item,
    action,
    raw_action: item.action,
    amount: number(item.amount),
    file: depositTransactionFile(req, item),
    files: serializeFiles(req, item, {
      module: "legal_management",
      fallbackBaseName: `bukti-${action || "titipan"}`,
    }),
  };
}

function calculateDepositLedgerTotals(transactions = []) {
  const totals = {
    total_deposit_amount: 0,
    total_payment_amount: 0,
    total_refund_amount: 0,
    balance_amount: 0,
  };

  for (const transaction of transactions) {
    const action = normalizeDepositAction(transaction.action);
    const amount = number(transaction.amount);
    if (action === "TITIPAN") totals.total_deposit_amount += amount;
    if (action === "PEMBAYARAN") totals.total_payment_amount += amount;
    if (action === "REFUND") totals.total_refund_amount += amount;
  }

  totals.balance_amount = Math.max(
    totals.total_deposit_amount -
      totals.total_payment_amount -
      totals.total_refund_amount,
    0,
  );
  return totals;
}

function resolveDepositStatus(totals) {
  const hasActivity =
    totals.total_deposit_amount > 0 ||
    totals.total_payment_amount > 0 ||
    totals.total_refund_amount > 0;
  if (!hasActivity) return "PENDING";
  return totals.balance_amount > 0 ? "AKTIF" : "SELESAI";
}

function normalizeInsuranceStatus(status) {
  const normalized = normalizeUpper(status);
  if (!normalized || normalized === "PROSES") return "AKTIF";
  return normalized;
}

function serializeInsuranceProgress(req, item) {
  return {
    ...serializeWithFile(req, item, item.insurance_type),
    status: normalizeInsuranceStatus(item.status),
    coverage_amount: number(item.coverage_amount),
    premium_amount: number(item.premium_amount),
  };
}

function serializeDeposit(req, item) {
  const totalDeposit = number(item.total_deposit_amount ?? item.nominal);
  const totalPayment = number(item.total_payment_amount ?? item.paid_amount);
  const totalRefund = number(item.total_refund_amount ?? item.processed_amount);
  const balance = number(item.balance_amount ?? item.remaining_amount);
  return {
    ...item,
    nominal: totalDeposit,
    paid_amount: totalPayment,
    processed_amount: totalRefund,
    remaining_amount: balance,
    total_deposit_amount: totalDeposit,
    total_payment_amount: totalPayment,
    total_refund_amount: totalRefund,
    balance_amount: balance,
    transactions: Array.isArray(item.transactions)
      ? item.transactions.map((transaction) => serializeDepositTransaction(req, transaction))
      : [],
  };
}

function serializeClaim(req, item) {
  const insuranceProgress = item.insurance_progress
    ? {
        ...item.insurance_progress,
        status: normalizeInsuranceStatus(item.insurance_progress.status),
        coverage_amount: number(item.insurance_progress.coverage_amount),
        premium_amount: number(item.insurance_progress.premium_amount),
      }
    : item.insurance_progress;

  return {
    ...serializeWithFile(req, item, item.claim_type),
    insurance_progress: insuranceProgress,
    claim_amount: number(item.claim_amount),
    approved_amount:
      item.approved_amount === null ? null : number(item.approved_amount),
    disbursed_amount:
      item.disbursed_amount === null ? null : number(item.disbursed_amount),
  };
}

function isEmptyObject(value) {
  return !value || Object.keys(value).length === 0;
}

async function getLegalAccessScope(userId) {
  return getDebtorAccessScope(userId, LEGAL_DATA_SCOPE_URLS);
}

async function getLegalReportScope(userId, menuUrl) {
  const scope = await getLegalAccessScope(userId);
  const canReportAll = await roleHasFeature(
    scope.roleId,
    menuUrl,
    REPORT_ALL_FEATURE,
  );

  return {
    ...scope,
    operationalCanManageAll: scope.canManageAll,
    canViewAll: Boolean(canReportAll),
    canManageAll: false,
    canReportAll,
  };
}

function buildContractAccessWhereFromScope(scope) {
  const contractWhere = buildContractVisibilityWhere(scope);
  return isEmptyObject(contractWhere)
    ? {}
    : {
        contract: {
          is: contractWhere,
        },
      };
}

async function buildContractAccessWhere(userId) {
  const scope = await getLegalAccessScope(userId);
  return buildContractAccessWhereFromScope(scope);
}

async function buildDepositTransactionAccessWhere(userId) {
  const scope = await getLegalAccessScope(userId);
  const contractWhere = buildContractVisibilityWhere(scope);
  return isEmptyObject(contractWhere)
    ? {}
    : {
        deposit: {
          is: {
            contract: {
              is: contractWhere,
            },
          },
        },
      };
}

async function ensureContract(contractId, userId, tx) {
  const scope = await getLegalAccessScope(userId);
  const contract = await repository.findContractById(
    contractId,
    tx,
    buildContractManageWhere(scope),
  );
  if (!contract) throw new AppError("Kontrak tidak ditemukan atau tidak bisa diakses.", 404);
  return contract;
}

async function ensureCollateralForContract(collateralId, contractId, tx) {
  const id = normalizeText(collateralId);
  if (!id) return null;

  const collateral = await repository.findCollateralById(id, tx);
  if (!collateral) {
    throw new AppError("Agunan tidak ditemukan.", 404);
  }
  if (collateral.contract_id !== contractId) {
    throw new AppError("Agunan tidak sesuai dengan kontrak.", 422);
  }
  return collateral;
}

async function ensureDebtor(debtorId, userId, tx) {
  if (!debtorId) return null;
  const scope = await getLegalAccessScope(userId);
  const debtor = await repository.findDebtorById(
    debtorId,
    tx,
    buildDebtorManageWhere(scope),
  );
  if (!debtor) throw new AppError("Debitur tidak ditemukan atau tidak bisa diakses.", 404);
  return debtor;
}

async function ensureThirdParty(thirdPartyId, expectedCategory) {
  if (!thirdPartyId) return null;

  const thirdParty = await repository.findThirdPartyById(thirdPartyId);
  if (!thirdParty) {
    throw new AppError("Pihak ketiga tidak ditemukan atau tidak aktif.", 404);
  }
  if (expectedCategory && thirdParty.category !== expectedCategory) {
    throw new AppError(`Kategori pihak ketiga wajib ${expectedCategory}.`, 422);
  }
  return thirdParty;
}

async function ensureDepositType(depositTypeId, depositType) {
  const id = normalizeText(depositTypeId);
  if (!id) return null;

  const type = normalizeUpper(depositType);
  const depositTypeRecord = await repository.findDepositTypeById(id);
  if (!depositTypeRecord) {
    throw new AppError("Jenis titipan tidak ditemukan atau tidak aktif.", 404);
  }

  if (normalizeUpper(depositTypeRecord.category) !== type) {
    throw new AppError(`Kategori jenis titipan wajib ${type}.`, 422);
  }

  return depositTypeRecord;
}

async function ensureDepositThirdParty(thirdPartyId, depositType) {
  const id = normalizeText(thirdPartyId);
  if (!id) return null;

  const type = normalizeUpper(depositType);
  const expectedCategory = DEPOSIT_THIRD_PARTY_CATEGORY_BY_TYPE[type];
  if (!expectedCategory) {
    if (type === "ANGSURAN") {
      throw new AppError("Pihak ketiga tidak boleh diisi untuk dana titipan angsuran.", 422);
    }
    return ensureThirdParty(id);
  }

  return ensureThirdParty(id, expectedCategory);
}

async function resolveLegalProcessType(value, category, label) {
  const text = normalizeText(value);
  if (!text) {
    throw new AppError(`${label} wajib dipilih.`, 422);
  }

  const processType = await repository.findLegalProcessType({
    value: text,
    category,
  });

  if (!processType) {
    throw new AppError(
      `${label} tidak aktif atau belum terdaftar di Parameter.`,
      422,
    );
  }

  return processType.name;
}

async function recalculateDepositLedger(depositId, userId, tx) {
  const transactions = await repository.findDepositTransactionsByDepositId(depositId, tx);
  const totals = calculateDepositLedgerTotals(transactions);
  const status = resolveDepositStatus(totals);
  await repository.update(
    "legal_deposits",
    depositId,
    {
      nominal: totals.total_deposit_amount,
      paid_amount: totals.total_payment_amount,
      processed_amount: totals.total_refund_amount,
      remaining_amount: totals.balance_amount,
      status,
      updated_by: userId || null,
    },
    tx,
  );
  return totals;
}

function assertDepositCanDecreaseBalance(deposit, action, amount) {
  if (action === "TITIPAN") return;
  const balance = number(deposit.remaining_amount);
  if (amount - balance > 0.000001) {
    throw new AppError(
      "Nominal pembayaran/refund tidak boleh melebihi saldo dana titipan.",
      422,
    );
  }
}

async function listModel({
  req,
  modelName,
  query,
  searchFields,
  extraWhere,
  serializer,
  includeSoftDeleteFilter,
  relationSearch,
}) {
  const pagination = paginate(query);
  const where = listWhere(query, extraWhere, searchFields, {
    includeSoftDeleteFilter,
    relationSearch,
  });
  const [data, total] = await Promise.all([
    repository.findMany(modelName, {
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { created_at: "desc" },
    }),
    repository.count(modelName, where),
  ]);
  return {
    data: data.map((item) => serializer(req, item)),
    meta: buildPaginationMeta(total, pagination),
  };
}

async function createProgress({ req, modelName, payload, userId, category, entity }) {
  await ensureContract(payload.contract_id, userId);
  await ensureCollateralForContract(payload.collateral_id, payload.contract_id);
  await ensureThirdParty(payload.third_party_id, category);
  const fileMetas = persistDomainFiles({
    entity,
    inputs: normalizeUploadFiles(payload),
    fallbackBaseName: category,
  });
  const primaryFile = fileMetas[0] || null;
  const data = { ...payload };
  delete data.file;
  delete data.files;
  if (data.collateral_id !== undefined) {
    data.collateral_id = normalizeText(data.collateral_id);
  }
  const processCategory = LEGAL_PROCESS_CATEGORY_BY_THIRD_PARTY[category];
  if (processCategory && data.deed_type !== undefined) {
    data.deed_type = await resolveLegalProcessType(
      data.deed_type,
      processCategory,
      "Jenis proses notaris",
    );
  }
  if (processCategory && data.insurance_type !== undefined) {
    data.insurance_type = await resolveLegalProcessType(
      data.insurance_type,
      processCategory,
      "Jenis proses asuransi",
    );
  }
  if (processCategory && data.appraisal_type !== undefined) {
    data.appraisal_type = await resolveLegalProcessType(
      data.appraisal_type,
      processCategory,
      "Jenis proses KJPP",
    );
  }
  for (const key of Object.keys(data)) {
    if (key.endsWith("_at") || key.startsWith("period_")) {
      data[key] = data[key] ? new Date(data[key]) : null;
    }
  }
  data.status =
    category === "INSURANCE"
      ? normalizeUpper(data.status)
      : normalizeUpper(data.status) || "PROSES";
  validateDocumentProgressDates(data, category);
  const saved = await repository.create(modelName, {
    ...data,
    ...(primaryFile || {}),
    ...(fileMetas.length > 0
      ? {
          files: {
            create: buildStoredFiles(fileMetas),
          },
        }
      : {}),
    created_by: userId || null,
  });
  await recordLegalAudit(undefined, {
    req,
    actorId: userId,
    action: "CREATE",
    modelName,
    after: saved,
    metadata: {
      category,
      files_count: fileMetas.length,
    },
  });
  return category === "INSURANCE"
    ? serializeInsuranceProgress(req, saved)
    : serializeWithFile(req, saved, category);
}

async function updateProgress({ req, modelName, id, payload, userId, category, entity }) {
  const current = await repository.findById(modelName, id, { deleted_at: null });
  if (!current) throw new AppError("Data progress tidak ditemukan.", 404);
  const next = { ...current, ...payload };
  await ensureContract(current.contract_id, userId);
  await ensureContract(next.contract_id, userId);
  await ensureCollateralForContract(
    payload.collateral_id !== undefined
      ? payload.collateral_id
      : current.collateral_id,
    next.contract_id,
  );
  await ensureThirdParty(next.third_party_id, category);
  const fileMetas = persistDomainFiles({
    entity,
    inputs: normalizeUploadFiles(payload),
    fallbackBaseName: category,
  });
  const primaryFile =
    !current.file_path && fileMetas.length > 0 ? fileMetas[0] : null;
  const data = { ...payload };
  delete data.file;
  delete data.files;
  if (data.collateral_id !== undefined) {
    data.collateral_id = normalizeText(data.collateral_id);
  }
  const processCategory = LEGAL_PROCESS_CATEGORY_BY_THIRD_PARTY[category];
  if (processCategory && data.deed_type !== undefined) {
    data.deed_type = await resolveLegalProcessType(
      data.deed_type,
      processCategory,
      "Jenis proses notaris",
    );
  }
  if (processCategory && data.insurance_type !== undefined) {
    data.insurance_type = await resolveLegalProcessType(
      data.insurance_type,
      processCategory,
      "Jenis proses asuransi",
    );
  }
  if (processCategory && data.appraisal_type !== undefined) {
    data.appraisal_type = await resolveLegalProcessType(
      data.appraisal_type,
      processCategory,
      "Jenis proses KJPP",
    );
  }
  for (const key of Object.keys(data)) {
    if (key.endsWith("_at") || key.startsWith("period_")) {
      data[key] = data[key] ? new Date(data[key]) : null;
    }
  }
  if (data.status) data.status = normalizeUpper(data.status);
  validateDocumentProgressDates({ ...next, ...data }, category);
  const saved = await repository.update(modelName, id, {
    ...data,
    ...(primaryFile || {}),
    ...(fileMetas.length > 0
      ? {
          files: {
            create: buildStoredFiles(fileMetas),
          },
        }
      : {}),
    updated_by: userId || null,
  });
  await recordLegalAudit(undefined, {
    req,
    actorId: userId,
    action: "UPDATE",
    modelName,
    before: current,
    after: saved,
    metadata: {
      category,
      files_count: fileMetas.length,
    },
  });
  return category === "INSURANCE"
    ? serializeInsuranceProgress(req, saved)
    : serializeWithFile(req, saved, category);
}

async function attachThirdPartyNames(rows) {
  const ids = [
    ...new Set(
      rows
        .map((row) => row.third_party_id)
        .filter((id) => typeof id === "string" && id.trim()),
    ),
  ];
  if (ids.length === 0) return rows;

  const thirdParties = await repository.findThirdPartiesByIds(ids);
  const byId = new Map(thirdParties.map((item) => [item.id, item]));

  return rows.map((row) => {
    const thirdParty = byId.get(row.third_party_id) || null;
    return {
      ...row,
      third_party: thirdParty,
      third_party_name: thirdParty?.name || row.third_party_id,
    };
  });
}

function combineInsuranceStatusGroups(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const status = normalizeInsuranceStatus(row.status);
    const key = `${row.third_party_id || ""}:${status}`;
    const existing = grouped.get(key);
    if (existing) {
      existing._count = {
        ...(existing._count || {}),
        id: number(existing._count?.id) + number(row._count?.id),
      };
    } else {
      grouped.set(key, {
        ...row,
        status,
      });
    }
  }
  return Array.from(grouped.values());
}

function hasValidDate(value) {
  if (!value) return false;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return !Number.isNaN(new Date(value).getTime());
}

function validateDocumentProgressDates(data, category) {
  if (!["NOTARY", "KJPP"].includes(category)) return;

  const status = normalizeUpper(data.status) || "PROSES";
  if (status === "PROSES" && !hasValidDate(data.estimated_completed_at)) {
    throw new AppError("Estimasi selesai wajib diisi saat status Dalam Proses.", 400);
  }
  if (status === "SELESAI" && !hasValidDate(data.completed_at)) {
    throw new AppError("Tanggal selesai wajib diisi saat status Selesai.", 400);
  }
  if (status !== "SELESAI" && hasValidDate(data.completed_at)) {
    throw new AppError("Tanggal selesai hanya boleh diisi saat status Selesai.", 400);
  }
}

exports.listNotaryProgress = async ({ req, query, userId }) =>
  listModel({
    req,
    modelName: "legal_notary_progress",
    query,
    searchFields: ["deed_type", "deed_number", "status", "notes"],
    extraWhere: await buildContractAccessWhere(userId),
    relationSearch: progressSearchClauses,
    serializer: (request, item) => serializeWithFile(request, item, item.deed_type),
  });
exports.createNotaryProgress = (args) =>
  createProgress({
    ...args,
    modelName: "legal_notary_progress",
    category: "NOTARY",
    entity: "legal/notary-progress",
  });
exports.updateNotaryProgress = (args) =>
  updateProgress({
    ...args,
    modelName: "legal_notary_progress",
    category: "NOTARY",
    entity: "legal/notary-progress",
  });

exports.listInsuranceProgress = async ({ req, query, userId }) =>
  listModel({
    req,
    modelName: "legal_insurance_progress",
    query,
    searchFields: ["insurance_type", "policy_number", "status", "notes"],
    extraWhere: await buildContractAccessWhere(userId),
    relationSearch: progressSearchClauses,
    serializer: serializeInsuranceProgress,
  });
exports.createInsuranceProgress = (args) =>
  createProgress({
    ...args,
    modelName: "legal_insurance_progress",
    category: "INSURANCE",
    entity: "legal/insurance-progress",
  });
exports.updateInsuranceProgress = (args) =>
  updateProgress({
    ...args,
    modelName: "legal_insurance_progress",
    category: "INSURANCE",
    entity: "legal/insurance-progress",
  });

exports.listKjppProgress = async ({ req, query, userId }) =>
  listModel({
    req,
    modelName: "legal_kjpp_progress",
    query,
    searchFields: [
      "appraisal_type",
      "report_number",
      "collateral_object",
      "status",
      "notes",
    ],
    extraWhere: await buildContractAccessWhere(userId),
    relationSearch: progressSearchClauses,
    serializer: (request, item) => serializeWithFile(request, item, item.appraisal_type),
  });
exports.createKjppProgress = (args) =>
  createProgress({
    ...args,
    modelName: "legal_kjpp_progress",
    category: "KJPP",
    entity: "legal/kjpp-progress",
  });
exports.updateKjppProgress = (args) =>
  updateProgress({
    ...args,
    modelName: "legal_kjpp_progress",
    category: "KJPP",
    entity: "legal/kjpp-progress",
  });

exports.deleteRecord = async ({ req, modelName, id, userId }) => {
  const current = await repository.findById(modelName, id, { deleted_at: null });
  if (!current) throw new AppError("Data tidak ditemukan.", 404);
  if (current.contract_id) {
    await ensureContract(current.contract_id, userId);
  }
  const deleted = await repository.update(modelName, id, {
    deleted_at: new Date(),
    deleted_by: userId || null,
  });
  await recordLegalAudit(undefined, {
    req,
    actorId: userId,
    action: "DELETE",
    modelName,
    before: current,
    after: deleted,
  });
};

exports.listClaims = async ({ req, query, userId }) =>
  listModel({
    req,
    modelName: "legal_claims",
    query,
    searchFields: ["policy_number", "claim_type", "status", "notes"],
    extraWhere: await buildContractAccessWhere(userId),
    relationSearch: claimSearchClauses,
    serializer: serializeClaim,
  });

exports.createClaim = async ({ req, payload, userId }) => {
  await ensureContract(payload.contract_id, userId);
  let insuranceProgress = null;
  if (payload.insurance_progress_id) {
    insuranceProgress = await repository.findById(
      "legal_insurance_progress",
      payload.insurance_progress_id,
      { deleted_at: null },
    );
    if (!insuranceProgress) throw new AppError("Progress asuransi tidak ditemukan.", 404);
    await ensureContract(insuranceProgress.contract_id, userId);
    if (insuranceProgress.contract_id !== payload.contract_id) {
      throw new AppError("Progress asuransi tidak sesuai dengan kontrak klaim.", 422);
    }
  }
  const requestedCollateralId = normalizeText(payload.collateral_id);
  const claimCollateralId = requestedCollateralId || insuranceProgress?.collateral_id || null;
  if (
    insuranceProgress?.collateral_id &&
    requestedCollateralId &&
    requestedCollateralId !== insuranceProgress.collateral_id
  ) {
    throw new AppError("Agunan klaim tidak sesuai dengan progress asuransi.", 422);
  }
  await ensureCollateralForContract(claimCollateralId, payload.contract_id);
  const fileMetas = persistDomainFiles({
    entity: "legal/claims",
    inputs: normalizeUploadFiles(payload),
    fallbackBaseName: payload.claim_type,
  });
  const primaryFile = fileMetas[0] || null;
  const data = { ...payload };
  delete data.file;
  delete data.files;
  data.collateral_id = claimCollateralId;
  data.claim_type = await resolveLegalProcessType(
    data.claim_type,
    "INSURANCE_CLAIM",
    "Jenis klaim",
  );
  const saved = await repository.create("legal_claims", {
    ...data,
    policy_number: normalizeText(data.policy_number),
    status: normalizeUpper(data.status || "PENGAJUAN"),
    submitted_at: new Date(data.submitted_at),
    disbursed_at: data.disbursed_at ? new Date(data.disbursed_at) : null,
    ...(primaryFile || {}),
    ...(fileMetas.length > 0
      ? {
          files: {
            create: buildStoredFiles(fileMetas),
          },
        }
      : {}),
    created_by: userId || null,
  });
  await recordLegalAudit(undefined, {
    req,
    actorId: userId,
    action: "CREATE",
    modelName: "legal_claims",
    after: saved,
    metadata: {
      files_count: fileMetas.length,
    },
  });
  return serializeClaim(req, saved);
};

exports.updateClaim = async ({ req, id, payload, userId }) => {
  const current = await repository.findById("legal_claims", id, { deleted_at: null });
  if (!current) throw new AppError("Klaim tidak ditemukan.", 404);
  await ensureContract(current.contract_id, userId);
  const fileMetas = persistDomainFiles({
    entity: "legal/claims",
    inputs: normalizeUploadFiles(payload),
    fallbackBaseName: payload.claim_type || current.claim_type,
  });
  const primaryFile =
    !current.file_path && fileMetas.length > 0 ? fileMetas[0] : null;
  const data = { ...payload };
  delete data.file;
  delete data.files;
  const targetContractId = data.contract_id || current.contract_id;
  if (data.claim_type !== undefined) {
    data.claim_type = await resolveLegalProcessType(
      data.claim_type,
      "INSURANCE_CLAIM",
      "Jenis klaim",
    );
  }
  if (data.status) data.status = normalizeUpper(data.status);
  if (data.contract_id) await ensureContract(data.contract_id, userId);
  const targetInsuranceProgressId =
    data.insurance_progress_id !== undefined
      ? normalizeText(data.insurance_progress_id)
      : current.insurance_progress_id;
  let insuranceProgress = null;
  if (targetInsuranceProgressId) {
    insuranceProgress = await repository.findById(
      "legal_insurance_progress",
      targetInsuranceProgressId,
      { deleted_at: null },
    );
    if (!insuranceProgress) throw new AppError("Progress asuransi tidak ditemukan.", 404);
    await ensureContract(insuranceProgress.contract_id, userId);
    if (insuranceProgress.contract_id !== targetContractId) {
      throw new AppError("Progress asuransi tidak sesuai dengan kontrak klaim.", 422);
    }
  }
  const requestedCollateralId =
    data.collateral_id !== undefined
      ? normalizeText(data.collateral_id)
      : current.collateral_id;
  const claimCollateralId = requestedCollateralId || insuranceProgress?.collateral_id || null;
  if (
    insuranceProgress?.collateral_id &&
    requestedCollateralId &&
    requestedCollateralId !== insuranceProgress.collateral_id
  ) {
    throw new AppError("Agunan klaim tidak sesuai dengan progress asuransi.", 422);
  }
  await ensureCollateralForContract(claimCollateralId, targetContractId);
  if (data.collateral_id !== undefined || insuranceProgress?.collateral_id) {
    data.collateral_id = claimCollateralId;
  }
  if (data.insurance_progress_id !== undefined) {
    data.insurance_progress_id = normalizeText(data.insurance_progress_id);
  }
  if (data.submitted_at) data.submitted_at = new Date(data.submitted_at);
  if (data.disbursed_at !== undefined) {
    data.disbursed_at = data.disbursed_at ? new Date(data.disbursed_at) : null;
  }
  const saved = await repository.update("legal_claims", id, {
    ...data,
    ...(primaryFile || {}),
    ...(fileMetas.length > 0
      ? {
          files: {
            create: buildStoredFiles(fileMetas),
          },
        }
      : {}),
    updated_by: userId || null,
  });
  await recordLegalAudit(undefined, {
    req,
    actorId: userId,
    action: "UPDATE",
    modelName: "legal_claims",
    before: current,
    after: saved,
    metadata: {
      files_count: fileMetas.length,
    },
  });
  return serializeClaim(req, saved);
};

exports.listDeposits = async ({ req, query, userId }) =>
  listModel({
    req,
    modelName: "legal_deposits",
    query,
    searchFields: ["type", "status", "notes"],
    extraWhere: await buildContractAccessWhere(userId),
    relationSearch: depositSearchClauses,
    serializer: serializeDeposit,
  });

exports.createDeposit = async ({ req, payload, userId }) => {
  const type = assertDepositType(payload.type);
  const depositTypeId = normalizeText(payload.deposit_type_id);
  const thirdPartyId = normalizeText(payload.third_party_id);
  const openingTransaction = payload.opening_transaction || null;
  const openingInputs = normalizeUploadFiles(payload);

  await ensureContract(payload.contract_id, userId);
  await ensureDepositType(depositTypeId, type);
  await ensureDepositThirdParty(thirdPartyId, type);

  if (openingInputs.length > 0 && !openingTransaction) {
    throw new AppError(
      "File pendukung hanya bisa diunggah bersama transaksi awal titipan.",
      422,
    );
  }

  return repository.transaction(async (tx) => {
    const deposit = await repository.create(
      "legal_deposits",
      {
        deposit_type_id: depositTypeId,
        type,
        contract_id: payload.contract_id,
        third_party_id: thirdPartyId,
        nominal: 0,
        paid_amount: 0,
        processed_amount: 0,
        remaining_amount: 0,
        status: "PENDING",
        notes: normalizeText(payload.notes),
        created_by: userId || null,
      },
      tx,
    );

    let openingTransactionRecord = null;
    let openingFilesCount = 0;
    if (openingTransaction) {
      const action = assertDepositTransactionAction(openingTransaction.action || "TITIPAN");
      if (action !== "TITIPAN") {
        throw new AppError("Transaksi awal dana titipan wajib berupa TITIPAN.", 422);
      }
      const openingFileMetas = persistDomainFiles({
        entity: "legal/deposit-transactions",
        inputs: openingInputs,
        fallbackBaseName: `bukti-titipan-${deposit.id}`,
      });
      openingFilesCount = openingFileMetas.length;
      const primaryFile = openingFileMetas[0] || null;
      openingTransactionRecord = await repository.create(
        "legal_deposit_transactions",
        {
          deposit_id: deposit.id,
          transaction_date: new Date(openingTransaction.transaction_date),
          action,
          amount: openingTransaction.amount,
          notes: normalizeText(openingTransaction.notes),
          ...depositTransactionFileFields(primaryFile),
          ...(openingFileMetas.length > 0
            ? {
                files: {
                  create: buildStoredFiles(openingFileMetas),
                },
              }
            : {}),
          created_by: userId || null,
        },
        tx,
      );
      await recalculateDepositLedger(deposit.id, userId, tx);
    }

    const finalDeposit = await repository.findById(
      "legal_deposits",
      deposit.id,
      { deleted_at: null },
      tx,
    );
    await recordLegalAudit(tx, {
      req,
      actorId: userId,
      action: "CREATE",
      modelName: "legal_deposits",
      after: finalDeposit,
      metadata: {
        opening_transaction: Boolean(openingTransactionRecord),
      },
    });
    if (openingTransactionRecord) {
      await recordLegalAudit(tx, {
        req,
        actorId: userId,
        action: "CREATE",
        modelName: "legal_deposit_transactions",
        after: {
          ...openingTransactionRecord,
          deposit: finalDeposit,
        },
        metadata: {
          opening_transaction: true,
          files_count: openingFilesCount,
        },
      });
    }
    return serializeDeposit(req, finalDeposit);
  });
};

exports.updateDeposit = async ({ req, id, payload, userId }) => {
  const current = await repository.findById("legal_deposits", id, { deleted_at: null });
  if (!current) throw new AppError("Dana titipan tidak ditemukan.", 404);
  await ensureContract(current.contract_id, userId);
  const nextType =
    payload.type !== undefined ? assertDepositType(payload.type) : current.type;
  const nextContractId = payload.contract_id || current.contract_id;
  const nextDepositTypeId =
    payload.deposit_type_id !== undefined
      ? normalizeText(payload.deposit_type_id)
      : current.deposit_type_id;
  const nextThirdPartyId =
    payload.third_party_id !== undefined
      ? normalizeText(payload.third_party_id)
      : current.third_party_id;

  await ensureContract(nextContractId, userId);
  await ensureDepositType(nextDepositTypeId, nextType);
  await ensureDepositThirdParty(nextThirdPartyId, nextType);

  const next = {
    deposit_type_id: nextDepositTypeId,
    type: nextType,
    contract_id: nextContractId,
    third_party_id: nextThirdPartyId,
    notes: payload.notes !== undefined ? normalizeText(payload.notes) : current.notes,
    updated_by: userId || null,
  };

  return repository.transaction(async (tx) => {
    await repository.update("legal_deposits", id, next, tx);
    await recalculateDepositLedger(id, userId, tx);
    const saved = await repository.findById("legal_deposits", id, { deleted_at: null }, tx);
    await recordLegalAudit(tx, {
      req,
      actorId: userId,
      action: "UPDATE",
      modelName: "legal_deposits",
      before: current,
      after: saved,
    });
    return serializeDeposit(req, saved);
  });
};

exports.listDepositTransactions = async ({ req, query, userId }) => {
  const {
    type,
    contract_id: contractId,
    third_party_id: thirdPartyId,
    ...transactionQuery
  } = query;
  const accessWhere = await buildDepositTransactionAccessWhere(userId);
  const depositWhere = {
    ...(type ? { type: normalizeUpper(type) } : {}),
    ...(contractId ? { contract_id: contractId } : {}),
    ...(thirdPartyId ? { third_party_id: thirdPartyId } : {}),
    ...(accessWhere.deposit?.is || {}),
  };

  return listModel({
    req,
    modelName: "legal_deposit_transactions",
    query: transactionQuery,
    searchFields: ["action", "notes"],
    extraWhere: {
      ...(query.deposit_id ? { deposit_id: query.deposit_id } : {}),
      ...(isEmptyObject(depositWhere) ? {} : { deposit: { is: depositWhere } }),
    },
    includeSoftDeleteFilter: false,
    relationSearch: depositTransactionSearchClauses,
    serializer: serializeDepositTransaction,
  });
};

exports.createDepositTransaction = async ({ req, payload, userId }) => {
  const deposit = await repository.findById("legal_deposits", payload.deposit_id, {
    deleted_at: null,
  });
  if (!deposit) throw new AppError("Dana titipan tidak ditemukan.", 404);
  await ensureContract(deposit.contract_id, userId);
  const action = assertDepositTransactionAction(payload.action);
  const amountValue = number(payload.amount);

  return repository.transaction(async (tx) => {
    const currentDeposit = await repository.findById(
      "legal_deposits",
      payload.deposit_id,
      { deleted_at: null },
      tx,
    );
    if (!currentDeposit) throw new AppError("Dana titipan tidak ditemukan.", 404);
    assertDepositCanDecreaseBalance(currentDeposit, action, amountValue);
    const fileMetas = persistDomainFiles({
      entity: "legal/deposit-transactions",
      inputs: normalizeUploadFiles(payload),
      fallbackBaseName: `bukti-${action.toLowerCase()}-${payload.deposit_id}`,
    });
    const primaryFile = fileMetas[0] || null;
    const transaction = await repository.create(
      "legal_deposit_transactions",
      {
        deposit_id: payload.deposit_id,
        transaction_date: new Date(payload.transaction_date),
        action,
        amount: payload.amount,
        notes: normalizeText(payload.notes),
        ...depositTransactionFileFields(primaryFile),
        ...(fileMetas.length > 0
          ? {
              files: {
                create: buildStoredFiles(fileMetas),
              },
            }
          : {}),
        created_by: userId || null,
      },
      tx,
    );
    await recalculateDepositLedger(payload.deposit_id, userId, tx);
    await recordLegalAudit(tx, {
      req,
      actorId: userId,
      action: "CREATE",
      modelName: "legal_deposit_transactions",
      after: {
        ...transaction,
        deposit: currentDeposit,
      },
      metadata: {
        files_count: fileMetas.length,
      },
    });
    return serializeDepositTransaction(req, transaction);
  });
};

exports.getSummaryReport = async (_query = {}, userId = null) => {
  const scope = await getLegalReportScope(userId, LEGAL_REPORT_URLS.summary);
  const contractAccessWhere = buildContractAccessWhereFromScope(scope);
  const [
    notary,
    insurance,
    kjpp,
    claims,
    deposits,
  ] = await Promise.all([
    repository.countWhere("legal_notary_progress", {
      deleted_at: null,
      ...contractAccessWhere,
    }),
    repository.countWhere("legal_insurance_progress", {
      deleted_at: null,
      ...contractAccessWhere,
    }),
    repository.countWhere("legal_kjpp_progress", {
      deleted_at: null,
      ...contractAccessWhere,
    }),
    repository.countWhere("legal_claims", {
      deleted_at: null,
      ...contractAccessWhere,
    }),
    repository.countWhere("legal_deposits", {
      deleted_at: null,
      ...contractAccessWhere,
    }),
  ]);
  return {
    notary,
    insurance,
    kjpp,
    claims,
    deposits,
    scope: {
      can_report_all: scope.canReportAll,
      can_view_division: scope.canViewDivision,
      can_manage_all: scope.operationalCanManageAll,
    },
  };
};

exports.getThirdPartyDocumentsReport = async (_query = {}, userId = null) => {
  const scope = await getLegalReportScope(
    userId,
    LEGAL_REPORT_URLS.thirdPartyDocuments,
  );
  const contractAccessWhere = buildContractAccessWhereFromScope(scope);
  const [notary, insurance, kjpp, claims] = await Promise.all([
    repository.group("legal_notary_progress", {
      by: ["third_party_id", "status"],
      where: { deleted_at: null, ...contractAccessWhere },
      _count: { id: true },
    }),
    repository.group("legal_insurance_progress", {
      by: ["third_party_id", "status"],
      where: { deleted_at: null, ...contractAccessWhere },
      _count: { id: true },
    }),
    repository.group("legal_kjpp_progress", {
      by: ["third_party_id", "status"],
      where: { deleted_at: null, ...contractAccessWhere },
      _count: { id: true },
    }),
    repository.group("legal_claims", {
      by: ["status"],
      where: { deleted_at: null, ...contractAccessWhere },
      _count: { id: true },
      _sum: { claim_amount: true, disbursed_amount: true },
    }),
  ]);
  return {
    notary: await attachThirdPartyNames(notary),
    insurance: await attachThirdPartyNames(combineInsuranceStatusGroups(insurance)),
    kjpp: await attachThirdPartyNames(kjpp),
    claims,
    scope: {
      can_report_all: scope.canReportAll,
      can_view_division: scope.canViewDivision,
      can_manage_all: scope.operationalCanManageAll,
    },
  };
};

exports.getThirdPartyDepositFundsReport = async (_query = {}, userId = null) => {
  const scope = await getLegalReportScope(
    userId,
    LEGAL_REPORT_URLS.thirdPartyDepositFunds,
  );
  const contractAccessWhere = buildContractAccessWhereFromScope(scope);
  const rows = await repository.aggregateDeposits({
    deleted_at: null,
    ...contractAccessWhere,
  });
  return {
    data: rows.map((item) => ({
      type: item.type,
      status: item.status,
      total_records: item._count.id,
      nominal: number(item._sum.nominal),
      paid_amount: number(item._sum.paid_amount),
      processed_amount: number(item._sum.processed_amount),
      remaining_amount: number(item._sum.remaining_amount),
      total_deposit_amount: number(item._sum.nominal),
      total_payment_amount: number(item._sum.paid_amount),
      total_refund_amount: number(item._sum.processed_amount),
      balance_amount: number(item._sum.remaining_amount),
    })),
    scope: {
      can_report_all: scope.canReportAll,
      can_view_division: scope.canViewDivision,
      can_manage_all: scope.operationalCanManageAll,
    },
  };
};

exports.getActivityLogsReport = async (query = {}, userId = null) => {
  const pagination = paginate(query);
  const { where, scope } = await buildActivityLogWhere(query, userId);
  const [data, total] = await Promise.all([
    repository.findActivityLogs({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { created_at: "desc" },
    }),
    repository.countActivityLogs(where),
  ]);

  return {
    data: data.map(serializeActivityLog),
    meta: buildPaginationMeta(total, pagination),
    scope: {
      can_report_all: scope.canReportAll,
      can_view_division: scope.canViewDivision,
      can_manage_all: scope.operationalCanManageAll,
    },
  };
};
