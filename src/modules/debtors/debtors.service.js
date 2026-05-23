const repository = require("./debtors.repository");
const debtorContractsService = require("../debtor-contracts/debtorContracts.service");
const { AppError } = require("../../utils/errors");
const {
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

const SORTABLE_FIELDS = new Set(["debtor_number", "name", "status", "created_at", "updated_at"]);

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
    file: serializeLegalFile(req, item, "ideb"),
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

  return { AND: clauses.filter((item) => Object.keys(item).length > 0) };
}

function normalizeDebtorPayload(payload) {
  return {
    debtor_number: normalizeText(payload.debtor_number),
    identity_number: normalizeText(payload.identity_number),
    name: normalizeText(payload.name),
    address: normalizeText(payload.address),
    phone: normalizeText(payload.phone),
    branch_id: normalizeText(payload.branch_id),
    marketing_user_id: normalizeText(payload.marketing_user_id),
    financing_number: normalizeText(payload.financing_number),
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
  const legalWorkflow = canViewLegalWorkflow
    ? {
        prints: workflow.prints.map((item) => serializePrint(req, item)),
        warning_letters: workflow.warningLetters.map((item) => serializeWarningLetter(req, item)),
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
        warning_letters: [],
        notary_progress: [],
        insurance_progress: [],
        kjpp_progress: [],
        claims: [],
        deposits: [],
      };

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
    document_checklist_status: buildDocumentChecklistStatus(
      documentChecklists,
      documents,
    ),
    marketing: groupMarketingByKind(marketing, workflow.timelines || []),
    ideb_uploads: canViewLegalWorkflow
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
    return serializeDebtor(
      await repository.create({
        ...normalized,
        created_by: userId || null,
      }),
    );
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
    return serializeDebtor(
      await repository.update(id, {
        ...normalized,
        updated_by: userId || null,
      }),
    );
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
