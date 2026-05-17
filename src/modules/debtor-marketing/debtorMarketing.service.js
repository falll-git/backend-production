const repository = require("./debtorMarketing.repository");
const { AppError } = require("../../utils/errors");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  resolvePagination,
} = require("../../utils/pagination");
const { persistDomainFile, serializeFile } = require("../../utils/domain-files");

const KIND_BY_SLUG = {
  "action-plans": "ACTION_PLAN",
  "visit-results": "VISIT_RESULT",
  "handling-steps": "HANDLING_STEP",
};
const REQUIRED_FIELD_BY_KIND = {
  ACTION_PLAN: "action_plan",
  VISIT_RESULT: "visit_result",
  HANDLING_STEP: "handling_step",
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

function getKind(slug) {
  const kind = KIND_BY_SLUG[slug];
  if (!kind) throw new AppError("Jenis aktivitas marketing tidak valid.", 422);
  return kind;
}

function serialize(req, item) {
  return {
    id: item.id,
    activity_kind: item.activity_kind,
    debtor_id: item.debtor_id,
    contract_id: item.contract_id,
    marketing_activity_type_id: item.marketing_activity_type_id,
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
    debtor: item.debtor,
    contract: item.contract,
    activity_type: item.activity_type,
    created_by: item.created_by,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

function buildWhere(kind, query) {
  const clauses = [{ activity_kind: kind }, { deleted_at: null }];
  if (query.debtor_id) clauses.push({ debtor_id: query.debtor_id });
  if (query.contract_id) clauses.push({ contract_id: query.contract_id });
  if (query.status) clauses.push({ status: normalizeUpper(query.status) });
  const search = normalizeText(query.search);
  if (search) {
    clauses.push({
      OR: [
        { action_plan: { contains: search, mode: "insensitive" } },
        { visit_result: { contains: search, mode: "insensitive" } },
        { handling_step: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
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
    marketing_activity_type_id:
      payload.marketing_activity_type_id !== undefined
        ? normalizeText(payload.marketing_activity_type_id)
        : current.marketing_activity_type_id,
    activity_date:
      payload.activity_date !== undefined
        ? payload.activity_date
          ? new Date(payload.activity_date)
          : null
        : current.activity_date,
    target_date:
      payload.target_date !== undefined
        ? payload.target_date
          ? new Date(payload.target_date)
          : null
        : current.target_date,
    status: normalizeUpper(payload.status) ?? current.status ?? "PENDING",
    action_plan:
      payload.action_plan !== undefined
        ? normalizeText(payload.action_plan)
        : current.action_plan,
    visit_address:
      payload.visit_address !== undefined
        ? normalizeText(payload.visit_address)
        : current.visit_address,
    visit_result:
      payload.visit_result !== undefined
        ? normalizeText(payload.visit_result)
        : current.visit_result,
    conclusion:
      payload.conclusion !== undefined
        ? normalizeText(payload.conclusion)
        : current.conclusion,
    handling_step:
      payload.handling_step !== undefined
        ? normalizeText(payload.handling_step)
        : current.handling_step,
    handling_result:
      payload.handling_result !== undefined
        ? normalizeText(payload.handling_result)
        : current.handling_result,
    notes: payload.notes !== undefined ? normalizeText(payload.notes) : current.notes,
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

  if (
    data.marketing_activity_type_id &&
    !(await repository.findActivityTypeById(data.marketing_activity_type_id))
  ) {
    throw new AppError("Jenis aktivitas marketing tidak ditemukan atau tidak aktif.", 404);
  }
}

function ensureKindPayload(kind, data) {
  const requiredField = REQUIRED_FIELD_BY_KIND[kind];
  if (!normalizeText(data[requiredField])) {
    throw new AppError(`Field ${requiredField} wajib diisi.`, 422);
  }
}

exports.getAll = async ({ req, kindSlug, query }) => {
  const kind = getKind(kindSlug);
  const pagination = resolvePagination(query, PAGINATION_PROFILES.TABLE);
  const where = buildWhere(kind, query);
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

exports.getById = async ({ req, kindSlug, id }) => {
  const kind = getKind(kindSlug);
  const item = await repository.findById(id, {
    activity_kind: kind,
    deleted_at: null,
  });
  if (!item) throw new AppError("Aktivitas marketing tidak ditemukan.", 404);
  return serialize(req, item);
};

exports.create = async ({ req, kindSlug, payload, userId }) => {
  const kind = getKind(kindSlug);
  const data = normalizePayload(payload);
  ensureKindPayload(kind, data);
  await ensureReferences(data);
  const fileMeta = payload.file
    ? persistDomainFile({
        entity: `debtor-marketing/${kind.toLowerCase()}`,
        input: payload.file,
        fallbackBaseName: kind,
      })
    : null;

  return serialize(
    req,
    await repository.create({
      ...data,
      ...(fileMeta || {}),
      activity_kind: kind,
      created_by: userId || null,
    }),
  );
};

exports.update = async ({ req, kindSlug, id, payload, userId }) => {
  const current = await repository.findById(id, {
    activity_kind: getKind(kindSlug),
    deleted_at: null,
  });
  if (!current) throw new AppError("Aktivitas marketing tidak ditemukan.", 404);

  const data = normalizePayload(payload, current);
  ensureKindPayload(current.activity_kind, data);
  await ensureReferences(data);
  const fileMeta =
    payload.file !== undefined && payload.file !== null
      ? persistDomainFile({
          entity: `debtor-marketing/${current.activity_kind.toLowerCase()}`,
          input: payload.file,
          previousPath: current.file_path,
          fallbackBaseName: current.activity_kind,
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

exports.delete = async ({ kindSlug, id, userId }) => {
  await exports.getById({ req: null, kindSlug, id });
  await repository.update(id, {
    deleted_at: new Date(),
    deleted_by: userId || null,
  });
};
