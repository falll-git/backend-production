const repository = require("./legal.repository");
const { AppError } = require("../../utils/errors");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  resolvePagination,
} = require("../../utils/pagination");
const { persistDomainFile, serializeFile } = require("../../utils/domain-files");
const {
  LEGAL_DATA_SCOPE_URLS,
  buildContractVisibilityWhere,
  buildDebtorVisibilityWhere,
  getDebtorAccessScope,
} = require("../../utils/debtor-access");

const LEGAL_TYPES = new Set([
  "AKAD",
  "HAFTSHEET",
  "SURAT_PERINGATAN",
  "FORMULIR_ASURANSI",
  "SKL",
  "SAMSAT",
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

function serializeDeposit(item) {
  return {
    ...item,
    nominal: number(item.nominal),
    paid_amount: number(item.paid_amount),
    processed_amount: number(item.processed_amount),
    remaining_amount: number(item.remaining_amount),
  };
}

function serializeClaim(req, item) {
  return {
    ...serializeWithFile(req, item, item.claim_type),
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

async function buildContractAccessWhere(userId) {
  const scope = await getLegalAccessScope(userId);
  const contractWhere = buildContractVisibilityWhere(scope);
  return isEmptyObject(contractWhere)
    ? {}
    : {
        contract: {
          is: contractWhere,
        },
      };
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

async function buildIdebAccessWhere(userId) {
  const scope = await getLegalAccessScope(userId);
  if (scope.canViewAll || scope.canManageAll) return {};

  return {
    OR: [
      { uploaded_by: scope.userId || "__no_user_access__" },
      { created_by: scope.userId || "__no_user_access__" },
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

async function ensureContract(contractId, userId, tx) {
  const scope = await getLegalAccessScope(userId);
  const contract = await repository.findContractById(
    contractId,
    tx,
    buildContractVisibilityWhere(scope),
  );
  if (!contract) throw new AppError("Kontrak tidak ditemukan atau tidak bisa diakses.", 404);
  return contract;
}

async function ensureDebtor(debtorId, userId, tx) {
  if (!debtorId) return null;
  const scope = await getLegalAccessScope(userId);
  const debtor = await repository.findDebtorById(
    debtorId,
    tx,
    buildDebtorVisibilityWhere(scope),
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

function calculateRemaining(payload) {
  const nominal = number(payload.nominal);
  const paid = number(payload.paid_amount);
  const processed = number(payload.processed_amount);
  if (payload.remaining_amount !== undefined && payload.remaining_amount !== null) {
    return payload.remaining_amount;
  }
  return Math.max(nominal - paid - processed, 0);
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
    ? await repository.findNumberingTemplateById(numberingTemplateId, tx)
    : await repository.findActiveNumberingTemplate(documentType, tx);
  if (!template || !template.is_active) {
    throw new AppError("Template penomoran aktif untuk dokumen legal tidak ditemukan.", 422);
  }
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

exports.createPrint = async ({ req, payload, userId }) => {
  const documentType = normalizeUpper(payload.document_type);
  await ensureContract(payload.contract_id, userId);
  if (payload.template_id && !(await repository.findTemplateById(payload.template_id))) {
    throw new AppError("Template legal tidak ditemukan.", 404);
  }
  const fileMeta = payload.file
    ? persistDomainFile({
        entity: "legal/generated",
        input: payload.file,
        fallbackBaseName: documentType,
      })
    : null;

  const print = await repository.transaction(async (tx) => {
    const generated = payload.generated_number
      ? {
          numberingTemplate: payload.numbering_template_id
            ? await repository.findNumberingTemplateById(payload.numbering_template_id, tx)
            : null,
          generatedNumber: normalizeText(payload.generated_number),
        }
      : await generateDocumentNumber(documentType, payload.numbering_template_id, tx);

    return repository.create(
      "legal_print_histories",
      {
        template_id: normalizeText(payload.template_id),
        numbering_template_id: generated.numberingTemplate?.id || null,
        contract_id: payload.contract_id,
        document_type: documentType,
        generated_number: generated.generatedNumber,
        payload_snapshot: payload.payload_snapshot || undefined,
        ...(fileMeta
          ? {
              generated_file_path: fileMeta.file_path,
              generated_file_name: fileMeta.file_name,
              generated_mime_type: fileMeta.mime_type,
              generated_size_bytes: fileMeta.size_bytes,
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

exports.listIdeb = async ({ req, query, userId }) =>
  listModel({
    req,
    modelName: "legal_ideb_uploads",
    query,
    searchFields: ["status", "file_name"],
    extraWhere: await buildIdebAccessWhere(userId),
    serializer: (request, item) => serializeWithFile(request, item, "ideb"),
  });

exports.createIdeb = async ({ req, payload, userId }) => {
  const debtor = payload.debtor_id
    ? await ensureDebtor(payload.debtor_id, userId)
    : null;
  const contract = payload.contract_id
    ? await ensureContract(payload.contract_id, userId)
    : null;
  if (debtor && contract && contract.debtor_id !== debtor.id) {
    throw new AppError("Kontrak tidak sesuai dengan debitur yang dipilih.", 422);
  }
  const fileMeta = persistDomainFile({
    entity: "legal/ideb",
    input: payload.file,
    fallbackBaseName: "ideb",
  });
  if (!fileMeta) throw new AppError("File IDEB wajib diunggah.", 422);
  return serializeWithFile(
    req,
    await repository.create("legal_ideb_uploads", {
      debtor_id: debtor?.id || contract?.debtor_id || normalizeText(payload.debtor_id),
      contract_id: normalizeText(payload.contract_id),
      month: payload.month,
      year: payload.year,
      status: normalizeUpper(payload.status || "PENDING"),
      result_summary: payload.result_summary || undefined,
      ...fileMeta,
      uploaded_by: userId || null,
      created_by: userId || null,
    }),
    "ideb",
  );
};

async function createProgress({ req, modelName, payload, userId, category, entity }) {
  await ensureContract(payload.contract_id, userId);
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
  for (const key of Object.keys(data)) {
    if (key.endsWith("_at") || key.startsWith("period_")) {
      data[key] = data[key] ? new Date(data[key]) : null;
    }
  }
  return serializeWithFile(
    req,
    await repository.create(modelName, {
      ...data,
      status: normalizeUpper(data.status),
      ...(fileMeta || {}),
      created_by: userId || null,
    }),
    category,
  );
}

async function updateProgress({ req, modelName, id, payload, userId, category, entity }) {
  const current = await repository.findById(modelName, id, { deleted_at: null });
  if (!current) throw new AppError("Data progress tidak ditemukan.", 404);
  const next = { ...current, ...payload };
  await ensureContract(current.contract_id, userId);
  await ensureContract(next.contract_id, userId);
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
  for (const key of Object.keys(data)) {
    if (key.endsWith("_at") || key.startsWith("period_")) {
      data[key] = data[key] ? new Date(data[key]) : null;
    }
  }
  if (data.status) data.status = normalizeUpper(data.status);
  return serializeWithFile(
    req,
    await repository.update(modelName, id, {
      ...data,
      ...(fileMeta || {}),
      updated_by: userId || null,
    }),
    category,
  );
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
    serializer: (request, item) => serializeWithFile(request, item, item.insurance_type),
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
  if (payload.insurance_progress_id) {
    const progress = await repository.findById(
      "legal_insurance_progress",
      payload.insurance_progress_id,
      { deleted_at: null },
    );
    if (!progress) throw new AppError("Progress asuransi tidak ditemukan.", 404);
    await ensureContract(progress.contract_id, userId);
    if (progress.contract_id !== payload.contract_id) {
      throw new AppError("Progress asuransi tidak sesuai dengan kontrak klaim.", 422);
    }
  }
  const fileMeta = payload.file
    ? persistDomainFile({
        entity: "legal/claims",
        input: payload.file,
        fallbackBaseName: payload.claim_type,
      })
    : null;
  const data = { ...payload };
  delete data.file;
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
  if (data.status) data.status = normalizeUpper(data.status);
  if (data.contract_id) await ensureContract(data.contract_id, userId);
  if (data.insurance_progress_id) {
    const progress = await repository.findById(
      "legal_insurance_progress",
      data.insurance_progress_id,
      { deleted_at: null },
    );
    if (!progress) throw new AppError("Progress asuransi tidak ditemukan.", 404);
    await ensureContract(progress.contract_id, userId);
    const targetContractId = data.contract_id || current.contract_id;
    if (progress.contract_id !== targetContractId) {
      throw new AppError("Progress asuransi tidak sesuai dengan kontrak klaim.", 422);
    }
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

exports.listDeposits = async ({ query, userId }) =>
  listModel({
    req: null,
    modelName: "legal_deposits",
    query,
    searchFields: ["type", "status", "notes"],
    extraWhere: await buildContractAccessWhere(userId),
    serializer: (_request, item) => serializeDeposit(item),
  });

exports.createDeposit = async ({ payload, userId }) => {
  await ensureContract(payload.contract_id, userId);
  if (payload.third_party_id) await ensureThirdParty(payload.third_party_id);
  const remaining = calculateRemaining(payload);
  return serializeDeposit(
    await repository.create("legal_deposits", {
      deposit_type_id: normalizeText(payload.deposit_type_id),
      type: normalizeUpper(payload.type),
      contract_id: payload.contract_id,
      third_party_id: normalizeText(payload.third_party_id),
      nominal: decimalField(payload, "nominal"),
      paid_amount: decimalField(payload, "paid_amount") || 0,
      processed_amount: decimalField(payload, "processed_amount") || 0,
      remaining_amount: remaining,
      status: normalizeUpper(payload.status || "PENDING"),
      notes: normalizeText(payload.notes),
      created_by: userId || null,
    }),
  );
};

exports.updateDeposit = async ({ id, payload, userId }) => {
  const current = await repository.findById("legal_deposits", id, { deleted_at: null });
  if (!current) throw new AppError("Dana titipan tidak ditemukan.", 404);
  await ensureContract(current.contract_id, userId);
  const next = {
    deposit_type_id:
      payload.deposit_type_id !== undefined
        ? normalizeText(payload.deposit_type_id)
        : current.deposit_type_id,
    type: normalizeUpper(payload.type) || current.type,
    contract_id: payload.contract_id || current.contract_id,
    third_party_id:
      payload.third_party_id !== undefined
        ? normalizeText(payload.third_party_id)
        : current.third_party_id,
    nominal: payload.nominal ?? current.nominal,
    paid_amount: payload.paid_amount ?? current.paid_amount,
    processed_amount: payload.processed_amount ?? current.processed_amount,
    remaining_amount:
      payload.remaining_amount ??
      Math.max(
        number(payload.nominal ?? current.nominal) -
          number(payload.paid_amount ?? current.paid_amount) -
          number(payload.processed_amount ?? current.processed_amount),
        0,
      ),
    status: normalizeUpper(payload.status) || current.status,
    notes: payload.notes !== undefined ? normalizeText(payload.notes) : current.notes,
    updated_by: userId || null,
  };
  await ensureContract(next.contract_id, userId);
  if (next.third_party_id) await ensureThirdParty(next.third_party_id);
  return serializeDeposit(await repository.update("legal_deposits", id, next));
};

exports.listDepositTransactions = async ({ query, userId }) => {
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
    req: null,
    modelName: "legal_deposit_transactions",
    query: transactionQuery,
    searchFields: ["action", "notes"],
    extraWhere: {
      ...(query.deposit_id ? { deposit_id: query.deposit_id } : {}),
      ...(isEmptyObject(depositWhere) ? {} : { deposit: { is: depositWhere } }),
    },
    includeSoftDeleteFilter: false,
    serializer: (_request, item) => ({
      ...item,
      amount: number(item.amount),
    }),
  });
};

exports.createDepositTransaction = async ({ payload, userId }) => {
  const deposit = await repository.findById("legal_deposits", payload.deposit_id, {
    deleted_at: null,
  });
  if (!deposit) throw new AppError("Dana titipan tidak ditemukan.", 404);
  await ensureContract(deposit.contract_id, userId);
  const action = normalizeUpper(payload.action);
  const amountValue = number(payload.amount);

  return repository.transaction(async (tx) => {
    const transaction = await repository.create(
      "legal_deposit_transactions",
      {
        deposit_id: payload.deposit_id,
        transaction_date: new Date(payload.transaction_date),
        action,
        amount: payload.amount,
        notes: normalizeText(payload.notes),
        created_by: userId || null,
      },
      tx,
    );
    const paidDelta =
      action.includes("BAYAR") || action.includes("PAID") ? amountValue : 0;
    const processedDelta =
      action.includes("PROSES") || action.includes("PROCESS")
        ? amountValue
        : 0;
    const paidAmount = number(deposit.paid_amount) + paidDelta;
    const processedAmount = number(deposit.processed_amount) + processedDelta;
    await repository.update(
      "legal_deposits",
      deposit.id,
      {
        paid_amount: paidAmount,
        processed_amount: processedAmount,
        remaining_amount: Math.max(number(deposit.nominal) - paidAmount - processedAmount, 0),
        updated_by: userId || null,
      },
      tx,
    );
    return {
      ...transaction,
      amount: number(transaction.amount),
    };
  });
};

exports.getSummaryReport = async () => {
  const [
    templates,
    prints,
    ideb,
    notary,
    insurance,
    kjpp,
    claims,
    deposits,
  ] = await Promise.all([
    repository.countWhere("legal_document_templates", { deleted_at: null }),
    repository.countWhere("legal_print_histories", { deleted_at: null }),
    repository.countWhere("legal_ideb_uploads", { deleted_at: null }),
    repository.countWhere("legal_notary_progress", { deleted_at: null }),
    repository.countWhere("legal_insurance_progress", { deleted_at: null }),
    repository.countWhere("legal_kjpp_progress", { deleted_at: null }),
    repository.countWhere("legal_claims", { deleted_at: null }),
    repository.countWhere("legal_deposits", { deleted_at: null }),
  ]);
  return { templates, prints, ideb, notary, insurance, kjpp, claims, deposits };
};

exports.getThirdPartyDocumentsReport = async () => {
  const [notary, insurance, kjpp, claims] = await Promise.all([
    repository.group("legal_notary_progress", {
      by: ["third_party_id", "status"],
      where: { deleted_at: null },
      _count: { id: true },
    }),
    repository.group("legal_insurance_progress", {
      by: ["third_party_id", "status"],
      where: { deleted_at: null },
      _count: { id: true },
    }),
    repository.group("legal_kjpp_progress", {
      by: ["third_party_id", "status"],
      where: { deleted_at: null },
      _count: { id: true },
    }),
    repository.group("legal_claims", {
      by: ["status"],
      where: { deleted_at: null },
      _count: { id: true },
      _sum: { claim_amount: true, disbursed_amount: true },
    }),
  ]);
  return {
    notary: await attachThirdPartyNames(notary),
    insurance: await attachThirdPartyNames(insurance),
    kjpp: await attachThirdPartyNames(kjpp),
    claims,
  };
};

exports.getThirdPartyDepositFundsReport = async () => {
  const rows = await repository.aggregateDeposits();
  return rows.map((item) => ({
    type: item.type,
    status: item.status,
    total_records: item._count.id,
    nominal: number(item._sum.nominal),
    paid_amount: number(item._sum.paid_amount),
    processed_amount: number(item._sum.processed_amount),
    remaining_amount: number(item._sum.remaining_amount),
  }));
};
