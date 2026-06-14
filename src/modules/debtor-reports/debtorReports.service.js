const repository = require("./debtorReports.repository");
const debtorsRepository = require("../debtors/debtors.repository");
const {
  buildContractVisibilityWhere,
  buildDebtorVisibilityWhere,
  getDebtorAccessScope,
} = require("../../utils/debtor-access");
const { REPORT_ALL_FEATURE } = require("../../utils/menu-access");
const { roleHasFeature } = require("../../utils/rbac");
const { serializeFile } = require("../../utils/domain-files");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  resolvePagination,
} = require("../../utils/pagination");
const {
  SLIK_REFERENCE_FIELD_MAPPINGS,
  resolveSlikReference,
  withSlikReferenceFields,
} = require("../../utils/slik-reference-dictionary");

const REPORT_URLS = {
  summary: "/dashboard/informasi-debitur/laporan",
  portfolio: "/dashboard/informasi-debitur/laporan",
  facilities: "/dashboard/informasi-debitur/laporan",
  collaterals: "/dashboard/informasi-debitur/laporan",
  completeness: "/dashboard/informasi-debitur/laporan",
  npf: "/dashboard/informasi-debitur/laporan/npf",
  marketingActivity: "/dashboard/informasi-debitur/laporan/aktivitas-marketing",
};

const ACTIVE_CONTRACT_STATUSES = ["ACTIVE", "AKTIF", "BERJALAN"];
const CLOSED_CONTRACT_STATUSES = ["CLOSED", "LUNAS", "SELESAI"];
const CUSTOMER_TYPE_LABELS = {
  INDIVIDUAL: "Perorangan (I)",
  LEGAL_ENTITY: "Badan Usaha/Yayasan (B)",
};
const COMPLETENESS_ISSUES = {
  REQUIRED_DOCUMENTS_INCOMPLETE: {
    label: "Dokumen wajib belum lengkap",
    severity: "medium",
    impact: "Checklist dokumen wajib debitur belum lengkap.",
    recommendation: "Lengkapi dokumen wajib dari tab Dokumen pada detail debitur.",
  },
  DEBTOR_WITHOUT_FACILITY: {
    label: "Debitur tanpa F01",
    severity: "high",
    impact: "CIF sudah masuk, tetapi belum punya fasilitas F01.",
    recommendation: "Import F01 atau cek kesesuaian nomor debitur pada file SLIK.",
  },
  FACILITY_WITHOUT_COLLATERAL: {
    label: "Fasilitas tanpa A01",
    severity: "medium",
    impact: "Fasilitas belum punya agunan terstruktur A01.",
    recommendation: "Import A01 atau cek facility_number agar agunan terhubung ke fasilitas.",
  },
  UNLINKED_COLLATERAL: {
    label: "Agunan belum link",
    severity: "high",
    impact: "A01 belum terhubung ke debitur atau fasilitas.",
    recommendation: "Cek facility_number dan pastikan F01 terkait sudah tersedia.",
  },
  MISSING_SLIK_PERIOD: {
    label: "Tanpa periode SLIK",
    severity: "medium",
    impact: "Fasilitas belum punya snapshot/periode SLIK.",
    recommendation: "Import F01 untuk periode terkait atau cek mapping kontrak.",
  },
};
const COMPLETENESS_ISSUE_ORDER = Object.keys(COMPLETENESS_ISSUES);

function number(value) {
  return Number(value || 0);
}

function roundPercent(value) {
  return Math.round(value * 10000) / 100;
}

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date;
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().replace(/\s+/g, " ");
  return normalized || null;
}

function normalizeFilter(value) {
  const normalized = normalizeText(value);
  if (!normalized || normalized.toLowerCase() === "all") return null;
  return normalized;
}

function normalizeUpper(value) {
  const normalized = normalizeFilter(value);
  return normalized ? normalized.toUpperCase() : null;
}

function normalizeCustomerType(value) {
  const normalized = normalizeUpper(value);
  if (!normalized) return null;
  if (["I", "INDIVIDUAL", "PERORANGAN"].includes(normalized)) return "INDIVIDUAL";
  if (["B", "LEGAL_ENTITY", "BADAN_HUKUM", "BADAN HUKUM", "YAYASAN"].includes(normalized)) {
    return "LEGAL_ENTITY";
  }
  return normalized;
}

function normalizeCompletenessIssue(value) {
  const normalized = normalizeUpper(value);
  if (!normalized) return null;
  if (COMPLETENESS_ISSUES[normalized]) return normalized;
  return null;
}

function customerTypeLabel(value) {
  const normalized = normalizeCustomerType(value);
  return normalized ? CUSTOMER_TYPE_LABELS[normalized] || normalized : null;
}

function collectibilityDisplayFromCode(code) {
  return resolveSlikReference("collectibility_code", code)?.display ?? null;
}

function collectibilityDisplayFromRecord(collectibility) {
  if (!collectibility) return null;
  const code = collectibility.code || collectibility.level;
  return (
    collectibilityDisplayFromCode(code) ||
    [collectibility.code, collectibility.name].filter(Boolean).join(" - ") ||
    collectibility.name ||
    null
  );
}

function scopePayload(scope) {
  return {
    can_report_all: scope.canReportAll,
    can_view_division: scope.canViewDivision,
    can_manage_all: scope.operationalCanManageAll,
  };
}

function decimalToNumber(value) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function buildRequiredDocumentsSummary(aggregate) {
  const total = Number(aggregate?.required_documents_total || 0);
  const uploaded = Math.min(
    Number(aggregate?.required_documents_uploaded || 0),
    total,
  );
  const missing = Math.max(total - uploaded, 0);

  if (total === 0) {
    return {
      total,
      uploaded: 0,
      missing: 0,
      status: "NO_CHECKLIST",
      display: "Tidak ada checklist",
    };
  }

  return {
    total,
    uploaded,
    missing,
    status: missing === 0 ? "COMPLETE" : "INCOMPLETE",
    display: `${uploaded}/${total} wajib`,
  };
}

