const repository = require("./debtorWarningLetters.repository");
const { AppError } = require("../../utils/errors");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  resolvePagination,
} = require("../../utils/pagination");
const {
  normalizeUploadFiles,
  serializeFile,
  serializeFiles,
  withDomainFileRollback,
} = require("../../utils/domain-files");
const {
  buildContractManageWhere,
  buildContractVisibilityWhere,
  buildDebtorManageWhere,
  buildDebtorVisibilityWhere,
  getDebtorAccessScope,
} = require("../../utils/debtor-access");
const {
  auditSnapshot,
  requestMetadata,
  safeRecordDebtorActivity,
} = require("../../utils/debtor-audit-log");

const READ_SCOPE_URLS = [
  "/dashboard/informasi-debitur",
  "/dashboard/informasi-debitur/master-debitur",
];
const MANAGE_SCOPE_URLS = ["/dashboard/informasi-debitur/master-debitur"];
const WARNING_LETTER_AUDIT_FIELDS = [
  "id",
  "debtor_id",
  "contract_id",
  "letter_type",
  "issued_at",
  "sent_at",
  "delivery_status",
  "description",
  "file_name",
  "mime_type",
  "size_bytes",
  "created_by",
  "updated_by",
  "deleted_by",
  "deleted_at",
];

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

