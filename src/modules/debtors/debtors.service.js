const repository = require("./debtors.repository");
const debtorContractsService = require("../debtor-contracts/debtorContracts.service");
const { AppError } = require("../../utils/errors");
const {
  buildContractVisibilityWhere,
  buildDebtorManageWhere,
  buildDebtorVisibilityWhere,
  getDebtorAccessScope,
  LEGAL_DATA_SCOPE_URLS,
  userHasAnyMenuRead,
} = require("../../utils/debtor-access");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  resolvePagination,
} = require("../../utils/pagination");
const { persistDomainFile, serializeFile } = require("../../utils/domain-files");

const SORTABLE_FIELDS = new Set([
  "debtor_number",
  "name",
  "customer_type",
  "status",
  "created_at",
  "updated_at",
]);
const CUSTOMER_TYPE_LABELS = {
  INDIVIDUAL: "Perorangan",
  LEGAL_ENTITY: "Badan Hukum/Yayasan",
};
const CUSTOMER_TYPE_STATUS_CODES = {
  INDIVIDUAL: "I",
  LEGAL_ENTITY: "B",
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

function decimalToNumber(value) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function parseNullableDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDateField(value) {
  if (value === undefined) return undefined;
  return parseNullableDate(value);
}

function normalizeCustomerType(value) {
  const normalized = normalizeUpper(value);
  if (!normalized) return normalized;
  if (["I", "INDIVIDUAL", "PERORANGAN"].includes(normalized)) return "INDIVIDUAL";
  if (["B", "LEGAL_ENTITY", "BADAN_HUKUM", "BADAN HUKUM", "YAYASAN"].includes(normalized)) {
    return "LEGAL_ENTITY";
  }
  return normalized;
}

function customerTypeLabel(value) {
  const normalized = normalizeCustomerType(value);
  return normalized ? CUSTOMER_TYPE_LABELS[normalized] || normalized : null;
}

function serializeIndividualProfile(profile) {
  if (!profile) return null;
  return {
    ...profile,
    annual_gross_income:
      profile.annual_gross_income === null || profile.annual_gross_income === undefined
        ? null
        : decimalToNumber(profile.annual_gross_income),
  };
}

function serializeLegalEntityProfile(profile) {
  return profile || null;
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

function serializeContractSnapshot(item) {
  if (!item) return null;
  return {
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
    project_value: decimalToNumber(item.project_value),
    currency_code: item.currency_code,
    interest_rate: decimalToNumber(item.interest_rate),
    interest_type_code: item.interest_type_code,
    government_program_code: item.government_program_code,
    takeover_from: item.takeover_from,
    source_of_funds_code: item.source_of_funds_code,
    initial_plafond: decimalToNumber(item.initial_plafond),
    plafond: decimalToNumber(item.plafond),
    current_month_disbursement: decimalToNumber(item.current_month_disbursement),
    penalty: decimalToNumber(item.penalty),
    baki_debet: decimalToNumber(item.baki_debet),
    original_currency_amount: decimalToNumber(item.original_currency_amount),
    collectibility_code: item.collectibility_code,
    default_date: item.default_date,
    default_reason_code: item.default_reason_code,
    principal_arrears: decimalToNumber(item.principal_arrears),
    margin_arrears: decimalToNumber(item.margin_arrears),
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
  };
}

function serializeContract(contract) {
  if (!contract) return null;
  const collectibilities = Array.isArray(contract.collectibilities)
    ? contract.collectibilities.map((item) => ({
        id: item.id,
        period_month: item.period_month,
        kol_level_id: item.kol_level_id,
        level: item.kol_level?.level,
        code: item.kol_level?.code,
        name: item.kol_level?.name,
        is_npf: item.kol_level?.is_npf,
        outstanding_pokok: decimalToNumber(item.outstanding_pokok),
        outstanding_margin: decimalToNumber(item.outstanding_margin),
        dpd: item.dpd,
        notes: item.notes,
        created_at: item.created_at,
      }))
    : [];
  const latestCollectibility = collectibilities[0] || null;
  const slikSnapshots = Array.isArray(contract.slik_snapshots)
    ? contract.slik_snapshots.map(serializeContractSnapshot).filter(Boolean)
    : [];

  return {
    id: contract.id,
    no_kontrak: contract.no_kontrak,
    debtor_id: contract.debtor_id,
    product_id: contract.product_id,
    akad_type_id: contract.akad_type_id,
    branch_id: contract.branch_id,
    marketing_user_id: contract.marketing_user_id,
    tanggal_akad: contract.tanggal_akad,
    tanggal_jatuh_tempo: contract.tanggal_jatuh_tempo,
    plafond: decimalToNumber(contract.plafond),
    pokok: decimalToNumber(contract.pokok),
    margin: decimalToNumber(contract.margin),
    tenor: contract.tenor,
    outstanding_pokok: decimalToNumber(contract.outstanding_pokok),
    outstanding_margin: decimalToNumber(contract.outstanding_margin),
    total_outstanding:
      decimalToNumber(contract.outstanding_pokok) +
      decimalToNumber(contract.outstanding_margin),
    status: contract.status,
    objek_pembiayaan: contract.objek_pembiayaan,
    agunan: contract.agunan,
    product: contract.product,
    akad_type: contract.akad_type,
    branch: contract.branch,
    marketing_user: serializeUser(contract.marketing_user),
    latest_collectibility: latestCollectibility,
    collectibilities,
    latest_slik_snapshot: slikSnapshots[0] || null,
    slik_snapshots: slikSnapshots,
    created_at: contract.created_at,
    updated_at: contract.updated_at,
  };
}

function serializeDebtor(debtor) {
  if (!debtor) return null;
  const contracts = Array.isArray(debtor.contracts)
    ? debtor.contracts.map(serializeContract)
    : [];
  const latestContract = contracts[0] || null;

  return {
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
    individual_profile: serializeIndividualProfile(debtor.individual_profile),
    legal_entity_profile: serializeLegalEntityProfile(debtor.legal_entity_profile),
    status: debtor.status,
    description: debtor.description,
    branch: debtor.branch || null,
    marketing_user: serializeUser(debtor.marketing_user),
    latest_contract: latestContract,
    contracts,
    contracts_count: contracts.length,
    documents_count: Array.isArray(debtor.debtor_documents)
      ? debtor.debtor_documents.length
      : Array.isArray(debtor.documents)
        ? debtor.documents.length
        : 0,
    created_at: debtor.created_at,
    updated_at: debtor.updated_at,
  };
}

function serializeDocument(req, document) {
  return {
    id: document.id,
    debtor_id: document.debtor_id,
    contract_id: document.contract_id,
    document_checklist_id: document.document_checklist_id,
    document_type: document.document_type,
    category: document.category,
    description: document.description,
    file: serializeFile(req, document, {
      module: "debtor_information",
      entityId: document.id,
      fallbackBaseName: document.document_type,
    }),
    document_checklist: document.document_checklist || null,
    debtor: document.debtor ? serializeDebtor(document.debtor) : null,
    contract: document.contract || null,
    uploaded_by: document.uploaded_by,
    created_at: document.created_at,
    updated_at: document.updated_at,
  };
}

function serializeMarketingActivity(req, item) {
  return {
    id: item.id,
    activity_kind: item.activity_kind,
    debtor_id: item.debtor_id,
    contract_id: item.contract_id,
    timeline_id: item.timeline_id,
    timeline_group_id: item.timeline_group_id,
    related_activity_id: item.related_activity_id,
    activity_date: item.activity_date,
    target_date: item.target_date,
    status: item.status,
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
    contract: item.contract || null,
    timeline: item.timeline || null,
    related_activity: item.related_activity || null,
    created_by: item.created_by,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

function serializeMarketingTimeline(timeline) {
  if (!timeline) return null;
  return {
    id: timeline.id,
    group_key: timeline.group_key,
    debtor_id: timeline.debtor_id,
    contract_id: timeline.contract_id,
    title: timeline.title,
    status: timeline.status,
    started_at: timeline.started_at,
    completed_at: timeline.completed_at,
    contract: timeline.contract || null,
    created_at: timeline.created_at,
    updated_at: timeline.updated_at,
  };
}

function normalizeDateKey(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function readSummaryValue(source, keys) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function activityRowId(kind) {
  if (kind === "ACTION_PLAN") return "action-plan";
  if (kind === "VISIT_RESULT") return "hasil-kunjungan";
  if (kind === "HANDLING_STEP") return "langkah-penanganan";
  return "aktivitas";
}

function activityTitle(item) {
  if (item.activity_kind === "ACTION_PLAN") return item.action_plan || item.notes || "-";
  if (item.activity_kind === "VISIT_RESULT") return item.visit_result || item.conclusion || item.notes || "-";
  if (item.activity_kind === "HANDLING_STEP") return item.handling_step || item.handling_result || item.notes || "-";
  return item.notes || "-";
}

function activityDetail(item) {
  if (item.activity_kind === "ACTION_PLAN") return item.notes || item.action_plan || "-";
  if (item.activity_kind === "VISIT_RESULT") return item.conclusion || item.notes || item.visit_result || "-";
  if (item.activity_kind === "HANDLING_STEP") return item.handling_result || item.notes || item.handling_step || "-";
  return item.notes || "-";
}

function buildMarketingTimeline(items, timelines = []) {
  const rows = [
    {
      id: "action-plan",
      label: "Action Plan",
      description: "Rencana tindak lanjut",
    },
    {
      id: "hasil-kunjungan",
      label: "Hasil Kunjungan",
      description: "Ringkasan hasil lapangan",
    },
    {
      id: "langkah-penanganan",
      label: "Langkah Penanganan",
      description: "Eksekusi penanganan",
    },
  ];
  const timelineMap = new Map();
  for (const timeline of timelines) {
    const serializedTimeline = serializeMarketingTimeline(timeline);
    if (serializedTimeline) timelineMap.set(serializedTimeline.id, serializedTimeline);
  }

  const entries = items
    .map((item) => {
      const date = normalizeDateKey(item.activity_date || item.target_date || item.created_at);
      const serializedTimeline = serializeMarketingTimeline(item.timeline);
      if (serializedTimeline && !timelineMap.has(serializedTimeline.id)) {
        timelineMap.set(serializedTimeline.id, serializedTimeline);
      }
      return {
        id: item.id,
        row_id: activityRowId(item.activity_kind),
        activity_kind: item.activity_kind,
        timeline_id: item.timeline_id,
        date,
        title: activityTitle(item),
        summary: activityTitle(item),
        detail: activityDetail(item),
        status: item.status,
        target_date: item.target_date,
        timeline_group_id: item.timeline_group_id,
        related_activity_id: item.related_activity_id,
        related_activity: item.related_activity || null,
        created_by: item.created_by,
        visit_address: item.visit_address,
        file: item.file,
        contract: item.contract || null,
        timeline: serializedTimeline,
      };
    })
    .filter((item) => item.date);
  const dates = Array.from(new Set(entries.map((item) => item.date))).sort();

  return { rows, dates, entries, timelines: Array.from(timelineMap.values()) };
}

function buildDocumentChecklistStatus(checklists, documents) {
  return checklists.map((checklist) => {
    const document =
      documents.find((item) => item.document_checklist_id === checklist.id) || null;
    return {
      id: checklist.id,
      code: checklist.code,
      name: checklist.name,
      category: checklist.category,
      document_type: checklist.document_type,
      description: checklist.description,
      is_required: checklist.is_required,
      status: document ? "ADA" : "BELUM_ADA",
      document: document || null,
    };
  });
}

function serializeLegalFile(req, item, fallbackBaseName) {
  return serializeFile(req, item, {
    module: "legal_management",
    entityId: item.id,
    fallbackBaseName,
  });
}

function serializeDebtorFile(req, item, fallbackBaseName) {
  return serializeFile(req, item, {
    module: "debtor_information",
    entityId: item.id,
    fallbackBaseName,
  });
}

function serializeGeneratedLegalFile(req, item, fallbackBaseName) {
  return serializeFile(req, item, {
    module: "legal_management",
    entityId: item.id,
    prefix: "generated_",
    fallbackBaseName,
  });
}

function buildIdebSummaryDetail(item, debtor, contracts) {
  const resultSummary =
    item.result_summary && typeof item.result_summary === "object" && !Array.isArray(item.result_summary)
      ? item.result_summary
      : {};
  const contract =
    contracts.find((candidate) => candidate.id === item.contract_id) ||
    contracts.find((candidate) => candidate.id === item.contract?.id) ||
    contracts[0] ||
    null;
  const collectibility = contract?.latest_collectibility || null;
  const otherBprsRaw =
    readSummaryValue(resultSummary, [
      "other_bprs",
      "bprs_lain",
      "riwayat_bprs",
      "riwayat_kolektibilitas",
      "facilities",
    ]) || [];
  const otherBprs = Array.isArray(otherBprsRaw)
    ? otherBprsRaw
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({
          name: String(
            readSummaryValue(entry, ["name", "nama", "nama_bprs", "institution", "bank"]) || "-",
          ),
          collectibility:
            readSummaryValue(entry, [
              "collectibility",
              "kolektibilitas",
              "kol",
              "level",
            ]) || null,
          outstanding_pokok: decimalToNumber(
            readSummaryValue(entry, ["outstanding_pokok", "os_pokok", "outstanding"]),
          ),
        }))
    : [];

  return {
    debtor_name:
      readSummaryValue(resultSummary, ["debtor_name", "nama_nasabah", "name"]) ||
      item.debtor?.name ||
      debtor.name,
    identity_number:
      readSummaryValue(resultSummary, ["identity_number", "no_identitas", "ktp"]) ||
      item.debtor?.identity_number ||
      debtor.identity_number,
    contract_number:
      readSummaryValue(resultSummary, ["contract_number", "no_kontrak"]) ||
      item.contract?.no_kontrak ||
      contract?.no_kontrak ||
      null,
    current_collectibility:
      readSummaryValue(resultSummary, [
        "current_collectibility",
        "kolektibilitas_berjalan",
        "kol",
      ]) ||
      collectibility?.code ||
      collectibility?.name ||
      null,
    outstanding_pokok: decimalToNumber(
      readSummaryValue(resultSummary, ["outstanding_pokok", "os_pokok"]) ??
        contract?.outstanding_pokok,
    ),
    financing_status:
      readSummaryValue(resultSummary, ["financing_status", "status_pembiayaan"]) ||
      contract?.status ||
      null,
    conclusion:
      readSummaryValue(resultSummary, ["conclusion", "kesimpulan", "summary"]) || null,
    processed_at:
      readSummaryValue(resultSummary, ["processed_at", "tanggal_proses"]) ||
      item.updated_at ||
      item.created_at,
    other_bprs: otherBprs,
  };
}

function serializeIdeb(req, item, debtor, contracts) {
  return {
    ...item,
    summary_detail: buildIdebSummaryDetail(item, debtor, contracts),
    file: serializeDebtorFile(req, item, "ideb"),
  };
}

function serializeRestructuring(item) {
  return {
    ...item,
    plafond_after:
      item.plafond_after === null || item.plafond_after === undefined
        ? null
        : decimalToNumber(item.plafond_after),
    outstanding_after:
      item.outstanding_after === null || item.outstanding_after === undefined
        ? null
        : decimalToNumber(item.outstanding_after),
  };
}

function serializePrint(req, item) {
  return {
    ...item,
    generated_file: serializeGeneratedLegalFile(req, item, item.document_type),
  };
}

function serializeProgress(req, item, fallbackBaseName) {
  const serialized = {
    ...item,
    file: serializeLegalFile(req, item, fallbackBaseName),
  };

  if ("coverage_amount" in serialized) {
    serialized.coverage_amount = decimalToNumber(serialized.coverage_amount);
  }
  if ("appraisal_value" in serialized) {
    serialized.appraisal_value =
      serialized.appraisal_value === null
        ? null
        : decimalToNumber(serialized.appraisal_value);
  }

  return serialized;
}

function serializeWarningLetter(req, item) {
  return {
    ...item,
    file: serializeDebtorFile(req, item, item.letter_type),
  };
}

function serializeClaim(req, item) {
  return {
    ...item,
    claim_amount: decimalToNumber(item.claim_amount),
    approved_amount:
      item.approved_amount === null ? null : decimalToNumber(item.approved_amount),
    disbursed_amount:
      item.disbursed_amount === null ? null : decimalToNumber(item.disbursed_amount),
    file: serializeLegalFile(req, item, item.claim_type),
  };
}

function serializeDeposit(item) {
  return {
    ...item,
    nominal: decimalToNumber(item.nominal),
    paid_amount: decimalToNumber(item.paid_amount),
    processed_amount: decimalToNumber(item.processed_amount),
    remaining_amount: decimalToNumber(item.remaining_amount),
    transactions: Array.isArray(item.transactions)
      ? item.transactions.map((transaction) => ({
          ...transaction,
          amount: decimalToNumber(transaction.amount),
        }))
      : [],
  };
}

function serializeCollateral(item) {
  if (!item) return null;
  return {
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
    market_value:
      item.market_value === null || item.market_value === undefined
        ? null
        : decimalToNumber(item.market_value),
    appraisal_value:
      item.appraisal_value === null || item.appraisal_value === undefined
        ? null
        : decimalToNumber(item.appraisal_value),
    reporter_appraisal_date: item.reporter_appraisal_date,
    independent_appraisal_value:
      item.independent_appraisal_value === null ||
      item.independent_appraisal_value === undefined
        ? null
        : decimalToNumber(item.independent_appraisal_value),
    independent_appraiser_name: item.independent_appraiser_name,
    independent_appraisal_date: item.independent_appraisal_date,
    paripasu_status: item.paripasu_status,
    paripasu_percentage:
      item.paripasu_percentage === null || item.paripasu_percentage === undefined
        ? null
        : decimalToNumber(item.paripasu_percentage),
    joint_credit_status: item.joint_credit_status,
    insured_status: item.insured_status,
    description: item.description,
    branch_code: item.branch_code,
    operation_code: item.operation_code,
    period_month: item.period_month,
    last_import_period_month: item.last_import_period_month,
    debtor: item.debtor ? serializeDebtor(item.debtor) : null,
    contract: item.contract || null,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

function groupMarketingByKind(items, timelines = []) {
  const grouped = {
    action_plans: [],
    visit_results: [],
    handling_steps: [],
    timeline: buildMarketingTimeline(items, timelines),
  };

  for (const item of items) {
    if (item.activity_kind === "ACTION_PLAN") grouped.action_plans.push(item);
    if (item.activity_kind === "VISIT_RESULT") grouped.visit_results.push(item);
    if (item.activity_kind === "HANDLING_STEP") grouped.handling_steps.push(item);
  }

  return grouped;
}

function buildOrderBy(query) {
  const sortBy = normalizeText(query.sort_by || query.sortBy);
  const sortOrder =
    String(query.sort_order || query.sortOrder || "asc").toLowerCase() ===
    "desc"
      ? "desc"
      : "asc";

  if (sortBy && SORTABLE_FIELDS.has(sortBy)) {
    return { [sortBy]: sortOrder };
  }

  return { created_at: "desc" };
}

function buildDebtorWhere(query, scope) {
  const clauses = [{ deleted_at: null }, buildDebtorVisibilityWhere(scope)];
  const search = normalizeText(query.search);

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

  if (query.branch_id) clauses.push({ branch_id: query.branch_id });
  if (query.marketing_user_id) {
    clauses.push({ marketing_user_id: query.marketing_user_id });
  }
  if (query.status) clauses.push({ status: normalizeUpper(query.status) });
  if (query.customer_type) {
    clauses.push({ customer_type: normalizeCustomerType(query.customer_type) });
  }

  return { AND: clauses.filter((item) => Object.keys(item).length > 0) };
}

function buildCollateralOrderBy(query) {
  const sortBy = normalizeText(query.sort_by || query.sortBy);
  const sortOrder =
    String(query.sort_order || query.sortOrder || "asc").toLowerCase() ===
    "desc"
      ? "desc"
      : "asc";
  const sortable = new Set([
    "collateral_number",
    "facility_number",
    "collateral_type",
    "owner_name",
    "market_value",
    "appraisal_value",
    "created_at",
    "updated_at",
  ]);

  if (sortBy && sortable.has(sortBy)) return { [sortBy]: sortOrder };
  return { created_at: "desc" };
}

function buildCollateralVisibilityWhere(scope) {
  if (scope?.canManageAll) return {};
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

function buildCollateralWhere(query, scope) {
  const clauses = [{ deleted_at: null }, buildCollateralVisibilityWhere(scope)];
  const search = normalizeText(query.search);

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

  if (query.collateral_type) {
    clauses.push({
      collateral_type: { contains: normalizeText(query.collateral_type), mode: "insensitive" },
    });
  }
  if (query.link_status === "linked") {
    clauses.push({
      OR: [{ debtor_id: { not: null } }, { contract_id: { not: null } }],
    });
  }
  if (query.link_status === "unlinked") {
    clauses.push({ debtor_id: null, contract_id: null });
  }

  return { AND: clauses.filter((item) => Object.keys(item).length > 0) };
}

function normalizeIndividualProfilePayload(payload = {}, userId = null) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  return compactUndefined({
    identity_type_code: normalizeText(payload.identity_type_code),
    name_as_identity: normalizeText(payload.name_as_identity),
    full_name: normalizeText(payload.full_name),
    education_degree_code: normalizeText(payload.education_degree_code),
    gender: normalizeText(payload.gender),
    birth_place: normalizeText(payload.birth_place),
    birth_date: normalizeDateField(payload.birth_date),
    tax_number: normalizeText(payload.tax_number),
    address_detail: normalizeText(payload.address_detail),
    village: normalizeText(payload.village),
    district: normalizeText(payload.district),
    city_code: normalizeText(payload.city_code),
    postal_code: normalizeText(payload.postal_code),
    phone: normalizeText(payload.phone),
    mobile_phone: normalizeText(payload.mobile_phone),
    email: normalizeText(payload.email),
    domicile_country_code: normalizeText(payload.domicile_country_code),
    occupation_code: normalizeText(payload.occupation_code),
    workplace: normalizeText(payload.workplace),
    workplace_business_field_code: normalizeText(payload.workplace_business_field_code),
    workplace_address: normalizeText(payload.workplace_address),
    annual_gross_income:
      payload.annual_gross_income === undefined || payload.annual_gross_income === ""
        ? undefined
        : Number(payload.annual_gross_income || 0),
    income_source_code: normalizeText(payload.income_source_code),
    dependent_count:
      payload.dependent_count === undefined || payload.dependent_count === ""
        ? undefined
        : Number(payload.dependent_count || 0),
    relationship_with_reporter_code: normalizeText(payload.relationship_with_reporter_code),
    debtor_group_code: normalizeText(payload.debtor_group_code),
    marital_status_code: normalizeText(payload.marital_status_code),
    spouse_identity_number: normalizeText(payload.spouse_identity_number),
    spouse_name: normalizeText(payload.spouse_name),
    spouse_birth_date: normalizeDateField(payload.spouse_birth_date),
    separate_assets_agreement: normalizeText(payload.separate_assets_agreement),
    violates_bmpk: normalizeText(payload.violates_bmpk),
    exceeds_bmpk: normalizeText(payload.exceeds_bmpk),
    mother_maiden_name: normalizeText(payload.mother_maiden_name),
    branch_code: normalizeText(payload.branch_code),
    operation_code: normalizeUpper(payload.operation_code),
    status_code: normalizeUpper(payload.status_code),
  });
}

function normalizeLegalEntityProfilePayload(payload = {}, userId = null) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  return compactUndefined({
    business_identity_number: normalizeText(payload.business_identity_number),
    business_name: normalizeText(payload.business_name),
    legal_form_code: normalizeText(payload.legal_form_code),
    establishment_place: normalizeText(payload.establishment_place),
    establishment_deed_number: normalizeText(payload.establishment_deed_number),
    establishment_deed_date: normalizeDateField(payload.establishment_deed_date),
    latest_amendment_deed_number: normalizeText(payload.latest_amendment_deed_number),
    latest_amendment_deed_date: normalizeDateField(payload.latest_amendment_deed_date),
    phone: normalizeText(payload.phone),
    mobile_phone: normalizeText(payload.mobile_phone),
    email: normalizeText(payload.email),
    address_detail: normalizeText(payload.address_detail),
    village: normalizeText(payload.village),
    district: normalizeText(payload.district),
    city_code: normalizeText(payload.city_code),
    postal_code: normalizeText(payload.postal_code),
    domicile_country_code: normalizeText(payload.domicile_country_code),
    business_field_code: normalizeText(payload.business_field_code),
    relationship_with_reporter_code: normalizeText(payload.relationship_with_reporter_code),
    violates_bmpk: normalizeText(payload.violates_bmpk),
    exceeds_bmpk: normalizeText(payload.exceeds_bmpk),
    go_public: normalizeText(payload.go_public),
    debtor_group_code: normalizeText(payload.debtor_group_code),
    rating: normalizeText(payload.rating),
    rating_agency: normalizeText(payload.rating_agency),
    rating_date: normalizeDateField(payload.rating_date),
    debtor_group_name: normalizeText(payload.debtor_group_name),
    branch_code: normalizeText(payload.branch_code),
    operation_code: normalizeUpper(payload.operation_code),
    status_code: normalizeUpper(payload.status_code),
  });
}

function normalizeDebtorPayload(payload) {
  const customerType = normalizeCustomerType(payload.customer_type);
  const explicitSlikStatusCode = normalizeUpper(payload.slik_status_code);
  const inferredSlikStatusCode = customerType
    ? CUSTOMER_TYPE_STATUS_CODES[customerType]
    : undefined;
  if (
    customerType &&
    explicitSlikStatusCode &&
    explicitSlikStatusCode !== inferredSlikStatusCode
  ) {
    throw new AppError(
      `Status CIF ${explicitSlikStatusCode} tidak sesuai jenis CIF ${customerTypeLabel(customerType)}.`,
      422,
    );
  }

  return {
    debtor_number: normalizeText(payload.debtor_number),
    identity_number: normalizeText(payload.identity_number),
    name: normalizeText(payload.name),
    address: normalizeText(payload.address),
    phone: normalizeText(payload.phone),
    branch_id: normalizeText(payload.branch_id),
    marketing_user_id: normalizeText(payload.marketing_user_id),
    financing_number: normalizeText(payload.financing_number),
    customer_type: customerType,
    slik_segment: normalizeUpper(payload.slik_segment),
    slik_status_code: explicitSlikStatusCode || inferredSlikStatusCode,
    slik_operation_code: normalizeUpper(payload.slik_operation_code),
    status: normalizeUpper(payload.status || "ACTIVE"),
    description: normalizeText(payload.description),
  };
}

function compactUndefined(data) {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  );
}

async function ensureDebtorReferences(payload) {
  if (payload.branch_id) {
    const branch = await repository.findBranchById(payload.branch_id);
    if (!branch) throw new AppError("Cabang tidak ditemukan atau tidak aktif.", 404);
  }

  if (payload.marketing_user_id) {
    const user = await repository.findActiveUserById(payload.marketing_user_id);
    if (!user) throw new AppError("Marketing/user owner tidak ditemukan atau tidak aktif.", 404);
  }
}

async function syncDebtorProfiles(tx, debtorId, payload, normalized, userId) {
  const customerType = normalizeCustomerType(normalized.customer_type);
  if (customerType === "INDIVIDUAL" && payload.individual_profile) {
    const profile = normalizeIndividualProfilePayload(payload.individual_profile, userId);
    if (!profile.status_code) profile.status_code = "I";
    if (Object.keys(profile).length > 0) {
      await repository.upsertIndividualProfile(debtorId, {
        ...profile,
        created_by: userId || null,
        updated_by: userId || null,
      }, tx);
    }
  }

  if (customerType === "LEGAL_ENTITY" && payload.legal_entity_profile) {
    const profile = normalizeLegalEntityProfilePayload(payload.legal_entity_profile, userId);
    if (!profile.status_code) profile.status_code = "B";
    if (Object.keys(profile).length > 0) {
      await repository.upsertLegalEntityProfile(debtorId, {
        ...profile,
        created_by: userId || null,
        updated_by: userId || null,
      }, tx);
    }
  }
}

exports.getAll = async ({ query, userId }) => {
  const scope = await getDebtorAccessScope(userId);
  const pagination = resolvePagination(query, PAGINATION_PROFILES.TABLE);
  const where = buildDebtorWhere(query, scope);
  const [data, total] = await Promise.all([
    repository.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: buildOrderBy(query),
    }),
    repository.count(where),
  ]);

  return {
    data: data.map(serializeDebtor),
    meta: buildPaginationMeta(total, pagination),
  };
};

exports.getCollaterals = async ({ query, userId }) => {
  const scope = await getDebtorAccessScope(userId);
  const pagination = resolvePagination(query, PAGINATION_PROFILES.TABLE);
  const where = buildCollateralWhere(query, scope);
  const [data, total] = await Promise.all([
    repository.findCollaterals({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: buildCollateralOrderBy(query),
    }),
    repository.countCollaterals(where),
  ]);

  return {
    data: data.map(serializeCollateral).filter(Boolean),
    meta: buildPaginationMeta(total, pagination),
  };
};

exports.getById = async ({ id, userId }) => {
  const scope = await getDebtorAccessScope(userId);
  const debtor = await repository.findById(id, {
    deleted_at: null,
    ...buildDebtorVisibilityWhere(scope),
  });
  if (!debtor) throw new AppError("Debitur tidak ditemukan.", 404);
  return serializeDebtor(debtor);
};

exports.getWorkflow = async ({ req, id, userId }) => {
  const scope = await getDebtorAccessScope(userId);
  const debtor = await repository.findById(id, {
    deleted_at: null,
    ...buildDebtorVisibilityWhere(scope),
  });
  if (!debtor) throw new AppError("Debitur tidak ditemukan.", 404);

  const serializedDebtor = serializeDebtor(debtor);
  const contractIds = serializedDebtor.contracts.map((contract) => contract.id);
  const [workflow, documentChecklists] = await Promise.all([
    repository.findWorkflowData(id, contractIds),
    repository.findActiveDocumentChecklists(),
  ]);
  const marketing = workflow.marketing.map((item) => serializeMarketingActivity(req, item));
  const documents = Array.isArray(debtor.debtor_documents)
    ? debtor.debtor_documents.map((item) => serializeDocument(req, item))
    : [];
  const canViewLegalWorkflow = await userHasAnyMenuRead(userId, LEGAL_DATA_SCOPE_URLS);
  const canViewIdebWorkflow = await userHasAnyMenuRead(userId, [
    "/dashboard/informasi-debitur/admin/upload-ideb",
    ...LEGAL_DATA_SCOPE_URLS,
  ]);
  const canViewWarningLetters = await userHasAnyMenuRead(userId, [
    "/dashboard/informasi-debitur",
    "/dashboard/informasi-debitur/master-debitur",
    "/dashboard/legal/cetak/surat-peringatan",
  ]);
  const legalWorkflow = canViewLegalWorkflow
    ? {
        prints: workflow.prints.map((item) => serializePrint(req, item)),
        notary_progress: workflow.notaryProgress.map((item) =>
          serializeProgress(req, item, item.deed_type),
        ),
        insurance_progress: workflow.insuranceProgress.map((item) =>
          serializeProgress(req, item, item.insurance_type),
        ),
        kjpp_progress: workflow.kjppProgress.map((item) =>
          serializeProgress(req, item, item.appraisal_type),
        ),
        claims: workflow.claims.map((item) => serializeClaim(req, item)),
        deposits: workflow.deposits.map((item) => serializeDeposit(item)),
      }
    : {
        prints: [],
        notary_progress: [],
        insurance_progress: [],
        kjpp_progress: [],
        claims: [],
        deposits: [],
      };
  legalWorkflow.warning_letters = canViewWarningLetters
    ? workflow.warningLetters.map((item) => serializeWarningLetter(req, item))
    : [];

  return {
    debtor: serializedDebtor,
    contracts: serializedDebtor.contracts,
    collectibilities: serializedDebtor.contracts.flatMap((contract) =>
      contract.collectibilities.map((item) => ({
        ...item,
        contract_id: contract.id,
        contract_number: contract.no_kontrak,
      })),
    ),
    documents,
    collaterals: Array.isArray(workflow.collaterals)
      ? workflow.collaterals.map(serializeCollateral).filter(Boolean)
      : [],
    restructuring_records: Array.isArray(workflow.restructuringRecords)
      ? workflow.restructuringRecords.map(serializeRestructuring)
      : [],
    document_checklist_status: buildDocumentChecklistStatus(
      documentChecklists,
      documents,
    ),
    marketing: groupMarketingByKind(marketing, workflow.timelines || []),
    ideb_uploads: canViewIdebWorkflow
      ? workflow.ideb.map((item) =>
          serializeIdeb(req, item, serializedDebtor, serializedDebtor.contracts),
        )
      : [],
    legal: legalWorkflow,
  };
};

exports.create = async ({ payload, userId }) => {
  const normalized = normalizeDebtorPayload(payload);
  await ensureDebtorReferences(normalized);

  try {
    const created = await repository.transaction(async (tx) => {
      const debtor = await repository.create({
        ...normalized,
        created_by: userId || null,
      }, tx);
      await syncDebtorProfiles(tx, debtor.id, payload, normalized, userId);
      return repository.findById(debtor.id, {}, tx);
    });
    return serializeDebtor(created);
  } catch (error) {
    if (error?.code === "P2002") {
      throw new AppError("Nomor debitur atau nomor identitas sudah digunakan.", 409);
    }
    throw error;
  }
};

function canManageDebtorRecord(debtor, scope) {
  if (!debtor || !scope?.userId) return false;
  if (scope.canManageAll) return true;

  return debtor.created_by === scope.userId || debtor.marketing_user_id === scope.userId;
}

async function getManageableDebtor(id, userId) {
  const scope = await getDebtorAccessScope(userId);
  const debtor = await repository.findById(id, {
    deleted_at: null,
    ...buildDebtorManageWhere(scope),
  });
  if (!debtor) throw new AppError("Debitur tidak ditemukan.", 404);
  if (!canManageDebtorRecord(debtor, scope)) {
    throw new AppError("Anda tidak memiliki izin mengelola debitur ini.", 403);
  }
  return debtor;
}

exports.update = async ({ id, payload, userId }) => {
  await getManageableDebtor(id, userId);
  const normalized = compactUndefined(normalizeDebtorPayload(payload));
  await ensureDebtorReferences(normalized);

  try {
    const updated = await repository.transaction(async (tx) => {
      await repository.update(id, {
        ...normalized,
        updated_by: userId || null,
      }, tx);
      await syncDebtorProfiles(tx, id, payload, normalized, userId);
      return repository.findById(id, {}, tx);
    });
    return serializeDebtor(updated);
  } catch (error) {
    if (error?.code === "P2002") {
      throw new AppError("Nomor debitur atau nomor identitas sudah digunakan.", 409);
    }
    throw error;
  }
};

exports.delete = async ({ id, userId }) => {
  await getManageableDebtor(id, userId);
  await repository.update(id, {
    status: "INACTIVE",
    deleted_at: new Date(),
    deleted_by: userId || null,
  });
};

exports.getContracts = async ({ debtorId, query, userId }) => {
  await exports.getById({ id: debtorId, userId });
  return debtorContractsService.getAll({
    query: {
      ...query,
      debtor_id: debtorId,
    },
    userId,
  });
};

exports.createContract = async ({ debtorId, payload, userId }) => {
  await exports.getById({ id: debtorId, userId });
  return debtorContractsService.create({
    payload: {
      ...payload,
      debtor_id: debtorId,
    },
    userId,
  });
};

exports.getDocuments = async ({ req, debtorId, query, userId }) => {
  await exports.getById({ id: debtorId, userId });
  const pagination = resolvePagination(query, PAGINATION_PROFILES.TABLE);
  const where = {};
  if (query.contract_id) where.contract_id = query.contract_id;
  if (query.category) where.category = normalizeUpper(query.category);
  if (query.document_type) where.document_type = normalizeUpper(query.document_type);
  const search = normalizeText(query.search);
  if (search) {
    where.OR = [
      { document_type: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { file_name: { contains: search, mode: "insensitive" } },
    ];
  }

  const [data, total] = await Promise.all([
    repository.findDocumentsByDebtorId(debtorId, {
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: buildOrderBy(query),
    }),
    repository.countDocumentsByDebtorId(debtorId, where),
  ]);

  return {
    data: data.map((item) => serializeDocument(req, item)),
    meta: buildPaginationMeta(total, pagination),
  };
};

exports.createDocument = async ({ req, debtorId, payload, userId }) => {
  await exports.getById({ id: debtorId, userId });

  if (payload.contract_id) {
    const contract = await repository.findContractById(payload.contract_id);
    if (!contract || contract.debtor_id !== debtorId) {
      throw new AppError("Kontrak debitur tidak ditemukan.", 404);
    }
  }

  let checklist = null;
  if (payload.document_checklist_id) {
    checklist = await repository.findDocumentChecklistById(payload.document_checklist_id);
    if (!checklist) {
      throw new AppError("Checklist dokumen tidak ditemukan atau tidak aktif.", 404);
    }
  }

  const fileMeta = persistDomainFile({
    entity: "debtor-documents",
    input: payload.file,
    fallbackBaseName: payload.document_type,
  });
  if (!fileMeta) throw new AppError("File dokumen wajib diunggah.", 422);

  const document = await repository.createDocument({
    debtor_id: debtorId,
    contract_id: normalizeText(payload.contract_id),
    document_checklist_id: normalizeText(payload.document_checklist_id),
    document_type: normalizeUpper(checklist?.document_type || payload.document_type),
    category: normalizeUpper(checklist?.category || payload.category || "LAINNYA"),
    description: normalizeText(payload.description),
    ...fileMeta,
    uploaded_by: userId || null,
    created_by: userId || null,
  });

  return serializeDocument(req, document);
};