function requiredDocumentsFieldsFromAggregate(aggregate) {
  const requiredDocuments = buildRequiredDocumentsSummary(aggregate);
  return {
    required_documents_total: requiredDocuments.total,
    required_documents_uploaded: requiredDocuments.uploaded,
    required_documents_missing: requiredDocuments.missing,
    required_documents_status: requiredDocuments.status,
    required_documents_display: requiredDocuments.display,
  };
}

function enrichSerializedDebtorWithAggregate(debtor, aggregate) {
  if (!debtor || !aggregate) return debtor;
  return {
    ...debtor,
    ...requiredDocumentsFieldsFromAggregate(aggregate),
    latest_slik_period_month:
      debtor.latest_slik_period_month || aggregate.latest_slik_period_month || null,
    latest_collectibility_display:
      debtor.latest_collectibility_display ||
      collectibilityDisplayFromCode(aggregate.latest_collectibility_code) ||
      null,
  };
}

function serializeBranch(branch) {
  if (!branch) return null;
  return {
    id: branch.id,
    code: branch.code ?? null,
    name: branch.name,
  };
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

function serializeParameter(item) {
  if (!item) return null;
  return {
    id: item.id,
    code: item.code ?? null,
    name: item.name,
    level: item.level ?? null,
    is_npf: item.is_npf ?? null,
  };
}

function serializeCollectibility(item) {
  if (!item) return null;
  return {
    id: item.id,
    period_month: item.period_month,
    kol_level_id: item.kol_level_id,
    level: item.kol_level?.level ?? null,
    code: item.kol_level?.code ?? null,
    name: item.kol_level?.name ?? null,
    is_npf: Boolean(item.kol_level?.is_npf),
    outstanding_pokok: decimalToNumber(item.outstanding_pokok),
    outstanding_margin: decimalToNumber(item.outstanding_margin),
    dpd: item.dpd ?? null,
    notes: item.notes ?? null,
    created_at: item.created_at,
  };
}

function serializeContractSnapshot(item) {
  if (!item) return null;
  return withSlikReferenceFields({
    id: item.id,
    debtor_id: item.debtor_id,
    contract_id: item.contract_id,
    period_month: item.period_month,
    facility_number: item.facility_number,
    debtor_number: item.debtor_number,
    credit_nature_code: item.credit_nature_code,
    credit_type_code: item.credit_type_code,
    financing_scheme_code: item.financing_scheme_code,
    initial_akad_number: item.initial_akad_number,
    initial_akad_date: item.initial_akad_date,
    final_akad_number: item.final_akad_number,
    final_akad_date: item.final_akad_date,
    new_or_extension_code: item.new_or_extension_code,
    credit_start_date: item.credit_start_date,
    start_date: item.start_date,
    due_date: item.due_date,
    debtor_category_code: item.debtor_category_code,
    usage_type_code: item.usage_type_code,
    usage_orientation_code: item.usage_orientation_code,
    economic_sector_code: item.economic_sector_code,
    project_location_city_code: item.project_location_city_code,
    project_value: item.project_value === null || item.project_value === undefined ? null : decimalToNumber(item.project_value),
    currency_code: item.currency_code,
    interest_rate: item.interest_rate === null || item.interest_rate === undefined ? null : Number(item.interest_rate),
    interest_type_code: item.interest_type_code,
    government_program_code: item.government_program_code,
    takeover_from: item.takeover_from,
    source_of_funds_code: item.source_of_funds_code,
    initial_plafond: item.initial_plafond === null || item.initial_plafond === undefined ? null : decimalToNumber(item.initial_plafond),
    plafond: item.plafond === null || item.plafond === undefined ? null : decimalToNumber(item.plafond),
    current_month_disbursement:
      item.current_month_disbursement === null || item.current_month_disbursement === undefined
        ? null
        : decimalToNumber(item.current_month_disbursement),
    penalty: item.penalty === null || item.penalty === undefined ? null : decimalToNumber(item.penalty),
    baki_debet: item.baki_debet === null || item.baki_debet === undefined ? null : decimalToNumber(item.baki_debet),
    original_currency_amount:
      item.original_currency_amount === null || item.original_currency_amount === undefined
        ? null
        : decimalToNumber(item.original_currency_amount),
    collectibility_code: item.collectibility_code,
    default_date: item.default_date,
    default_reason_code: item.default_reason_code,
    principal_arrears: item.principal_arrears === null || item.principal_arrears === undefined ? null : decimalToNumber(item.principal_arrears),
    margin_arrears: item.margin_arrears === null || item.margin_arrears === undefined ? null : decimalToNumber(item.margin_arrears),
    days_past_due: item.days_past_due,
    arrears_frequency: item.arrears_frequency,
    restructuring_frequency: item.restructuring_frequency,
    initial_restructuring_date: item.initial_restructuring_date,
    final_restructuring_date: item.final_restructuring_date,
    restructuring_method_code: item.restructuring_method_code,
    condition_code: item.condition_code,
    condition_date: item.condition_date,
    description: item.description,
    branch_code: item.branch_code,
    operation_code: item.operation_code,
    created_at: item.created_at,
    updated_at: item.updated_at,
  }, SLIK_REFERENCE_FIELD_MAPPINGS.contractSnapshot);
}

function serializeDebtorSummary(debtor, aggregate = null) {
  if (!debtor) return null;
  const requiredDocuments = aggregate
    ? requiredDocumentsFieldsFromAggregate(aggregate)
    : null;
  return withSlikReferenceFields({
    id: debtor.id,
    debtor_number: debtor.debtor_number,
    identity_number: debtor.identity_number,
    name: debtor.name,
    address: debtor.address ?? null,
    phone: debtor.phone ?? null,
    branch_id: debtor.branch_id ?? debtor.branch?.id ?? null,
    marketing_user_id: debtor.marketing_user_id ?? debtor.marketing_user?.id ?? null,
    financing_number: debtor.financing_number ?? null,
    customer_type: debtor.customer_type ?? null,
    customer_type_label: customerTypeLabel(debtor.customer_type),
    slik_segment: debtor.slik_segment ?? null,
    slik_status_code: debtor.slik_status_code ?? null,
    slik_operation_code: debtor.slik_operation_code ?? null,
    status: debtor.status ?? "ACTIVE",
    description: debtor.description ?? null,
    branch: serializeBranch(debtor.branch),
    marketing_user: serializeUser(debtor.marketing_user),
    individual_profile: null,
    legal_entity_profile: null,
    latest_contract: null,
    contracts: [],
    contracts_count: 0,
    collaterals_count: 0,
    documents_count: 0,
    ...(requiredDocuments
      ? {
          ...requiredDocuments,
        }
      : {}),
    total_outstanding: 0,
    latest_slik_period_month: aggregate?.latest_slik_period_month ?? null,
    latest_collectibility_display: null,
    created_at: debtor.created_at ?? null,
    updated_at: debtor.updated_at ?? null,
  }, SLIK_REFERENCE_FIELD_MAPPINGS.debtor);
}

function serializeContract(contract) {
  if (!contract) return null;
  const collectibilities = Array.isArray(contract.collectibilities)
    ? contract.collectibilities.map(serializeCollectibility).filter(Boolean)
    : [];
  const slikSnapshots = Array.isArray(contract.slik_snapshots)
    ? contract.slik_snapshots.map(serializeContractSnapshot).filter(Boolean)
    : [];

  return {
    id: contract.id,
    no_kontrak: contract.no_kontrak,
    debtor_id: contract.debtor_id,
    debtor: serializeDebtorSummary(contract.debtor),
    product_id: contract.product_id ?? null,
    akad_type_id: contract.akad_type_id ?? null,
    branch_id: contract.branch_id ?? null,
    marketing_user_id: contract.marketing_user_id ?? null,
    tanggal_akad: contract.tanggal_akad,
    tanggal_jatuh_tempo: contract.tanggal_jatuh_tempo,
    plafond: decimalToNumber(contract.plafond),
    pokok: decimalToNumber(contract.pokok),
    margin: decimalToNumber(contract.margin),
    tenor: contract.tenor ?? null,
    outstanding_pokok: decimalToNumber(contract.outstanding_pokok),
    outstanding_margin: decimalToNumber(contract.outstanding_margin),
    total_outstanding:
      decimalToNumber(contract.outstanding_pokok) +
      decimalToNumber(contract.outstanding_margin),
    status: contract.status,
    objek_pembiayaan: contract.objek_pembiayaan ?? null,
    agunan: contract.agunan ?? null,
    product: serializeParameter(contract.product),
    akad_type: serializeParameter(contract.akad_type),
    branch: serializeBranch(contract.branch),
    marketing_user: serializeUser(contract.marketing_user),
    latest_collectibility: collectibilities[0] || null,
    collectibilities,
    latest_slik_snapshot: slikSnapshots[0] || null,
    slik_snapshots: slikSnapshots,
    created_at: contract.created_at,
    updated_at: contract.updated_at,
  };
}

function serializeDebtor(debtor, aggregate = null) {
  if (!debtor) return null;
  const contracts = Array.isArray(debtor.contracts)
    ? debtor.contracts.map(serializeContract).filter(Boolean)
    : [];
  const latestContract = contracts[0] || null;
  const latestCollectibilityDisplay =
    collectibilityDisplayFromCode(aggregate?.latest_collectibility_code) ||
    latestContract?.latest_slik_snapshot?.collectibility_display ||
    collectibilityDisplayFromRecord(latestContract?.latest_collectibility);

  return withSlikReferenceFields({
    id: debtor.id,
    debtor_number: debtor.debtor_number,
    identity_number: debtor.identity_number,
    name: debtor.name,
    address: debtor.address,
    phone: debtor.phone,
    branch_id: debtor.branch_id,
    marketing_user_id: debtor.marketing_user_id,
    financing_number: debtor.financing_number,
    customer_type: debtor.customer_type,
    customer_type_label: customerTypeLabel(debtor.customer_type),
    slik_segment: debtor.slik_segment,
    slik_status_code: debtor.slik_status_code,
    slik_operation_code: debtor.slik_operation_code,
    status: debtor.status,
    description: debtor.description,
    branch: serializeBranch(debtor.branch),
    marketing_user: serializeUser(debtor.marketing_user),
    individual_profile: debtor.individual_profile,
    legal_entity_profile: debtor.legal_entity_profile,
    latest_contract: latestContract,
    contracts,
    contracts_count: aggregate?.contracts_count ?? contracts.length,
    collaterals_count: aggregate?.collaterals_count ?? 0,
    documents_count: aggregate?.documents_count ?? 0,
    total_outstanding: aggregate?.total_outstanding ?? 0,
    latest_slik_period_month:
      aggregate?.latest_slik_period_month ||
      latestContract?.latest_slik_snapshot?.period_month ||
      latestContract?.latest_collectibility?.period_month ||
      null,
    latest_collectibility_display: latestCollectibilityDisplay ?? null,
    created_at: debtor.created_at,
    updated_at: debtor.updated_at,
  }, SLIK_REFERENCE_FIELD_MAPPINGS.debtor);
}

function serializeCollateral(item) {
  if (!item) return null;
  return withSlikReferenceFields({
    id: item.id,
    debtor_id: item.debtor_id,
    contract_id: item.contract_id,
    collateral_number: item.collateral_number,
    facility_number: item.facility_number,
    facility_segment_code: item.facility_segment_code,
    collateral_status_code: item.collateral_status_code,
    collateral_type: item.collateral_type,
    rating: item.rating,
    rating_agency_code: item.rating_agency_code,
    binding_type_code: item.binding_type_code,
    binding_date: item.binding_date,
    owner_name: item.owner_name,
    proof_number: item.proof_number,
    address: item.address,
    location_city_code: item.location_city_code,
    market_value: item.market_value === null || item.market_value === undefined ? null : decimalToNumber(item.market_value),
    appraisal_value: item.appraisal_value === null || item.appraisal_value === undefined ? null : decimalToNumber(item.appraisal_value),
    reporter_appraisal_date: item.reporter_appraisal_date,
    independent_appraisal_value:
      item.independent_appraisal_value === null || item.independent_appraisal_value === undefined
        ? null
        : decimalToNumber(item.independent_appraisal_value),
    independent_appraiser_name: item.independent_appraiser_name,
    independent_appraisal_date: item.independent_appraisal_date,
    paripasu_status: item.paripasu_status,
    paripasu_percentage: item.paripasu_percentage === null || item.paripasu_percentage === undefined ? null : Number(item.paripasu_percentage),
    joint_credit_status: item.joint_credit_status,
    insured_status: item.insured_status,
    description: item.description,
    branch_code: item.branch_code,
    operation_code: item.operation_code,
    period_month: item.period_month,
    last_import_period_month: item.last_import_period_month,
    debtor: serializeDebtorSummary(item.debtor || item.contract?.debtor),
    contract: item.contract
      ? {
          id: item.contract.id,
          debtor_id: item.contract.debtor_id,
          no_kontrak: item.contract.no_kontrak,
          status: item.contract.status,
        }
      : null,
    created_at: item.created_at,
    updated_at: item.updated_at,
  }, SLIK_REFERENCE_FIELD_MAPPINGS.collateral);
}

function serializeCompletenessIssue({
  issue_type,
  debtor = null,
  contract = null,
  collateral = null,
  debtorAggregate = null,
}) {
  const definition = COMPLETENESS_ISSUES[issue_type];
  if (!definition) return null;
  const serializedDebtor =
    serializeDebtorSummary(
      debtor || contract?.debtor || collateral?.debtor || collateral?.contract?.debtor,
      debtorAggregate,
    );
  const serializedContract = serializeContract(contract);
  const serializedCollateral = serializeCollateral(collateral);
  const periodMonth =
    serializedContract?.latest_slik_snapshot?.period_month ||
    serializedContract?.latest_collectibility?.period_month ||
    serializedCollateral?.period_month ||
    serializedDebtor?.latest_slik_period_month ||
    null;
  const idSource =
    serializedCollateral?.id ||
    serializedContract?.id ||
    serializedDebtor?.id ||
    "unknown";

  return {
    id: `${issue_type}:${idSource}`,
    issue_type,
    issue_label: definition.label,
    severity: definition.severity,
    impact: definition.impact,
    recommendation: definition.recommendation,
    debtor_id: serializedDebtor?.id ?? serializedContract?.debtor_id ?? serializedCollateral?.debtor_id ?? null,
    debtor: serializedDebtor,
    contract_id: serializedContract?.id ?? serializedCollateral?.contract_id ?? null,
    contract: serializedContract,
    collateral_id: serializedCollateral?.id ?? null,
    collateral: serializedCollateral,
    period_month: periodMonth,
    created_at:
      collateral?.created_at ||
      contract?.created_at ||
      debtor?.created_at ||
      null,
  };
}

function normalizeMarketingKind(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "ACTION_PLAN") return "ACTION_PLAN";
  if (normalized === "VISIT_RESULT" || normalized === "HASIL_KUNJUNGAN") {
    return "VISIT_RESULT";
  }
  if (normalized === "HANDLING_STEP" || normalized === "LANGKAH_PENANGANAN") {
    return "HANDLING_STEP";
  }
  return null;
}

