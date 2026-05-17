const repository = require("./debtors.repository");
const debtorContractsService = require("../debtor-contracts/debtorContracts.service");
const { AppError } = require("../../utils/errors");
const {
  buildDebtorVisibilityWhere,
  getDebtorAccessScope,
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
  };
}

function serializeContract(contract) {
  if (!contract) return null;
  const latestCollectibility = Array.isArray(contract.collectibilities)
    ? contract.collectibilities[0] || null
    : null;

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
    latest_collectibility: latestCollectibility
      ? {
          id: latestCollectibility.id,
          period_month: latestCollectibility.period_month,
          level: latestCollectibility.kol_level?.level,
          code: latestCollectibility.kol_level?.code,
          name: latestCollectibility.kol_level?.name,
          is_npf: latestCollectibility.kol_level?.is_npf,
          outstanding_pokok: decimalToNumber(latestCollectibility.outstanding_pokok),
          outstanding_margin: decimalToNumber(latestCollectibility.outstanding_margin),
          dpd: latestCollectibility.dpd,
          notes: latestCollectibility.notes,
        }
      : null,
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

exports.update = async ({ id, payload, userId }) => {
  await exports.getById({ id, userId });
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
  await exports.getById({ id, userId });
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

  if (payload.document_checklist_id) {
    const checklist = await repository.findDocumentChecklistById(
      payload.document_checklist_id,
    );
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
    document_type: normalizeUpper(payload.document_type),
    category: normalizeUpper(payload.category || "LAINNYA"),
    description: normalizeText(payload.description),
    ...fileMeta,
    uploaded_by: userId || null,
    created_by: userId || null,
  });

  return serializeDocument(req, document);
};
