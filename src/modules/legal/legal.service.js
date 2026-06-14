const repository = require("./legal.repository");
const { AppError } = require("../../utils/errors");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  resolvePagination,
} = require("../../utils/pagination");
const { persistDomainFile, serializeFile } = require("../../utils/domain-files");
const {
  LEGAL_DATA_SCOPE_URLS,
  buildContractManageWhere,
  buildContractVisibilityWhere,
  buildDebtorManageWhere,
  getDebtorAccessScope,
} = require("../../utils/debtor-access");
const { REPORT_ALL_FEATURE } = require("../../utils/menu-access");
const { roleHasFeature } = require("../../utils/rbac");

const LEGAL_REPORT_URLS = {
  summary: "/dashboard/legal/laporan",
  thirdPartyDocuments: "/dashboard/legal/laporan/pihak-ketiga/dokumen",
  thirdPartyDepositFunds: "/dashboard/legal/laporan/pihak-ketiga/dana-titipan",
};

const LEGAL_TYPES = new Set([
  "AKAD",
  "HAFTSHEET",
  "SURAT_PERINGATAN",
  "SURAT_PENGANTAR",
  "SKL",
  "SAMSAT",
  "DOKUMEN_LAINNYA",
]);
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
const LEGAL_DOCUMENT_GENERATOR = "legal_document_generator_v1";
const LEGAL_PLACEHOLDERS = [
  "legal.generated_number",
  "legal.document_type",
  "legal.printed_at",
  "debtor.name",
  "debtor.debtor_number",
  "debtor.identity_number",
  "debtor.address",
  "debtor.phone",
  "debtor.customer_type",
  "debtor.branch",
  "debtor.marketing_user",
  "contract.no_kontrak",
  "contract.status",
  "contract.tanggal_akad",
  "contract.tanggal_jatuh_tempo",
  "contract.plafond",
  "contract.pokok",
  "contract.margin",
  "contract.tenor",
  "contract.outstanding_pokok",
  "contract.outstanding_margin",
  "contract.total_outstanding",
  "contract.objek_pembiayaan",
  "contract.agunan",
  "contract.product",
  "contract.akad_type",
  "contract.branch",
  "contract.marketing_user",
  "collateral.collateral_number",
  "collateral.facility_number",
  "collateral.collateral_type",
  "collateral.binding_type",
  "collateral.binding_date",
  "collateral.owner_name",
  "collateral.proof_number",
  "collateral.address",
  "collateral.market_value",
  "collateral.appraisal_value",
  "collateral.insured_status",
  "collaterals.count",
  "collaterals.summary",
];
const LEGAL_PLACEHOLDER_SET = new Set(LEGAL_PLACEHOLDERS);
const LEGAL_DOCUMENT_SOURCE = {
  AUTO_GENERATED_PDF: "AUTO_GENERATED_PDF",
  UPLOADED_FILE: "UPLOADED_FILE",
};

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

function formatDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatCurrency(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function valueOrDash(value) {
  if (value === undefined || value === null) return "-";
  const text = String(value).trim();
  return text || "-";
}

function compactData(data) {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  );
}

function collateralLabel(collateral) {
  if (!collateral) return null;
  return [
    collateral.collateral_number,
    collateral.collateral_type,
    collateral.owner_name ? `a.n. ${collateral.owner_name}` : null,
    collateral.proof_number,
  ]
    .filter(Boolean)
    .join(" | ");
}

function buildCollateralSummary(collaterals = []) {
  if (!Array.isArray(collaterals) || collaterals.length === 0) return null;
  return collaterals
    .map((collateral, index) => `${index + 1}. ${collateralLabel(collateral) || collateral.id}`)
    .join("\n");
}

function normalizePdfText(value) {
  return String(value || "")
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?");
}

function extractTemplatePlaceholders(template = "") {
  const placeholders = new Set();
  const pattern = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
  let match;
  while ((match = pattern.exec(template)) !== null) {
    placeholders.add(match[1]);
  }
  return [...placeholders];
}

