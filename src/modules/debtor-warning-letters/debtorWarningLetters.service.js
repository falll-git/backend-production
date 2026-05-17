const repository = require("./debtorWarningLetters.repository");
const { AppError } = require("../../utils/errors");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  resolvePagination,
} = require("../../utils/pagination");
const { persistDomainFile, serializeFile } = require("../../utils/domain-files");

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
    debtor: item.debtor,
    contract: item.contract,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
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

async function ensureReferences(data) {
  const debtor = await repository.findDebtorById(data.debtor_id);
  if (!debtor) throw new AppError("Debitur tidak ditemukan.", 404);

  if (data.contract_id) {
    const contract = await repository.findContractById(data.contract_id);
    if (!contract || contract.debtor_id !== data.debtor_id) {
      throw new AppError("Kontrak debitur tidak ditemukan.", 404);
    }
  }
}

exports.getAll = async ({ req, query }) => {
  const pagination = resolvePagination(query, PAGINATION_PROFILES.TABLE);
  const where = buildWhere(query);
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

exports.getById = async ({ req, id }) => {
  const item = await repository.findById(id, { deleted_at: null });
  if (!item) throw new AppError("Surat peringatan tidak ditemukan.", 404);
  return serialize(req, item);
};

exports.create = async ({ req, payload, userId }) => {
  const data = normalizePayload(payload);
  await ensureReferences(data);
  const fileMeta = payload.file
    ? persistDomainFile({
        entity: "debtor-warning-letters",
        input: payload.file,
        fallbackBaseName: data.letter_type,
      })
    : null;

  return serialize(
    req,
    await repository.create({
      ...data,
      ...(fileMeta || {}),
      created_by: userId || null,
    }),
  );
};

exports.update = async ({ req, id, payload, userId }) => {
  const current = await repository.findById(id, { deleted_at: null });
  if (!current) throw new AppError("Surat peringatan tidak ditemukan.", 404);
  const data = normalizePayload(payload, current);
  await ensureReferences(data);
  const fileMeta =
    payload.file !== undefined && payload.file !== null
      ? persistDomainFile({
          entity: "debtor-warning-letters",
          input: payload.file,
          previousPath: current.file_path,
          fallbackBaseName: data.letter_type,
        })
      : null;

  return serialize(
    req,
    await repository.update(id, {
      ...data,
      ...(fileMeta || {}),
      updated_by: userId || null,
    }),
  );
};

exports.delete = async ({ id, userId }) => {
  await exports.getById({ req: null, id });
  await repository.update(id, {
    deleted_at: new Date(),
    deleted_by: userId || null,
  });
};
