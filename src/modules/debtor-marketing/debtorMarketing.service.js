const repository = require("./debtorMarketing.repository");
const { randomUUID } = require("crypto");
const { AppError } = require("../../utils/errors");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  resolvePagination,
} = require("../../utils/pagination");
const { persistDomainFile, serializeFile } = require("../../utils/domain-files");
const {
  buildDebtorManageWhere,
  buildDebtorVisibilityWhere,
  getDebtorAccessScope,
} = require("../../utils/debtor-access");

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
    debtor: item.debtor,
    contract: item.contract,
    timeline: item.timeline || null,
    related_activity: item.related_activity || null,
    created_by: item.created_by,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

function buildWhere(kind, query, scope = null) {
  const clauses = [{ activity_kind: kind }, { deleted_at: null }];
  const debtorVisibilityWhere = scope ? buildDebtorVisibilityWhere(scope) : {};
  if (Object.keys(debtorVisibilityWhere).length > 0) {
    clauses.push({ debtor: debtorVisibilityWhere });
  }
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
    timeline_id:
      payload.timeline_id !== undefined
        ? normalizeText(payload.timeline_id)
        : current.timeline_id,
    timeline_group_id:
      payload.timeline_group_id !== undefined
        ? normalizeText(payload.timeline_group_id)
        : current.timeline_group_id,
    related_activity_id:
      payload.related_activity_id !== undefined
        ? normalizeText(payload.related_activity_id)
        : current.related_activity_id,
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

}

function timelineTitle(kind, data) {
  if (kind === "ACTION_PLAN") return data.action_plan || data.notes || "Action Plan";
  if (kind === "VISIT_RESULT") return data.visit_result || data.notes || "Hasil Kunjungan";
  if (kind === "HANDLING_STEP") return data.handling_step || data.notes || "Langkah Penanganan";
  return "Timeline Marketing";
}

function isCompletedStatus(status) {
  return ["SELESAI", "DONE", "COMPLETED", "CLOSED"].includes(
    String(status || "").toUpperCase(),
  );
}

function validateTimelineOwnership(timeline, data) {
  if (!timeline || timeline.debtor_id !== data.debtor_id) {
    throw new AppError("Timeline marketing tidak sesuai dengan debitur.", 422);
  }
  if (data.contract_id && timeline.contract_id && timeline.contract_id !== data.contract_id) {
    throw new AppError("Timeline marketing tidak sesuai dengan kontrak debitur.", 422);
  }
}

async function resolveTimeline({ kind, data, userId, currentId = null }) {
  if (data.related_activity_id) {
    if (currentId && data.related_activity_id === currentId) {
      throw new AppError("Aktivitas tidak bisa direlasikan ke dirinya sendiri.", 422);
    }
    const related = await repository.findById(data.related_activity_id, {
      deleted_at: null,
    });
    if (!related) throw new AppError("Aktivitas marketing terkait tidak ditemukan.", 404);
    if (related.debtor_id !== data.debtor_id) {
      throw new AppError("Aktivitas marketing terkait tidak sesuai dengan debitur.", 422);
    }
    if (data.contract_id && related.contract_id && related.contract_id !== data.contract_id) {
      throw new AppError("Aktivitas marketing terkait tidak sesuai dengan kontrak.", 422);
    }
    if (related.timeline) {
      validateTimelineOwnership(related.timeline, data);
      return related.timeline;
    }
  }

  if (data.timeline_id) {
    const timeline = await repository.findTimelineById(data.timeline_id);
    validateTimelineOwnership(timeline, data);
    return timeline;
  }

  if (data.timeline_group_id) {
    const timeline = await repository.findTimelineByGroupKey(data.timeline_group_id);
    if (timeline) {
      validateTimelineOwnership(timeline, data);
      return timeline;
    }
  }

  return repository.createTimeline({
    group_key: data.timeline_group_id || randomUUID(),
    debtor_id: data.debtor_id,
    contract_id: data.contract_id || null,
    title: timelineTitle(kind, data),
    status: "OPEN",
    started_at: data.activity_date || data.target_date || new Date(),
    created_by: userId || null,
  });
}

async function syncTimelineState(timeline, kind, data, userId) {
  if (!timeline) return;
  const update = {
    updated_by: userId || null,
  };

  if (kind === "HANDLING_STEP" && isCompletedStatus(data.status)) {
    update.status = "CLOSED";
    update.completed_at = data.activity_date || data.target_date || new Date();
  }

  if (Object.keys(update).length > 1) {
    await repository.updateTimeline(timeline.id, update);
  }
}