function assertTemplatePlaceholdersAllowed(template) {
  const unknown = extractTemplatePlaceholders(template).filter(
    (placeholder) => !LEGAL_PLACEHOLDER_SET.has(placeholder),
  );
  if (unknown.length > 0) {
    throw new AppError(
      `Placeholder template legal tidak dikenal: ${unknown.join(", ")}.`,
      422,
    );
  }
}

function renderTemplate(template, values) {
  const missingFields = new Set();
  const rendered = String(template || "").replace(
    /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g,
    (_match, key) => {
      if (!LEGAL_PLACEHOLDER_SET.has(key)) {
        throw new AppError(`Placeholder template legal tidak dikenal: ${key}.`, 422);
      }
      const value = values[key];
      if (value === undefined || value === null || String(value).trim() === "") {
        missingFields.add(key);
        return "-";
      }
      return String(value);
    },
  );
  return {
    rendered,
    missingFields: [...missingFields],
  };
}

function collectMissingFieldsForTemplate(template, values) {
  const missingFields = new Set();
  for (const key of extractTemplatePlaceholders(template)) {
    if (!LEGAL_PLACEHOLDER_SET.has(key)) {
      throw new AppError(`Placeholder template legal tidak dikenal: ${key}.`, 422);
    }
    const value = values[key];
    if (value === undefined || value === null || String(value).trim() === "") {
      missingFields.add(key);
    }
  }
  return [...missingFields];
}

function buildGeneratedPdfInput(buffer, generatedNumber, documentType) {
  const safeName = String(generatedNumber || documentType || "dokumen-legal")
    .trim()
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return {
    buffer,
    name: `${safeName || "dokumen-legal"}.pdf`,
    mime_type: "application/pdf",
    size_bytes: buffer.length,
  };
}

function buildPrintSnapshot({ payloadSnapshot, source, missingFields, context }) {
  return {
    ...(payloadSnapshot && typeof payloadSnapshot === "object" ? payloadSnapshot : {}),
    generator: LEGAL_DOCUMENT_GENERATOR,
    source,
    missing_fields: missingFields,
    context,
  };
}