function normalizeMarketingSort(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return ["OLDEST", "TERLAMA", "ASC"].includes(normalized) ? "oldest" : "newest";
}

function normalizeLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 50;
  return Math.min(Math.max(Math.trunc(numeric), 1), 100);
}

function serializeMarketingReportActivity(req, item) {
  return {
    id: item.id,
    activity_kind: item.activity_kind,
    status: item.status,
    activity_date: item.activity_date,
    target_date: item.target_date,
    debtor: item.debtor,
    contract: item.contract,
    action_plan: item.action_plan,
    visit_address: item.visit_address,
    visit_result: item.visit_result,
    conclusion: item.conclusion,
    handling_step: item.handling_step,
    handling_result: item.handling_result,
    notes: item.notes,
    file: serializeFile(req, item, {
      module: "debtor_information",
      entityId: item.id,
      fallbackBaseName: item.activity_kind,
    }),
    created_at: item.created_at,
  };
}

function calculateRemainingMonths(value) {
  if (!value) return 0;
  const dueDate = new Date(value);
  if (Number.isNaN(dueDate.getTime())) return 0;
  const today = new Date();
  if (dueDate <= today) return 0;
  const yearDiff = dueDate.getFullYear() - today.getFullYear();
  const monthDiff = dueDate.getMonth() - today.getMonth();
  const baseMonths = yearDiff * 12 + monthDiff;
  return Math.max(baseMonths + (dueDate.getDate() > today.getDate() ? 1 : 0), 0);
}