function serialize(req, item) {
  return {
    id: item.id,
    debtor_id: item.debtor_id,
    contract_id: item.contract_id,
    letter_type: item.letter_type,
    issued_at: item.issued_at,
    sent_at: item.sent_at,
    delivery_status: item.delivery_status,
    description: item.description,
    file: serializeFile(req, item, {
      module: "debtor_information",
      entityId: item.id,
      fallbackBaseName: item.letter_type,
    }),
    files: serializeFiles(req, item, {
      module: "debtor_information",
      fallbackBaseName: item.letter_type,
    }),
    debtor: item.debtor,
    contract: item.contract,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

function buildStoredFiles(fileMetas = []) {
  return fileMetas.map((fileMeta) => ({
    file_path: fileMeta.file_path,
    file_name: fileMeta.file_name,
    mime_type: fileMeta.mime_type,
    size_bytes: fileMeta.size_bytes,
    checksum: fileMeta.checksum,
  }));
}

function buildWhere(query) {
  const clauses = [{ deleted_at: null }];
  if (query.debtor_id) clauses.push({ debtor_id: query.debtor_id });
  if (query.contract_id) clauses.push({ contract_id: query.contract_id });
  if (query.letter_type) clauses.push({ letter_type: normalizeUpper(query.letter_type) });
  if (query.delivery_status) {
    clauses.push({ delivery_status: normalizeUpper(query.delivery_status) });
  }
  const search = normalizeText(query.search);
  if (search) {
    clauses.push({
      OR: [
        { letter_type: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { debtor: { name: { contains: search, mode: "insensitive" } } },
        { contract: { no_kontrak: { contains: search, mode: "insensitive" } } },
      ],
    });
  }
  return { AND: clauses };
}

function buildRelatedAccessWhere(debtorWhere, contractWhere) {
  const clauses = [];
  if (debtorWhere && Object.keys(debtorWhere).length > 0) {
    clauses.push({ debtor: debtorWhere });
  }
  if (contractWhere && Object.keys(contractWhere).length > 0) {
    clauses.push({ contract: contractWhere });
  }

  return clauses.length > 0 ? { OR: clauses } : {};
}

function normalizePayload(payload, current = {}) {
  return {
    debtor_id: normalizeText(payload.debtor_id) ?? current.debtor_id,
    contract_id:
      payload.contract_id !== undefined
        ? normalizeText(payload.contract_id)
        : current.contract_id,
    letter_type: normalizeUpper(payload.letter_type) ?? current.letter_type,
    issued_at:
      payload.issued_at !== undefined
        ? new Date(payload.issued_at)
        : current.issued_at,
    sent_at:
      payload.sent_at !== undefined
        ? payload.sent_at
          ? new Date(payload.sent_at)
          : null
        : current.sent_at,
    delivery_status:
      normalizeUpper(payload.delivery_status) ||
      current.delivery_status ||
      "BELUM_DIKIRIM",
    description:
      payload.description !== undefined
        ? normalizeText(payload.description)
        : current.description,
  };
}

async function ensureReferences(data, userId) {
  const scope = await getDebtorAccessScope(userId, MANAGE_SCOPE_URLS);
  const debtor = await repository.findDebtorById(
    data.debtor_id,
    buildDebtorManageWhere(scope),
  );
  if (!debtor) throw new AppError("Debitur tidak ditemukan.", 404);

  if (data.contract_id) {
    const contract = await repository.findContractById(
      data.contract_id,
      buildContractManageWhere(scope),
    );
    if (!contract || contract.debtor_id !== data.debtor_id) {
      throw new AppError("Kontrak debitur tidak ditemukan.", 404);
    }
  }
}

exports.getAll = async ({ req, query, userId }) => {
  const pagination = resolvePagination(query, PAGINATION_PROFILES.TABLE);
  const scope = await getDebtorAccessScope(userId, READ_SCOPE_URLS);
  const relatedAccessWhere = buildRelatedAccessWhere(
    buildDebtorVisibilityWhere(scope),
    buildContractVisibilityWhere(scope),
  );
  const where = {
    AND: [
      buildWhere(query),
      ...(Object.keys(relatedAccessWhere).length > 0
        ? [relatedAccessWhere]
        : []),
    ],
  };
  const [data, total] = await Promise.all([
    repository.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { created_at: "desc" },
    }),
    repository.count(where),
  ]);
  return {
    data: data.map((item) => serialize(req, item)),
    meta: buildPaginationMeta(total, pagination),
  };
};

exports.getById = async ({ req, id, userId }) => {
  const scope = await getDebtorAccessScope(userId, READ_SCOPE_URLS);
  const relatedAccessWhere = buildRelatedAccessWhere(
    buildDebtorVisibilityWhere(scope),
    buildContractVisibilityWhere(scope),
  );
  const item = await repository.findById(id, {
    deleted_at: null,
    ...relatedAccessWhere,
  });
  if (!item) throw new AppError("Surat peringatan tidak ditemukan.", 404);
  return serialize(req, item);
};

exports.getByIdForManage = async ({ req, id, userId }) => {
  void req;
  const scope = await getDebtorAccessScope(userId, MANAGE_SCOPE_URLS);
  const relatedAccessWhere = buildRelatedAccessWhere(
    buildDebtorManageWhere(scope),
    buildContractManageWhere(scope),
  );
  const item = await repository.findById(id, {
    deleted_at: null,
    ...relatedAccessWhere,
  });
  if (!item) {
    throw new AppError("Surat peringatan tidak ditemukan atau tidak bisa dikelola.", 404);
  }
  return item;
};

exports.create = async ({ req, payload, userId }) => {
  const data = normalizePayload(payload);
  await ensureReferences(data, userId);
  let fileMetas = [];
  const created = await withDomainFileRollback(async (persistFiles) => {
    fileMetas = persistFiles({
      entity: "debtor-warning-letters",
      inputs: normalizeUploadFiles(payload),
      fallbackBaseName: data.letter_type,
    });
    if (fileMetas.length === 0) {
      throw new AppError("File surat peringatan wajib dipilih.", 400);
    }
    const primaryFile = fileMetas[0] || null;

    return repository.create({
      ...data,
      ...(primaryFile || {}),
      files: {
        create: buildStoredFiles(fileMetas),
      },
      created_by: userId || null,
    });
  });
  await safeRecordDebtorActivity(undefined, {
    actor_id: userId || null,
    action: "UPLOAD_WARNING_LETTER",
    source: "MANUAL",
    entity_type: "debtor_warning_letters",
    entity_id: created.id,
    debtor_id: created.debtor_id,
    contract_id: created.contract_id || null,
    warning_letter_id: created.id,
    title: `Upload surat peringatan ${created.letter_type}`,
    after_data: auditSnapshot(created, WARNING_LETTER_AUDIT_FIELDS),
    metadata: {
      file_count: fileMetas.length,
      file_names: fileMetas.map((file) => file.file_name).filter(Boolean),
    },
    ...requestMetadata(req),
  });

  return serialize(req, created);
};

exports.update = async ({ req, id, payload, userId }) => {
  const current = await exports.getByIdForManage({ req, id, userId });
  const data = normalizePayload(payload, current);
  await ensureReferences(data, userId);
  let fileMetas = [];
  const updated = await withDomainFileRollback(async (persistFiles) => {
    fileMetas = persistFiles({
      entity: "debtor-warning-letters",
      inputs: normalizeUploadFiles(payload),
      fallbackBaseName: data.letter_type,
    });
    const primaryFile =
      !current.file_path && fileMetas.length > 0 ? fileMetas[0] : null;

    return repository.update(id, {
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
  });
  await safeRecordDebtorActivity(undefined, {
    actor_id: userId || null,
    action: "UPDATE_WARNING_LETTER",
    source: "MANUAL",
    entity_type: "debtor_warning_letters",
    entity_id: updated.id,
    debtor_id: updated.debtor_id,
    contract_id: updated.contract_id || null,
    warning_letter_id: updated.id,
    title: `Ubah surat peringatan ${updated.letter_type}`,
    before_data: auditSnapshot(current, WARNING_LETTER_AUDIT_FIELDS),
    after_data: auditSnapshot(updated, WARNING_LETTER_AUDIT_FIELDS),
    metadata: {
      file_count: fileMetas.length,
      file_names: fileMetas.map((file) => file.file_name).filter(Boolean),
    },
    ...requestMetadata(req),
  });

  return serialize(req, updated);
};

exports.delete = async ({ req, id, userId }) => {
  const current = await exports.getByIdForManage({ req, id, userId });
  const deleted = await repository.update(id, {
    deleted_at: new Date(),
    deleted_by: userId || null,
  });
  await safeRecordDebtorActivity(undefined, {
    actor_id: userId || null,
    action: "DELETE_WARNING_LETTER",
    source: "MANUAL",
    entity_type: "debtor_warning_letters",
    entity_id: deleted.id,
    debtor_id: deleted.debtor_id,
    contract_id: deleted.contract_id || null,
    warning_letter_id: deleted.id,
    title: `Hapus surat peringatan ${deleted.letter_type}`,
    before_data: auditSnapshot(current, WARNING_LETTER_AUDIT_FIELDS),
    after_data: auditSnapshot(deleted, WARNING_LETTER_AUDIT_FIELDS),
    ...requestMetadata(req),
  });
};