function wrapText(text, font, fontSize, maxWidth) {
  const words = normalizePdfText(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

async function renderLegalPdf({ title, documentNumber, content }) {
  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageSize = [595.28, 841.89];
  const margin = 48;
  const fontSize = 11;
  const lineHeight = 16;
  let page = pdfDoc.addPage(pageSize);
  let y = pageSize[1] - margin;
  const maxWidth = pageSize[0] - margin * 2;

  function ensureSpace() {
    if (y >= margin + lineHeight) return;
    page = pdfDoc.addPage(pageSize);
    y = pageSize[1] - margin;
  }

  const header = normalizePdfText(title || "Dokumen Legal");
  page.drawText(header, {
    x: margin,
    y,
    size: 15,
    font: boldFont,
    color: rgb(0.05, 0.12, 0.22),
  });
  y -= 22;
  page.drawText(normalizePdfText(documentNumber || "-"), {
    x: margin,
    y,
    size: 10,
    font: regularFont,
    color: rgb(0.3, 0.35, 0.42),
  });
  y -= 28;

  for (const paragraph of normalizePdfText(content).split(/\r?\n/)) {
    const lines = wrapText(paragraph, regularFont, fontSize, maxWidth);
    for (const line of lines) {
      ensureSpace();
      page.drawText(line, {
        x: margin,
        y,
        size: fontSize,
        font: regularFont,
        color: rgb(0.08, 0.1, 0.14),
      });
      y -= lineHeight;
    }
    y -= 6;
  }

  return Buffer.from(await pdfDoc.save());
}

function decimalField(data, field) {
  return data[field] === undefined ? undefined : data[field];
}

function buildSearchWhere(search, fields) {
  const normalized = normalizeText(search);
  if (!normalized) return {};

  return {
    OR: fields.map((field) => ({
      [field]: {
        contains: normalized,
        mode: "insensitive",
      },
    })),
  };
}

function listWhere(query, extra = {}, fields = [], options = {}) {
  const clauses = [];
  if (options.includeSoftDeleteFilter !== false) {
    clauses.push({ deleted_at: null });
  }
  clauses.push(extra || {});
  const search = buildSearchWhere(query.search, fields);
  if (Object.keys(search).length) clauses.push(search);
  if (query.status) clauses.push({ status: normalizeUpper(query.status) });
  if (query.document_type) {
    clauses.push({ document_type: normalizeUpper(query.document_type) });
  }
  if (query.template_type) {
    clauses.push({ template_type: normalizeUpper(query.template_type) });
  }
  if (query.contract_id) clauses.push({ contract_id: query.contract_id });
  if (query.collateral_id) clauses.push({ collateral_id: query.collateral_id });
  if (query.third_party_id) clauses.push({ third_party_id: query.third_party_id });
  if (query.type) clauses.push({ type: normalizeUpper(query.type) });

  return { AND: clauses.filter((item) => Object.keys(item).length > 0) };
}

function paginate(query) {
  return resolvePagination(query, PAGINATION_PROFILES.TABLE);
}

function serializeTemplate(req, item) {
  return {
    ...item,
    file: serializeFile(req, item, {
      module: "legal_management",
      entityId: item.id,
      fallbackBaseName: item.title,
    }),
  };
}

function serializePrint(req, item) {
  return {
    ...item,
    generated_file: serializeFile(req, item, {
      module: "legal_management",
      entityId: item.id,
      prefix: "generated_",
      fallbackBaseName: item.document_type,
    }),
  };
}

function serializeWithFile(req, item, fallbackBaseName = "dokumen") {
  return {
    ...item,
    file: serializeFile(req, item, {
      module: "legal_management",
      entityId: item.id,
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

function assertLegalDocumentType(value) {
  const documentType = normalizeUpper(value);
  if (!LEGAL_TYPES.has(documentType)) {
    throw new AppError("Jenis dokumen legal tidak valid.", 422);
  }
  return documentType;
}

function assertNumberingTemplateMatches(template, documentType) {
  if (!template || !template.is_active) {
    throw new AppError("Template penomoran aktif untuk dokumen legal tidak ditemukan.", 422);
  }

  if (
    normalizeUpper(template.module) !== "LEGAL" ||
    normalizeUpper(template.document_type) !== documentType
  ) {
    throw new AppError("Template penomoran tidak sesuai dengan jenis dokumen legal.", 422);
  }

  return template;
}

async function ensureNumberingTemplate(documentType, numberingTemplateId, tx) {
  const id = normalizeText(numberingTemplateId);
  if (!id) return null;

  const template = await repository.findNumberingTemplateById(id, tx);
  return assertNumberingTemplateMatches(template, documentType);
}

async function ensureLegalTemplate(templateId, documentType, tx) {
  const id = normalizeText(templateId);
  if (!id) return null;

  const template = await repository.findTemplateById(id, tx);
  if (!template || !template.is_active) {
    throw new AppError("Template legal aktif tidak ditemukan.", 404);
  }

  if (normalizeUpper(template.template_type) !== documentType) {
    throw new AppError("Template legal tidak sesuai dengan jenis dokumen yang dicetak.", 422);
  }

  return template;
}

function serializeCollateralSnapshot(collateral) {
  if (!collateral) return null;
  return {
    id: collateral.id,
    debtor_id: collateral.debtor_id,
    contract_id: collateral.contract_id,
    collateral_number: collateral.collateral_number,
    facility_number: collateral.facility_number,
    collateral_status_code: collateral.collateral_status_code,
    collateral_type: collateral.collateral_type,
    binding_type_code: collateral.binding_type_code,
    binding_date: toJsonSafe(collateral.binding_date),
    owner_name: collateral.owner_name,
    proof_number: collateral.proof_number,
    address: collateral.address,
    location_city_code: collateral.location_city_code,
    market_value: toJsonSafe(collateral.market_value),
    appraisal_value: toJsonSafe(collateral.appraisal_value),
    insured_status: collateral.insured_status,
    description: collateral.description,
    period_month: collateral.period_month,
  };
}

function buildLegalContextValues({ contract, collateral, generatedNumber, documentType, printedAt }) {
  const debtor = contract.debtor || {};
  const collaterals = Array.isArray(contract.collaterals) ? contract.collaterals : [];
  const totalOutstanding = number(contract.outstanding_pokok) + number(contract.outstanding_margin);

  return {
    "legal.generated_number": generatedNumber,
    "legal.document_type": documentType,
    "legal.printed_at": formatDate(printedAt),
    "debtor.name": debtor.name,
    "debtor.debtor_number": debtor.debtor_number,
    "debtor.identity_number": debtor.identity_number,
    "debtor.address": debtor.address,
    "debtor.phone": debtor.phone,
    "debtor.customer_type": debtor.customer_type_label || debtor.customer_type,
    "debtor.branch": debtor.branch?.name || contract.branch?.name,
    "debtor.marketing_user": debtor.marketing_user?.name || contract.marketing_user?.name,
    "contract.no_kontrak": contract.no_kontrak,
    "contract.status": contract.status,
    "contract.tanggal_akad": formatDate(contract.tanggal_akad),
    "contract.tanggal_jatuh_tempo": formatDate(contract.tanggal_jatuh_tempo),
    "contract.plafond": formatCurrency(contract.plafond),
    "contract.pokok": formatCurrency(contract.pokok),
    "contract.margin": formatCurrency(contract.margin),
    "contract.tenor": contract.tenor,
    "contract.outstanding_pokok": formatCurrency(contract.outstanding_pokok),
    "contract.outstanding_margin": formatCurrency(contract.outstanding_margin),
    "contract.total_outstanding": formatCurrency(totalOutstanding),
    "contract.objek_pembiayaan": contract.objek_pembiayaan,
    "contract.agunan": contract.agunan,
    "contract.product": contract.product?.name,
    "contract.akad_type": contract.akad_type?.name,
    "contract.branch": contract.branch?.name || debtor.branch?.name,
    "contract.marketing_user": contract.marketing_user?.name || debtor.marketing_user?.name,
    "collateral.collateral_number": collateral?.collateral_number,
    "collateral.facility_number": collateral?.facility_number,
    "collateral.collateral_type": collateral?.collateral_type,
    "collateral.binding_type": collateral?.binding_type_code,
    "collateral.binding_date": formatDate(collateral?.binding_date),
    "collateral.owner_name": collateral?.owner_name,
    "collateral.proof_number": collateral?.proof_number,
    "collateral.address": collateral?.address,
    "collateral.market_value": formatCurrency(collateral?.market_value),
    "collateral.appraisal_value": formatCurrency(collateral?.appraisal_value),
    "collateral.insured_status": collateral?.insured_status,
    "collaterals.count": collaterals.length,
    "collaterals.summary": buildCollateralSummary(collaterals),
  };
}

function buildLegalContextSnapshot({ contract, collateral, generatedNumber, documentType, printedAt }) {
  const debtor = contract.debtor || {};
  return {
    legal: {
      generated_number: generatedNumber,
      document_type: documentType,
      printed_at: toJsonSafe(printedAt),
    },
    debtor: compactData({
      id: debtor.id,
      debtor_number: debtor.debtor_number,
      identity_number: debtor.identity_number,
      name: debtor.name,
      address: debtor.address,
      phone: debtor.phone,
      customer_type: debtor.customer_type,
      branch: debtor.branch?.name,
      marketing_user: debtor.marketing_user?.name,
    }),
    contract: compactData({
      id: contract.id,
      no_kontrak: contract.no_kontrak,
      status: contract.status,
      tanggal_akad: toJsonSafe(contract.tanggal_akad),
      tanggal_jatuh_tempo: toJsonSafe(contract.tanggal_jatuh_tempo),
      plafond: toJsonSafe(contract.plafond),
      pokok: toJsonSafe(contract.pokok),
      margin: toJsonSafe(contract.margin),
      tenor: contract.tenor,
      outstanding_pokok: toJsonSafe(contract.outstanding_pokok),
      outstanding_margin: toJsonSafe(contract.outstanding_margin),
      objek_pembiayaan: contract.objek_pembiayaan,
      agunan: contract.agunan,
      product: contract.product?.name,
      akad_type: contract.akad_type?.name,
      branch: contract.branch?.name,
      marketing_user: contract.marketing_user?.name,
    }),
    selected_collateral: serializeCollateralSnapshot(collateral),
    collaterals: Array.isArray(contract.collaterals)
      ? contract.collaterals.map(serializeCollateralSnapshot)
      : [],
  };
}

async function buildLegalDocumentContext({
  contractId,
  collateralId,
  documentType,
  generatedNumber = null,
  userId,
  tx,
}) {
  const scope = await getLegalAccessScope(userId);
  const contract = await repository.findContractDocumentContextById(
    contractId,
    tx,
    buildContractManageWhere(scope),
  );
  if (!contract) {
    throw new AppError("Kontrak tidak ditemukan atau tidak bisa diakses.", 404);
  }
  const selectedCollateral = await ensureCollateralForContract(
    collateralId,
    contract.id,
    tx,
  );
  const printedAt = new Date();
  return {
    contract,
    selectedCollateral,
    values: buildLegalContextValues({
      contract,
      collateral: selectedCollateral,
      generatedNumber,
      documentType,
      printedAt,
    }),
    snapshot: buildLegalContextSnapshot({
      contract,
      collateral: selectedCollateral,
      generatedNumber,
      documentType,
      printedAt,
    }),
  };
}

async function listModel({
  req,
  modelName,
  query,
  searchFields,
  extraWhere,
  serializer,
  includeSoftDeleteFilter,
}) {
  const pagination = paginate(query);
  const where = listWhere(query, extraWhere, searchFields, {
    includeSoftDeleteFilter,
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

exports.listTemplates = ({ req, query }) =>
  listModel({
    req,
    modelName: "legal_document_templates",
    query,
    searchFields: ["template_type", "title", "content_template"],
    serializer: serializeTemplate,
  });

exports.createTemplate = async ({ req, payload, userId }) => {
  const type = normalizeUpper(payload.template_type);
  if (!LEGAL_TYPES.has(type)) throw new AppError("Jenis template legal tidak valid.", 422);
  assertTemplatePlaceholdersAllowed(payload.content_template || "");
  const fileMeta = payload.file
    ? persistDomainFile({
        entity: "legal/templates",
        input: payload.file,
        fallbackBaseName: payload.title,
      })
    : null;
  try {
    return serializeTemplate(
      req,
      await repository.create("legal_document_templates", {
        template_type: type,
        version: payload.version || 1,
        title: normalizeText(payload.title),
        content_template: normalizeText(payload.content_template),
        is_active: payload.is_active !== false,
        ...(fileMeta || {}),
        created_by: userId || null,
      }),
    );
  } catch (error) {
    if (error?.code === "P2002") {
      throw new AppError("Template aktif atau versi template sudah ada.", 409);
    }
    throw error;
  }
};

exports.updateTemplate = async ({ req, id, payload, userId }) => {
  const current = await repository.findById("legal_document_templates", id, {
    deleted_at: null,
  });
  if (!current) throw new AppError("Template legal tidak ditemukan.", 404);
  if (payload.content_template !== undefined) {
    assertTemplatePlaceholdersAllowed(payload.content_template || "");
  }
  const fileMeta =
    payload.file !== undefined && payload.file !== null
      ? persistDomainFile({
          entity: "legal/templates",
          input: payload.file,
          previousPath: current.file_path,
          fallbackBaseName: payload.title || current.title,
        })
      : null;
  try {
    return serializeTemplate(
      req,
      await repository.update("legal_document_templates", id, {
        template_type: normalizeUpper(payload.template_type) || current.template_type,
        version: payload.version ?? current.version,
        title: normalizeText(payload.title) || current.title,
        content_template:
          payload.content_template !== undefined
            ? normalizeText(payload.content_template)
            : current.content_template,
        is_active:
          payload.is_active !== undefined ? payload.is_active : current.is_active,
        ...(fileMeta || {}),
        updated_by: userId || null,
      }),
    );
  } catch (error) {
    if (error?.code === "P2002") {
      throw new AppError("Template aktif atau versi template sudah ada.", 409);
    }
    throw error;
  }
};

exports.deleteTemplate = async ({ id, userId }) => {
  const current = await repository.findById("legal_document_templates", id, {
    deleted_at: null,
  });
  if (!current) throw new AppError("Template legal tidak ditemukan.", 404);
  await repository.update("legal_document_templates", id, {
    is_active: false,
    deleted_at: new Date(),
    deleted_by: userId || null,
  });
};

function periodKey(date, resetPeriod) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  switch (resetPeriod) {
    case "DAILY":
      return `${yyyy}${mm}${dd}`;
    case "YEARLY":
      return yyyy;
    case "NEVER":
      return "GLOBAL";
    case "MONTHLY":
    default:
      return `${yyyy}${mm}`;
  }
}

function renderNumber(template, documentType, sequence, date = new Date()) {
  const yyyy = String(date.getFullYear());
  const yy = yyyy.slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const seq = String(sequence).padStart(template.sequence_padding || 4, "0");
  return template.prefix_template
    .replaceAll("{YYYY}", yyyy)
    .replaceAll("{YY}", yy)
    .replaceAll("{MM}", mm)
    .replaceAll("{DD}", dd)
    .replaceAll("{TYPE}", documentType)
    .replaceAll("{SEQ}", seq);
}

async function generateDocumentNumber(documentType, numberingTemplateId, tx) {
  const template = numberingTemplateId
    ? await ensureNumberingTemplate(documentType, numberingTemplateId, tx)
    : await repository.findActiveNumberingTemplate(documentType, tx);
  assertNumberingTemplateMatches(template, documentType);

  const key = periodKey(new Date(), template.reset_period);
  const lastSequence =
    template.last_period_key === key ? Number(template.last_sequence || 0) : 0;
  const nextSequence = lastSequence + 1;
  await repository.updateNumberingTemplate(
    template.id,
    {
      last_sequence: nextSequence,
      last_period_key: key,
    },
    tx,
  );
  return {
    numberingTemplate: template,
    generatedNumber: renderNumber(template, documentType, nextSequence),
  };
}

exports.listPrints = async ({ req, query, userId }) =>
  listModel({
    req,
    modelName: "legal_print_histories",
    query,
    searchFields: ["document_type", "generated_number"],
    extraWhere: await buildContractAccessWhere(userId),
    serializer: serializePrint,
  });

exports.getPrintDocumentContext = async ({ query, userId }) => {
  const documentType = assertLegalDocumentType(query.document_type);
  const context = await buildLegalDocumentContext({
    contractId: query.contract_id,
    collateralId: query.collateral_id,
    documentType,
    userId,
  });

  return {
    placeholders: LEGAL_PLACEHOLDERS,
    values: context.values,
    missing_fields: Object.entries(context.values)
      .filter(([key, value]) => key !== "legal.generated_number" && !value)
      .map(([key]) => key),
    context: context.snapshot,
  };
};

exports.createPrint = async ({ req, payload, userId }) => {
  const documentType = assertLegalDocumentType(payload.document_type);
  const print = await repository.transaction(async (tx) => {
    const generated = await generateDocumentNumber(
      documentType,
      payload.numbering_template_id,
      tx,
    );
    const template = await ensureLegalTemplate(payload.template_id, documentType, tx);
    const context = await buildLegalDocumentContext({
      contractId: payload.contract_id,
      collateralId: payload.collateral_id,
      documentType,
      generatedNumber: generated.generatedNumber,
      userId,
      tx,
    });
    let generatedFileMeta = null;
    let missingFields = [];

    if (payload.file) {
      missingFields = collectMissingFieldsForTemplate(
        template.content_template || "",
        context.values,
      );
      generatedFileMeta = persistDomainFile({
        entity: "legal/generated",
        input: payload.file,
        fallbackBaseName: generated.generatedNumber || documentType,
      });
    } else {
      if (!normalizeText(template.content_template)) {
        throw new AppError(
          "Isi template legal wajib diisi untuk generate PDF otomatis.",
          422,
        );
      }
      const { rendered, missingFields: renderedMissingFields } = renderTemplate(
        template.content_template,
        context.values,
      );
      missingFields = renderedMissingFields;
      const pdfBuffer = await renderLegalPdf({
        title: template.title,
        documentNumber: generated.generatedNumber,
        content: rendered,
      });
      generatedFileMeta = persistDomainFile({
        entity: "legal/generated",
        input: buildGeneratedPdfInput(pdfBuffer, generated.generatedNumber, documentType),
        fallbackBaseName: generated.generatedNumber || documentType,
      });
    }

    return repository.create(
      "legal_print_histories",
      {
        template_id: normalizeText(payload.template_id),
        numbering_template_id: generated.numberingTemplate?.id || null,
        contract_id: payload.contract_id,
        document_type: documentType,
        generated_number: generated.generatedNumber,
        payload_snapshot: buildPrintSnapshot({
          payloadSnapshot: payload.payload_snapshot,
          source: payload.file
            ? LEGAL_DOCUMENT_SOURCE.UPLOADED_FILE
            : LEGAL_DOCUMENT_SOURCE.AUTO_GENERATED_PDF,
          missingFields,
          context: context.snapshot,
        }),
        ...(generatedFileMeta
          ? {
              generated_file_path: generatedFileMeta.file_path,
              generated_file_name: generatedFileMeta.file_name,
              generated_mime_type: generatedFileMeta.mime_type,
              generated_size_bytes: generatedFileMeta.size_bytes,
            }
          : {}),
        printed_by: userId || null,
        created_by: userId || null,
      },
      tx,
    );
  });

  return serializePrint(req, print);
};

async function createProgress({ req, modelName, payload, userId, category, entity }) {
  await ensureContract(payload.contract_id, userId);
  await ensureCollateralForContract(payload.collateral_id, payload.contract_id);
  await ensureThirdParty(payload.third_party_id, category);
  const fileMeta = payload.file
    ? persistDomainFile({
        entity,
        input: payload.file,
        fallbackBaseName: category,
      })
    : null;
  const data = { ...payload };
  delete data.file;
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
  const saved = await repository.create(modelName, {
    ...data,
    status: normalizeUpper(data.status),
    ...(fileMeta || {}),
    created_by: userId || null,
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
  const fileMeta =
    payload.file !== undefined && payload.file !== null
      ? persistDomainFile({
          entity,
          input: payload.file,
          previousPath: current.file_path,
          fallbackBaseName: category,
        })
      : null;
  const data = { ...payload };
  delete data.file;
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
  const saved = await repository.update(modelName, id, {
    ...data,
    ...(fileMeta || {}),
    updated_by: userId || null,
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

exports.listNotaryProgress = async ({ req, query, userId }) =>
  listModel({
    req,
    modelName: "legal_notary_progress",
    query,
    searchFields: ["deed_type", "deed_number", "status", "notes"],
    extraWhere: await buildContractAccessWhere(userId),
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

exports.deleteRecord = async ({ modelName, id, userId }) => {
  const current = await repository.findById(modelName, id, { deleted_at: null });
  if (!current) throw new AppError("Data tidak ditemukan.", 404);
  if (current.contract_id) {
    await ensureContract(current.contract_id, userId);
  }
  await repository.update(modelName, id, {
    deleted_at: new Date(),
    deleted_by: userId || null,
  });
};

exports.listClaims = async ({ req, query, userId }) =>
  listModel({
    req,
    modelName: "legal_claims",
    query,
    searchFields: ["policy_number", "claim_type", "status", "notes"],
    extraWhere: await buildContractAccessWhere(userId),
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
  const fileMeta = payload.file
    ? persistDomainFile({
        entity: "legal/claims",
        input: payload.file,
        fallbackBaseName: payload.claim_type,
      })
    : null;
  const data = { ...payload };
  delete data.file;
  data.collateral_id = claimCollateralId;
  data.claim_type = await resolveLegalProcessType(
    data.claim_type,
    "INSURANCE_CLAIM",
    "Jenis klaim",
  );
  return serializeClaim(
    req,
    await repository.create("legal_claims", {
      ...data,
      policy_number: normalizeText(data.policy_number),
      status: normalizeUpper(data.status || "PENGAJUAN"),
      submitted_at: new Date(data.submitted_at),
      disbursed_at: data.disbursed_at ? new Date(data.disbursed_at) : null,
      ...(fileMeta || {}),
      created_by: userId || null,
    }),
  );
};

exports.updateClaim = async ({ req, id, payload, userId }) => {
  const current = await repository.findById("legal_claims", id, { deleted_at: null });
  if (!current) throw new AppError("Klaim tidak ditemukan.", 404);
  await ensureContract(current.contract_id, userId);
  const fileMeta =
    payload.file !== undefined && payload.file !== null
      ? persistDomainFile({
          entity: "legal/claims",
          input: payload.file,
          previousPath: current.file_path,
          fallbackBaseName: payload.claim_type || current.claim_type,
        })
      : null;
  const data = { ...payload };
  delete data.file;
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
  return serializeClaim(
    req,
    await repository.update("legal_claims", id, {
      ...data,
      ...(fileMeta || {}),
      updated_by: userId || null,
    }),
  );
};

exports.listDeposits = async ({ req, query, userId }) =>
  listModel({
    req,
    modelName: "legal_deposits",
    query,
    searchFields: ["type", "status", "notes"],
    extraWhere: await buildContractAccessWhere(userId),
    serializer: serializeDeposit,
  });

exports.createDeposit = async ({ req, payload, userId }) => {
  const type = assertDepositType(payload.type);
  const depositTypeId = normalizeText(payload.deposit_type_id);
  const thirdPartyId = normalizeText(payload.third_party_id);
  const openingTransaction = payload.opening_transaction || null;

  await ensureContract(payload.contract_id, userId);
  await ensureDepositType(depositTypeId, type);
  await ensureDepositThirdParty(thirdPartyId, type);

  if (payload.file && !openingTransaction) {
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

    if (openingTransaction) {
      const action = assertDepositTransactionAction(openingTransaction.action || "TITIPAN");
      if (action !== "TITIPAN") {
        throw new AppError("Transaksi awal dana titipan wajib berupa TITIPAN.", 422);
      }
      const fileMeta = payload.file
        ? persistDomainFile({
            entity: "legal/deposit-transactions",
            input: payload.file,
            fallbackBaseName: `bukti-titipan-${deposit.id}`,
          })
        : null;
      await repository.create(
        "legal_deposit_transactions",
        {
          deposit_id: deposit.id,
          transaction_date: new Date(openingTransaction.transaction_date),
          action,
          amount: openingTransaction.amount,
          notes: normalizeText(openingTransaction.notes),
          ...depositTransactionFileFields(fileMeta),
          created_by: userId || null,
        },
        tx,
      );
      await recalculateDepositLedger(deposit.id, userId, tx);
    }

    return serializeDeposit(
      req,
      await repository.findById("legal_deposits", deposit.id, { deleted_at: null }, tx),
    );
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
    return serializeDeposit(
      req,
      await repository.findById("legal_deposits", id, { deleted_at: null }, tx),
    );
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
    const fileMeta = payload.file
      ? persistDomainFile({
          entity: "legal/deposit-transactions",
          input: payload.file,
          fallbackBaseName: `bukti-${action.toLowerCase()}-${payload.deposit_id}`,
        })
      : null;
    const transaction = await repository.create(
      "legal_deposit_transactions",
      {
        deposit_id: payload.deposit_id,
        transaction_date: new Date(payload.transaction_date),
        action,
        amount: payload.amount,
        notes: normalizeText(payload.notes),
        ...depositTransactionFileFields(fileMeta),
        created_by: userId || null,
      },
      tx,
    );
    await recalculateDepositLedger(payload.deposit_id, userId, tx);
    return serializeDepositTransaction(req, transaction);
  });
};

exports.getSummaryReport = async (_query = {}, userId = null) => {
  const scope = await getLegalReportScope(userId, LEGAL_REPORT_URLS.summary);
  const contractAccessWhere = buildContractAccessWhereFromScope(scope);
  const [
    templates,
    prints,
    notary,
    insurance,
    kjpp,
    claims,
    deposits,
  ] = await Promise.all([
    scope.canReportAll
      ? repository.countWhere("legal_document_templates", { deleted_at: null })
      : 0,
    repository.countWhere("legal_print_histories", {
      deleted_at: null,
      ...contractAccessWhere,
    }),
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
    templates,
    prints,
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