async function getReportScope(userId, menuUrl) {
  const scope = await getDebtorAccessScope(userId);
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

function buildDebtorReportWhere(query, scope) {
  const clauses = [{ deleted_at: null }, buildDebtorVisibilityWhere(scope)];
  const search = normalizeFilter(query.search);
  const branchId = normalizeFilter(query.branch_id || query.branchId);
  const marketingUserId = normalizeFilter(
    query.marketing_user_id || query.marketingUserId,
  );
  const status = normalizeUpper(query.status);
  const customerType = normalizeCustomerType(
    query.customer_type || query.customerType,
  );
  const periodMonth = normalizeFilter(query.period_month || query.periodMonth);
  const collectibilityLevel = normalizeFilter(
    query.collectibility_level || query.kol_level || query.kol,
  );

  if (search) {
    clauses.push({
      OR: [
        { debtor_number: { contains: search, mode: "insensitive" } },
        { identity_number: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { address: { contains: search, mode: "insensitive" } },
        { branch: { name: { contains: search, mode: "insensitive" } } },
        { marketing_user: { name: { contains: search, mode: "insensitive" } } },
        {
          contracts: {
            some: {
              no_kontrak: { contains: search, mode: "insensitive" },
            },
          },
        },
      ],
    });
  }

  if (branchId) clauses.push({ branch_id: branchId });
  if (marketingUserId) clauses.push({ marketing_user_id: marketingUserId });
  if (status) clauses.push({ status });
  if (customerType) clauses.push({ customer_type: customerType });
  if (periodMonth) {
    clauses.push({
      contracts: {
        some: {
          deleted_at: null,
          OR: [
            {
              slik_snapshots: {
                some: {
                  deleted_at: null,
                  period_month: periodMonth,
                },
              },
            },
            {
              collectibilities: {
                some: {
                  deleted_at: null,
                  period_month: periodMonth,
                },
              },
            },
          ],
        },
      },
    });
  }
  if (collectibilityLevel) {
    const level = Number(collectibilityLevel);
    if (Number.isFinite(level)) {
      clauses.push({
        contracts: {
          some: {
            deleted_at: null,
            collectibilities: {
              some: {
                deleted_at: null,
                kol_level: {
                  is: {
                    level,
                  },
                },
              },
            },
          },
        },
      });
    }
  }

  return { AND: clauses.filter((item) => Object.keys(item).length > 0) };
}

function buildContractReportWhere(query, scope, options = {}) {
  const clauses = [{ deleted_at: null }, buildContractVisibilityWhere(scope)];
  const search = normalizeFilter(query.search);
  const branchId = normalizeFilter(query.branch_id || query.branchId);
  const marketingUserId = normalizeFilter(
    query.marketing_user_id || query.marketingUserId,
  );
  const status = normalizeUpper(query.status);
  const customerType = normalizeCustomerType(
    query.customer_type || query.customerType,
  );
  const periodMonth = normalizeFilter(query.period_month || query.periodMonth);
  const collectibilityLevel = normalizeFilter(
    query.collectibility_level || query.kol_level || query.kol,
  );

  if (search) {
    clauses.push({
      OR: [
        { no_kontrak: { contains: search, mode: "insensitive" } },
        { debtor: { name: { contains: search, mode: "insensitive" } } },
        { debtor: { debtor_number: { contains: search, mode: "insensitive" } } },
        { debtor: { identity_number: { contains: search, mode: "insensitive" } } },
        {
          slik_snapshots: {
            some: {
              facility_number: { contains: search, mode: "insensitive" },
            },
          },
        },
      ],
    });
  }

  if (branchId) {
    clauses.push({
      OR: [{ branch_id: branchId }, { debtor: { branch_id: branchId } }],
    });
  }
  if (marketingUserId) {
    clauses.push({
      OR: [
        { marketing_user_id: marketingUserId },
        { debtor: { marketing_user_id: marketingUserId } },
      ],
    });
  }
  if (options.activeOnly) {
    clauses.push({ status: { in: ACTIVE_CONTRACT_STATUSES } });
  } else if (status) {
    clauses.push({ status });
  }
  if (customerType) clauses.push({ debtor: { customer_type: customerType } });
  if (periodMonth) {
    clauses.push({
      OR: [
        {
          slik_snapshots: {
            some: {
              deleted_at: null,
              period_month: periodMonth,
            },
          },
        },
        {
          collectibilities: {
            some: {
              deleted_at: null,
              period_month: periodMonth,
            },
          },
        },
      ],
    });
  }
  if (collectibilityLevel) {
    const level = Number(collectibilityLevel);
    if (Number.isFinite(level)) {
      clauses.push({
        collectibilities: {
          some: {
            deleted_at: null,
            kol_level: {
              is: {
                level,
              },
            },
          },
        },
      });
    }
  }

  return { AND: clauses.filter((item) => Object.keys(item).length > 0) };
}

function buildCollateralVisibilityWhere(scope) {
  if (scope?.canViewAll || scope?.canManageAll) return {};
  if (!scope?.userId) return { id: "__no_collateral_access__" };

  return {
    OR: [
      {
        debtor: {
          is: buildDebtorVisibilityWhere(scope),
        },
      },
      {
        contract: {
          is: buildContractVisibilityWhere(scope),
        },
      },
    ],
  };
}

function buildCollateralReportWhere(query, scope) {
  const clauses = [{ deleted_at: null }, buildCollateralVisibilityWhere(scope)];
  const search = normalizeFilter(query.search);
  const branchId = normalizeFilter(query.branch_id || query.branchId);
  const marketingUserId = normalizeFilter(
    query.marketing_user_id || query.marketingUserId,
  );
  const customerType = normalizeCustomerType(
    query.customer_type || query.customerType,
  );
  const linkStatus = normalizeUpper(query.link_status || query.linkStatus);
  const periodMonth = normalizeFilter(query.period_month || query.periodMonth);
  const collectibilityLevel = normalizeFilter(
    query.collectibility_level || query.kol_level || query.kol,
  );
  const collateralType = normalizeFilter(
    query.collateral_type || query.collateralType,
  );

  if (search) {
    clauses.push({
      OR: [
        { collateral_number: { contains: search, mode: "insensitive" } },
        { facility_number: { contains: search, mode: "insensitive" } },
        { collateral_type: { contains: search, mode: "insensitive" } },
        { owner_name: { contains: search, mode: "insensitive" } },
        { proof_number: { contains: search, mode: "insensitive" } },
        { address: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { debtor: { is: { name: { contains: search, mode: "insensitive" } } } },
        {
          debtor: {
            is: { debtor_number: { contains: search, mode: "insensitive" } },
          },
        },
        { contract: { is: { no_kontrak: { contains: search, mode: "insensitive" } } } },
      ],
    });
  }

  if (branchId) {
    clauses.push({
      OR: [
        { debtor: { is: { branch_id: branchId } } },
        { contract: { is: { branch_id: branchId } } },
        { contract: { is: { debtor: { branch_id: branchId } } } },
      ],
    });
  }
  if (marketingUserId) {
    clauses.push({
      OR: [
        { debtor: { is: { marketing_user_id: marketingUserId } } },
        { contract: { is: { marketing_user_id: marketingUserId } } },
        { contract: { is: { debtor: { marketing_user_id: marketingUserId } } } },
      ],
    });
  }
  if (customerType) {
    clauses.push({
      OR: [
        { debtor: { is: { customer_type: customerType } } },
        { contract: { is: { debtor: { customer_type: customerType } } } },
      ],
    });
  }
  if (collateralType) {
    clauses.push({
      collateral_type: { contains: collateralType, mode: "insensitive" },
    });
  }
  if (linkStatus === "LINKED") {
    clauses.push({
      OR: [{ debtor_id: { not: null } }, { contract_id: { not: null } }],
    });
  } else if (linkStatus === "UNLINKED") {
    clauses.push({ debtor_id: null, contract_id: null });
  }
  if (periodMonth) clauses.push({ period_month: periodMonth });
  if (collectibilityLevel) {
    const level = Number(collectibilityLevel);
    if (Number.isFinite(level)) {
      clauses.push({
        contract: {
          is: {
            collectibilities: {
              some: {
                deleted_at: null,
                kol_level: {
                  is: {
                    level,
                  },
                },
              },
            },
          },
        },
      });
    }
  }

  return { AND: clauses.filter((item) => Object.keys(item).length > 0) };
}

function buildPortfolioSummary(rows, contractAggregate, collateralCount, scope) {
  const totalDebtors = rows.length;
  const activeDebtors = rows.filter((item) => item.status === "ACTIVE").length;
  const individualDebtors = rows.filter(
    (item) => normalizeCustomerType(item.customer_type) === "INDIVIDUAL",
  ).length;
  const legalEntityDebtors = rows.filter(
    (item) => normalizeCustomerType(item.customer_type) === "LEGAL_ENTITY",
  ).length;

  return {
    total_debtors: totalDebtors,
    active_debtors: activeDebtors,
    inactive_debtors: Math.max(totalDebtors - activeDebtors, 0),
    individual_debtors: individualDebtors,
    legal_entity_debtors: legalEntityDebtors,
    total_facilities: contractAggregate._count?._all || 0,
    total_collaterals: collateralCount,
    total_outstanding:
      decimalToNumber(contractAggregate._sum?.outstanding_pokok) +
      decimalToNumber(contractAggregate._sum?.outstanding_margin),
    scope: scopePayload(scope),
  };
}

function isNpfCollectibility(collectibility) {
  const level = Number(collectibility?.kol_level?.level ?? collectibility?.level);
  return collectibility?.kol_level?.is_npf === true || (Number.isFinite(level) && level >= 3);
}

function buildFacilitySummary(aggregate, collectibilityRows, activeCount, scope) {
  const npfFacilities = collectibilityRows.filter((item) =>
    isNpfCollectibility(item.collectibilities?.[0]),
  ).length;

  return {
    total_facilities: aggregate._count?._all || 0,
    active_facilities: activeCount,
    npf_facilities: npfFacilities,
    total_plafond: decimalToNumber(aggregate._sum?.plafond),
    total_outstanding:
      decimalToNumber(aggregate._sum?.outstanding_pokok) +
      decimalToNumber(aggregate._sum?.outstanding_margin),
    scope: scopePayload(scope),
  };
}

function buildCollateralSummary(aggregate, linkedCount, unlinkedCount, scope) {
  return {
    total_collaterals: aggregate._count?._all || 0,
    linked_collaterals: linkedCount,
    unlinked_collaterals: unlinkedCount,
    total_market_value: decimalToNumber(aggregate._sum?.market_value),
    total_appraisal_value: decimalToNumber(aggregate._sum?.appraisal_value),
    scope: scopePayload(scope),
  };
}

function buildCompletenessSummary(rows, scope) {
  const counts = rows.reduce(
    (current, item) => {
      current.total_issues += 1;
      if (item.issue_type === "REQUIRED_DOCUMENTS_INCOMPLETE") {
        current.required_documents_incomplete += 1;
      } else if (item.issue_type === "DEBTOR_WITHOUT_FACILITY") {
        current.debtors_without_facilities += 1;
      } else if (item.issue_type === "FACILITY_WITHOUT_COLLATERAL") {
        current.facilities_without_collaterals += 1;
      } else if (item.issue_type === "UNLINKED_COLLATERAL") {
        current.unlinked_collaterals += 1;
      } else if (item.issue_type === "MISSING_SLIK_PERIOD") {
        current.missing_slik_period += 1;
      }
      return current;
    },
    {
      total_issues: 0,
      required_documents_incomplete: 0,
      debtors_without_facilities: 0,
      facilities_without_collaterals: 0,
      unlinked_collaterals: 0,
      missing_slik_period: 0,
    },
  );

  return {
    ...counts,
    scope: scopePayload(scope),
  };
}

async function enrichCompletenessRows(rows) {
  const debtorIds = [
    ...new Set(rows.map((item) => item.debtor_id).filter(Boolean)),
  ];
  if (debtorIds.length === 0) return rows;

  const aggregates = await debtorsRepository.findListAggregates(debtorIds);
  return rows.map((item) => {
    const aggregate = aggregates.get(item.debtor_id);
    if (!aggregate) return item;

    return {
      ...item,
      debtor: enrichSerializedDebtorWithAggregate(item.debtor, aggregate),
      period_month:
        item.period_month || aggregate.latest_slik_period_month || null,
    };
  });
}

function buildReportMeta(total, pagination) {
  return buildPaginationMeta(total, pagination);
}

exports.getSummary = async (_query = {}, userId = null) => {
  const scope = await getReportScope(userId, REPORT_URLS.summary);
  const debtorWhere = buildDebtorVisibilityWhere(scope);
  const contractWhere = buildContractVisibilityWhere(scope);
  const [totalDebtors, activeDebtors, activeContracts, closedContracts] =
    await Promise.all([
      repository.countDebtors({ deleted_at: null, ...debtorWhere }),
      repository.countDebtors({ deleted_at: null, status: "ACTIVE", ...debtorWhere }),
      repository.countContracts({
        deleted_at: null,
        status: { in: ACTIVE_CONTRACT_STATUSES },
        ...contractWhere,
      }),
      repository.countContracts({
        deleted_at: null,
        status: { in: CLOSED_CONTRACT_STATUSES },
        ...contractWhere,
      }),
    ]);

  return {
    total_debtors: totalDebtors,
    active_debtors: activeDebtors,
    inactive_debtors: Math.max(totalDebtors - activeDebtors, 0),
    active_contracts: activeContracts,
    closed_contracts: closedContracts,
    scope: {
      can_report_all: scope.canReportAll,
      can_view_division: scope.canViewDivision,
      can_manage_all: scope.operationalCanManageAll,
    },
  };
};

exports.getPortfolio = async (query = {}, userId = null) => {
  const scope = await getReportScope(userId, REPORT_URLS.portfolio);
  const where = buildDebtorReportWhere(query, scope);
  const pagination = resolvePagination(query, PAGINATION_PROFILES.TABLE);
  const [rows, total, summaryRows, contractAggregate, collateralCount] =
    await Promise.all([
      repository.findPortfolioRows({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { created_at: "desc" },
      }),
      repository.countPortfolioRows(where),
      repository.findPortfolioAggregateRows(where),
      repository.aggregateContractsForDebtors(where),
      repository.countCollateralsForDebtors(where),
    ]);
  const aggregates = await repository.findDebtorListAggregates(
    rows.map((item) => item.id),
  );

  return {
    summary: buildPortfolioSummary(
      summaryRows,
      contractAggregate,
      collateralCount,
      scope,
    ),
    items: rows.map((item) => serializeDebtor(item, aggregates.get(item.id))),
    meta: buildReportMeta(total, pagination),
  };
};

exports.getFacilities = async (query = {}, userId = null) => {
  const scope = await getReportScope(userId, REPORT_URLS.facilities);
  const where = buildContractReportWhere(query, scope);
  const activeWhere = {
    AND: [where, { status: { in: ACTIVE_CONTRACT_STATUSES } }],
  };
  const pagination = resolvePagination(query, PAGINATION_PROFILES.TABLE);
  const [rows, total, aggregate, activeCount, collectibilityRows] =
    await Promise.all([
      repository.findFacilityRows({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { created_at: "desc" },
      }),
      repository.countFacilityRows(where),
      repository.aggregateFacilityRows(where),
      repository.countFacilityRows(activeWhere),
      repository.findFacilityCollectibilityRows(where),
    ]);

  return {
    summary: buildFacilitySummary(aggregate, collectibilityRows, activeCount, scope),
    items: rows.map(serializeContract).filter(Boolean),
    meta: buildReportMeta(total, pagination),
  };
};

exports.getCollaterals = async (query = {}, userId = null) => {
  const scope = await getReportScope(userId, REPORT_URLS.collaterals);
  const where = buildCollateralReportWhere(query, scope);
  const pagination = resolvePagination(query, PAGINATION_PROFILES.TABLE);
  const [rows, total, aggregate, linkedCount, unlinkedCount] = await Promise.all([
    repository.findCollateralRows({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { created_at: "desc" },
    }),
    repository.countCollateralRows(where),
    repository.aggregateCollateralRows(where),
    repository.countLinkedCollateralRows(where),
    repository.countUnlinkedCollateralRows(where),
  ]);

  return {
    summary: buildCollateralSummary(aggregate, linkedCount, unlinkedCount, scope),
    items: rows.map(serializeCollateral).filter(Boolean),
    meta: buildReportMeta(total, pagination),
  };
};

exports.getCompleteness = async (query = {}, userId = null) => {
  const scope = await getReportScope(userId, REPORT_URLS.completeness);
  const issueFilter = normalizeCompletenessIssue(query.issue_type || query.issueType);
  const pagination = resolvePagination(query, PAGINATION_PROFILES.TABLE);
  const completenessQuery = { ...query, status: "" };
  const debtorWhere = buildDebtorReportWhere(completenessQuery, scope);
  const contractWhere = buildContractReportWhere(completenessQuery, scope);
  const collateralWhere = buildCollateralReportWhere(
    {
      ...completenessQuery,
      link_status: "unlinked",
      linkStatus: "unlinked",
    },
    scope,
  );
  const tasks = [];

  if (!issueFilter || issueFilter === "REQUIRED_DOCUMENTS_INCOMPLETE") {
    tasks.push(
      repository.findDebtorsForCompletenessAudit(debtorWhere).then(async (rows) => {
        const aggregates = await debtorsRepository.findListAggregates(
          rows.map((item) => item.id),
        );

        return rows
          .map((debtor) => {
            const aggregate = aggregates.get(debtor.id);
            const requiredDocuments = buildRequiredDocumentsSummary(aggregate);
            if (requiredDocuments.total === 0 || requiredDocuments.missing === 0) {
              return null;
            }

            return serializeCompletenessIssue({
              issue_type: "REQUIRED_DOCUMENTS_INCOMPLETE",
              debtor,
              debtorAggregate: aggregate,
            });
          })
          .filter(Boolean);
      }),
    );
  }

  if (!issueFilter || issueFilter === "DEBTOR_WITHOUT_FACILITY") {
    tasks.push(
      repository.findDebtorsWithoutFacilities(debtorWhere).then((rows) =>
        rows.map((debtor) =>
          serializeCompletenessIssue({
            issue_type: "DEBTOR_WITHOUT_FACILITY",
            debtor,
          }),
        ),
      ),
    );
  }
  if (!issueFilter || issueFilter === "FACILITY_WITHOUT_COLLATERAL") {
    tasks.push(
      repository.findFacilitiesWithoutCollaterals(contractWhere).then((rows) =>
        rows.map((contract) =>
          serializeCompletenessIssue({
            issue_type: "FACILITY_WITHOUT_COLLATERAL",
            contract,
          }),
        ),
      ),
    );
  }
  if (!issueFilter || issueFilter === "UNLINKED_COLLATERAL") {
    tasks.push(
      repository.findUnlinkedCollaterals(collateralWhere).then((rows) =>
        rows.map((collateral) =>
          serializeCompletenessIssue({
            issue_type: "UNLINKED_COLLATERAL",
            collateral,
          }),
        ),
      ),
    );
  }
  if (!issueFilter || issueFilter === "MISSING_SLIK_PERIOD") {
    tasks.push(
      repository.findFacilitiesWithoutSlikPeriod(contractWhere).then((rows) =>
        rows.map((contract) =>
          serializeCompletenessIssue({
            issue_type: "MISSING_SLIK_PERIOD",
            contract,
          }),
        ),
      ),
    );
  }

  const rows = (await enrichCompletenessRows(
    (await Promise.all(tasks)).flat().filter(Boolean),
  ))
    .flat()
    .sort((left, right) => {
      const priority =
        COMPLETENESS_ISSUE_ORDER.indexOf(left.issue_type) -
        COMPLETENESS_ISSUE_ORDER.indexOf(right.issue_type);
      if (priority !== 0) return priority;
      return new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime();
    });

  return {
    summary: buildCompletenessSummary(rows, scope),
    items: rows.slice(pagination.skip, pagination.skip + pagination.take),
    meta: buildReportMeta(rows.length, pagination),
  };
};

exports.getNpf = async (query = {}, userId = null) => {
  const scope = await getReportScope(userId, [
    REPORT_URLS.npf,
    REPORT_URLS.summary,
  ]);
  const pagination = resolvePagination(query, PAGINATION_PROFILES.TABLE);
  const contractWhere = buildContractReportWhere(query, scope, {
    activeOnly: true,
  });
  const [contracts, trendRows] = await Promise.all([
    repository.findContractsForNpf(contractWhere),
    repository.findCollectibilityTrendRows({
      from: query.from_period,
      to: query.to_period,
      contractWhere,
    }),
  ]);
  const breakdownByKol = new Map();
  const details = [];
  let numerator = 0;
  let denominator = 0;

  for (const contract of contracts) {
    const outstanding =
      number(contract.outstanding_pokok) + number(contract.outstanding_margin);
    const latestKol = contract.collectibilities?.[0]?.kol_level || null;
    const key = latestKol?.level ?? "UNMAPPED";
    const existing = breakdownByKol.get(key) || {
      level: latestKol?.level ?? null,
      code: latestKol?.code ?? null,
      name: latestKol?.name ?? "Belum ada kolektibilitas",
      contract_count: 0,
      outstanding: 0,
      is_npf: false,
    };

    const isNpf =
      latestKol?.is_npf === true ||
      (Number.isFinite(Number(latestKol?.level)) && Number(latestKol.level) >= 3);
    existing.contract_count += 1;
    existing.outstanding += outstanding;
    existing.is_npf = existing.is_npf || isNpf;
    breakdownByKol.set(key, existing);

    denominator += outstanding;
    if (isNpf) numerator += outstanding;

    details.push({
      debtor_id: contract.debtor?.id ?? null,
      debtor_number: contract.debtor?.debtor_number ?? null,
      debtor_name: contract.debtor?.name ?? "-",
      contract_id: contract.id,
      contract_number: contract.no_kontrak,
      level: latestKol?.level ?? null,
      code: latestKol?.code ?? null,
      name: latestKol?.name ?? "Belum ada kolektibilitas",
      outstanding,
      outstanding_pokok: number(contract.outstanding_pokok),
      outstanding_margin: number(contract.outstanding_margin),
      remaining_months: calculateRemainingMonths(contract.tanggal_jatuh_tempo),
      is_npf: isNpf,
    });
  }
  const detailsMeta = buildReportMeta(details.length, pagination);
  const items = details.slice(
    pagination.skip,
    pagination.skip + pagination.take,
  );

  const trendByPeriod = new Map();
  for (const row of trendRows) {
    const outstanding = number(row.outstanding_pokok) + number(row.outstanding_margin);
    const isNpf =
      row.kol_level?.is_npf === true ||
      (Number.isFinite(Number(row.kol_level?.level)) &&
        Number(row.kol_level.level) >= 3);
    const current = trendByPeriod.get(row.period_month) || {
      period_month: row.period_month,
      numerator: 0,
      denominator: 0,
      percentage: 0,
    };
    current.denominator += outstanding;
    if (isNpf) current.numerator += outstanding;
    trendByPeriod.set(row.period_month, current);
  }

  const trend = [...trendByPeriod.values()].map((item) => ({
    ...item,
    percentage:
      item.denominator > 0 ? roundPercent(item.numerator / item.denominator) : 0,
  }));

  return {
    formula:
      "total outstanding kontrak aktif Kol 3-5 / total outstanding kontrak aktif",
    numerator,
    denominator,
    percentage: denominator > 0 ? roundPercent(numerator / denominator) : 0,
    breakdown_per_kol: [...breakdownByKol.values()].sort((a, b) => {
      if (a.level === null) return 1;
      if (b.level === null) return -1;
      return a.level - b.level;
    }),
    details,
    trend,
    items,
    meta: detailsMeta,
    summary: {
      numerator,
      denominator,
      percentage: denominator > 0 ? roundPercent(numerator / denominator) : 0,
      total_facilities: details.length,
      npf_facilities: details.filter((item) => item.is_npf).length,
      scope: scopePayload(scope),
    },
    scope: {
      can_report_all: scope.canReportAll,
      can_view_division: scope.canViewDivision,
      can_manage_all: scope.operationalCanManageAll,
    },
  };
};

exports.getMarketingActivity = async (req, query = {}, userId = null) => {
  const fromDate = parseDate(query.from_date);
  const toDate = parseDate(query.to_date, true);
  const activityKind = normalizeMarketingKind(query.activity_kind);
  const status = normalizeText(query.status)?.toUpperCase() || null;
  const search = normalizeText(query.search);
  const sort = normalizeMarketingSort(query.sort);
  const limit = normalizeLimit(query.limit);
  const scope = await getReportScope(userId, REPORT_URLS.marketingActivity);
  const debtorWhere = buildDebtorVisibilityWhere(scope);
  const reportParams = {
    fromDate,
    toDate,
    debtorWhere,
    activityKind,
    status,
    search,
    sort,
    limit,
  };
  const [groups, recent] = await Promise.all([
    repository.groupMarketingActivities(reportParams),
    repository.findRecentMarketingActivities(reportParams),
  ]);

  return {
    summary: groups.map((item) => ({
      activity_kind: item.activity_kind,
      status: item.status,
      total: item._count.id,
    })),
    recent_activities: recent.map((item) =>
      serializeMarketingReportActivity(req, item),
    ),
    scope: {
      can_report_all: scope.canReportAll,
      can_view_division: scope.canViewDivision,
      can_manage_all: scope.operationalCanManageAll,
    },
  };
};