async function ensureDebtorAccessible(debtorId, userId) {
  const scope = await getDebtorAccessScope(userId);
  const debtor = await repository.findDebtorByIdWithWhere(
    debtorId,
    buildDebtorManageWhere(scope),
  );
  if (!debtor) throw new AppError("Debitur tidak ditemukan atau tidak bisa diakses.", 404);
}

function ensureKindPayload(kind, data) {
  const requiredField = REQUIRED_FIELD_BY_KIND[kind];
  if (!normalizeText(data[requiredField])) {
    throw new AppError(`Field ${requiredField} wajib diisi.`, 422);
  }
}

exports.getAll = async ({ req, kindSlug, query, userId }) => {
  const kind = getKind(kindSlug);
  const scope = await getDebtorAccessScope(userId);
  const pagination = resolvePagination(query, PAGINATION_PROFILES.TABLE);
  const where = buildWhere(kind, query, scope);
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

exports.getById = async ({ req, kindSlug, id, userId }) => {
  const kind = getKind(kindSlug);
  const scope = await getDebtorAccessScope(userId);
  const debtorVisibilityWhere = buildDebtorVisibilityWhere(scope);
  const item = await repository.findById(id, {
    activity_kind: kind,
    deleted_at: null,
    ...(Object.keys(debtorVisibilityWhere).length > 0
      ? { debtor: debtorVisibilityWhere }
      : {}),
  });
  if (!item) throw new AppError("Aktivitas marketing tidak ditemukan.", 404);
  return serialize(req, item);
};

exports.create = async ({ req, kindSlug, payload, userId }) => {
  const kind = getKind(kindSlug);
  const data = normalizePayload(payload);
  ensureKindPayload(kind, data);
  await ensureReferences(data);
  await ensureDebtorAccessible(data.debtor_id, userId);
  const timeline = await resolveTimeline({ kind, data, userId });
  const fileMeta = payload.file
    ? persistDomainFile({
        entity: `debtor-marketing/${kind.toLowerCase()}`,
        input: payload.file,
        fallbackBaseName: kind,
      })
    : null;

  const created = await repository.create({
    ...data,
    timeline_id: timeline.id,
    timeline_group_id: timeline.group_key || timeline.id,
    ...(fileMeta || {}),
    activity_kind: kind,
    created_by: userId || null,
  });
  await syncTimelineState(timeline, kind, data, userId);
  return serialize(req, created);
};

exports.update = async ({ req, kindSlug, id, payload, userId }) => {
  const scope = await getDebtorAccessScope(userId);
  const debtorManageWhere = buildDebtorManageWhere(scope);
  const current = await repository.findById(id, {
    activity_kind: getKind(kindSlug),
    deleted_at: null,
    ...(Object.keys(debtorManageWhere).length > 0
      ? { debtor: debtorManageWhere }
      : {}),
  });
  if (!current) throw new AppError("Aktivitas marketing tidak ditemukan.", 404);

  const data = normalizePayload(payload, current);
  ensureKindPayload(current.activity_kind, data);
  await ensureReferences(data);
  await ensureDebtorAccessible(data.debtor_id, userId);
  const timeline = await resolveTimeline({
    kind: current.activity_kind,
    data,
    userId,
    currentId: current.id,
  });
  const fileMeta =
    payload.file !== undefined && payload.file !== null
      ? persistDomainFile({
          entity: `debtor-marketing/${current.activity_kind.toLowerCase()}`,
          input: payload.file,
          previousPath: current.file_path,
          fallbackBaseName: current.activity_kind,
        })
      : null;

  const updated = await repository.update(id, {
    ...data,
    timeline_id: timeline.id,
    timeline_group_id: timeline.group_key || timeline.id,
    ...(fileMeta || {}),
    updated_by: userId || null,
  });
  await syncTimelineState(timeline, current.activity_kind, data, userId);
  return serialize(req, updated);
};

exports.delete = async ({ kindSlug, id, userId }) => {
  const scope = await getDebtorAccessScope(userId);
  const debtorManageWhere = buildDebtorManageWhere(scope);
  const current = await repository.findById(id, {
    activity_kind: getKind(kindSlug),
    deleted_at: null,
    ...(Object.keys(debtorManageWhere).length > 0
      ? { debtor: debtorManageWhere }
      : {}),
  });
  if (!current) throw new AppError("Aktivitas marketing tidak ditemukan.", 404);
  await repository.update(id, {
    deleted_at: new Date(),
    deleted_by: userId || null,
  });
};
