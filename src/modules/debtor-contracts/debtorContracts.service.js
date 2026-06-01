const repository = require("./debtorContracts.repository");
const { AppError } = require("../../utils/errors");
const {
  buildContractManageWhere,
  buildContractVisibilityWhere,
  buildDebtorManageWhere,
  buildDebtorVisibilityWhere,
  getDebtorAccessScope,
} = require("../../utils/debtor-access");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  resolvePagination,
} = require("../../utils/pagination");

const SORTABLE_FIELDS = new Set([
  "no_kontrak",
  "tanggal_akad",
  "tanggal_jatuh_tempo",
  "status",
  "outstanding_pokok",
  "created_at",
  "updated_at",
]);

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

function serializeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    division_id: user.division_id,
  };
}

function serializeCollectibility(item) {
  if (!item) return null;
  return {
    id: item.id,
    period_month: item.period_month,
    kol_level_id: item.kol_level_id,
    level: item.kol_level?.level,
    code: item.kol_level?.code,
    name: item.kol_level?.name,
    is_npf: item.kol_level?.is_npf,
    outstanding_pokok: number(item.outstanding_pokok),
    outstanding_margin: number(item.outstanding_margin),
    dpd: item.dpd,
    notes: item.notes,
    created_at: item.created_at,
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
    project_value: item.project_value === null || item.project_value === undefined ? null : number(item.project_value),
    currency_code: item.currency_code,
    interest_rate: item.interest_rate === null || item.interest_rate === undefined ? null : number(item.interest_rate),
    interest_type_code: item.interest_type_code,
    government_program_code: item.government_program_code,
    takeover_from: item.takeover_from,
    source_of_funds_code: item.source_of_funds_code,
    initial_plafond: item.initial_plafond === null || item.initial_plafond === undefined ? null : number(item.initial_plafond),
    plafond: item.plafond === null || item.plafond === undefined ? null : number(item.plafond),
    current_month_disbursement:
      item.current_month_disbursement === null || item.current_month_disbursement === undefined
        ? null
        : number(item.current_month_disbursement),
    penalty: item.penalty === null || item.penalty === undefined ? null : number(item.penalty),
    baki_debet: item.baki_debet === null || item.baki_debet === undefined ? null : number(item.baki_debet),
    original_currency_amount:
      item.original_currency_amount === null || item.original_currency_amount === undefined
        ? null
        : number(item.original_currency_amount),
    collectibility_code: item.collectibility_code,
    default_date: item.default_date,
    default_reason_code: item.default_reason_code,
    principal_arrears:
      item.principal_arrears === null || item.principal_arrears === undefined
        ? null
        : number(item.principal_arrears),
    margin_arrears:
      item.margin_arrears === null || item.margin_arrears === undefined
        ? null
        : number(item.margin_arrears),
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
    ? contract.collectibilities.map(serializeCollectibility)
    : [];
  const slikSnapshots = Array.isArray(contract.slik_snapshots)
    ? contract.slik_snapshots.map(serializeContractSnapshot).filter(Boolean)
    : [];

  return {
    id: contract.id,
    no_kontrak: contract.no_kontrak,
    debtor_id: contract.debtor_id,
    debtor: contract.debtor
      ? {
          id: contract.debtor.id,
          debtor_number: contract.debtor.debtor_number,
          identity_number: contract.debtor.identity_number,
          name: contract.debtor.name,
          address: contract.debtor.address,
          phone: contract.debtor.phone,
          branch: contract.debtor.branch,
          marketing_user: serializeUser(contract.debtor.marketing_user),
        }
      : null,
    product_id: contract.product_id,
    akad_type_id: contract.akad_type_id,
    branch_id: contract.branch_id,
    marketing_user_id: contract.marketing_user_id,
    tanggal_akad: contract.tanggal_akad,
    tanggal_jatuh_tempo: contract.tanggal_jatuh_tempo,
    plafond: number(contract.plafond),
    pokok: number(contract.pokok),
    margin: number(contract.margin),
    tenor: contract.tenor,
    outstanding_pokok: number(contract.outstanding_pokok),
    outstanding_margin: number(contract.outstanding_margin),
    total_outstanding: number(contract.outstanding_pokok) + number(contract.outstanding_margin),
    status: contract.status,
    objek_pembiayaan: contract.objek_pembiayaan,
    agunan: contract.agunan,
    product: contract.product,
    akad_type: contract.akad_type,
    branch: contract.branch,
    marketing_user: serializeUser(contract.marketing_user),
    latest_collectibility: collectibilities[0] || null,
    collectibilities,
    latest_slik_snapshot: slikSnapshots[0] || null,
    slik_snapshots: slikSnapshots,
    created_at: contract.created_at,
    updated_at: contract.updated_at,
  };
}

function buildOrderBy(query) {
  const sortBy = normalizeText(query.sort_by || query.sortBy);
  const sortOrder =
    String(query.sort_order || query.sortOrder || "asc").toLowerCase() ===
    "desc"
      ? "desc"
      : "asc";

  if (sortBy && SORTABLE_FIELDS.has(sortBy)) return { [sortBy]: sortOrder };
  return { created_at: "desc" };
}

function buildWhere(query, scope) {
  const clauses = [{ deleted_at: null }, buildContractVisibilityWhere(scope)];
  const search = normalizeText(query.search);
  if (search) {
    clauses.push({
      OR: [
        { no_kontrak: { contains: search, mode: "insensitive" } },
        { debtor: { name: { contains: search, mode: "insensitive" } } },
        { debtor: { debtor_number: { contains: search, mode: "insensitive" } } },
        { debtor: { identity_number: { contains: search, mode: "insensitive" } } },
      ],
    });
  }

  for (const field of [
    "debtor_id",
    "product_id",
    "akad_type_id",
    "branch_id",
    "marketing_user_id",
  ]) {
    if (query[field]) clauses.push({ [field]: query[field] });
  }
  if (query.status) clauses.push({ status: normalizeUpper(query.status) });
  if (query.period_month || query.periodMonth) {
    const periodMonth = normalizeText(query.period_month || query.periodMonth);
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
  if (query.collectibility_level || query.kol_level || query.kol) {
    const rawLevel = normalizeText(
      query.collectibility_level || query.kol_level || query.kol,
    );
    const level = Number(rawLevel);
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

function normalizePayload(payload) {
  return {
    no_kontrak: normalizeText(payload.no_kontrak),
    debtor_id: normalizeText(payload.debtor_id),
    product_id: normalizeText(payload.product_id),
    akad_type_id: normalizeText(payload.akad_type_id),
    branch_id: normalizeText(payload.branch_id),
    marketing_user_id: normalizeText(payload.marketing_user_id),
    tanggal_akad: payload.tanggal_akad ? new Date(payload.tanggal_akad) : undefined,
    tanggal_jatuh_tempo: payload.tanggal_jatuh_tempo
      ? new Date(payload.tanggal_jatuh_tempo)
      : null,
    plafond: payload.plafond,
    pokok: payload.pokok,
    margin: payload.margin,
    tenor: payload.tenor,
    outstanding_pokok: payload.outstanding_pokok,
    outstanding_margin: payload.outstanding_margin,
    status: normalizeUpper(payload.status || "ACTIVE"),
    objek_pembiayaan: normalizeText(payload.objek_pembiayaan),
    agunan: normalizeText(payload.agunan),
  };
}

function compactUndefined(data) {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  );
}

async function ensureDebtorAccessible(debtorId, userId) {
  if (!debtorId) return;
  const scope = await getDebtorAccessScope(userId);
  const debtor = await repository.findDebtorByIdWithWhere(
    debtorId,
    buildDebtorManageWhere(scope),
  );
  if (!debtor) throw new AppError("Debitur tidak ditemukan atau tidak bisa diakses.", 404);
}

async function ensureReferences(payload) {
  if (payload.debtor_id && !(await repository.findDebtorById(payload.debtor_id))) {
    throw new AppError("Debitur tidak ditemukan.", 404);
  }
  if (payload.product_id && !(await repository.findProductById(payload.product_id))) {
    throw new AppError("Produk pembiayaan tidak ditemukan atau tidak aktif.", 404);
  }
  if (payload.akad_type_id && !(await repository.findContractTypeById(payload.akad_type_id))) {
    throw new AppError("Jenis akad tidak ditemukan atau tidak aktif.", 404);
  }
  if (payload.branch_id && !(await repository.findBranchById(payload.branch_id))) {
    throw new AppError("Cabang tidak ditemukan atau tidak aktif.", 404);
  }
  if (
    payload.marketing_user_id &&
    !(await repository.findActiveUserById(payload.marketing_user_id))
  ) {
    throw new AppError("Marketing/user owner tidak ditemukan atau tidak aktif.", 404);
  }
}

exports.getAll = async ({ query, userId }) => {
  const scope = await getDebtorAccessScope(userId);
  const pagination = resolvePagination(query, PAGINATION_PROFILES.TABLE);
  const where = buildWhere(query, scope);
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
    data: data.map(serializeContract),
    meta: buildPaginationMeta(total, pagination),
  };
};

exports.getById = async ({ id, userId }) => {
  const scope = await getDebtorAccessScope(userId);
  const contract = await repository.findById(id, {
    deleted_at: null,
    ...buildContractManageWhere(scope),
  });
  if (!contract) throw new AppError("Kontrak debitur tidak ditemukan.", 404);
  return serializeContract(contract);
};

exports.create = async ({ payload, userId }) => {
  const normalized = normalizePayload(payload);
  await ensureReferences(normalized);
  await ensureDebtorAccessible(normalized.debtor_id, userId);
  try {
    return serializeContract(
      await repository.create({
        ...normalized,
        created_by: userId || null,
      }),
    );
  } catch (error) {
    if (error?.code === "P2002") {
      throw new AppError("Nomor kontrak sudah digunakan.", 409);
    }
    throw error;
  }
};

function canManageContractRecord(contract, scope) {
  if (!contract || !scope?.userId) return false;
  if (scope.canManageAll) return true;

  return (
    contract.created_by === scope.userId ||
    contract.marketing_user_id === scope.userId ||
    contract.debtor?.created_by === scope.userId ||
    contract.debtor?.marketing_user_id === scope.userId
  );
}

async function getManageableContract(id, userId) {
  const scope = await getDebtorAccessScope(userId);
  const contract = await repository.findById(id, {
    deleted_at: null,
    ...buildContractVisibilityWhere(scope),
  });
  if (!contract) throw new AppError("Kontrak debitur tidak ditemukan.", 404);
  if (!canManageContractRecord(contract, scope)) {
    throw new AppError("Anda tidak memiliki izin mengelola kontrak ini.", 403);
  }
  return contract;
}

exports.update = async ({ id, payload, userId }) => {
  await getManageableContract(id, userId);
  const normalized = compactUndefined(normalizePayload(payload));
  await ensureReferences(normalized);
  await ensureDebtorAccessible(normalized.debtor_id, userId);
  try {
    return serializeContract(
      await repository.update(id, {
        ...normalized,
        updated_by: userId || null,
      }),
    );
  } catch (error) {
    if (error?.code === "P2002") {
      throw new AppError("Nomor kontrak sudah digunakan.", 409);
    }
    throw error;
  }
};

exports.delete = async ({ id, userId }) => {
  await getManageableContract(id, userId);
  await repository.update(id, {
    status: "INACTIVE",
    deleted_at: new Date(),
    deleted_by: userId || null,
  });
};
