const repository = require("./debtorImports.repository");
const { AppError } = require("../../utils/errors");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  resolvePagination,
} = require("../../utils/pagination");
const { persistDomainFile, serializeFile } = require("../../utils/domain-files");

const IMPORT_TYPES = new Set(["MASTER", "COLLECTIBILITY", "SLIK", "RESTRIK"]);

function normalizeText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function serializeJob(req, job) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    file: serializeFile(req, job, {
      module: "debtor_information",
      entityId: job.id,
      fallbackBaseName: `${job.type}-import`,
    }),
    total_rows: job.total_rows,
    success_rows: job.success_rows,
    failed_rows: job.failed_rows,
    error_summary: job.error_summary,
    started_at: job.started_at,
    completed_at: job.completed_at,
    records: Array.isArray(job.records) ? job.records : [],
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

async function ensureTargets(payload) {
  if (payload.debtor_id && !(await repository.findDebtorById(payload.debtor_id))) {
    throw new AppError("Debitur target tidak ditemukan.", 404);
  }
  if (payload.contract_id) {
    const contract = await repository.findContractById(payload.contract_id);
    if (!contract) throw new AppError("Kontrak target tidak ditemukan.", 404);
    if (payload.debtor_id && contract.debtor_id !== payload.debtor_id) {
      throw new AppError("Kontrak tidak sesuai dengan debitur target.", 422);
    }
  }
}

exports.getAll = async ({ req, query }) => {
  const pagination = resolvePagination(query, PAGINATION_PROFILES.HISTORY);
  const clauses = [{ deleted_at: null }];
  if (query.type) clauses.push({ type: String(query.type).trim().toUpperCase() });
  if (query.status) clauses.push({ status: String(query.status).trim().toUpperCase() });
  const where = { AND: clauses };
  const [data, total] = await Promise.all([
    repository.findJobs({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { created_at: "desc" },
    }),
    repository.countJobs(where),
  ]);

  return {
    data: data.map((item) => serializeJob(req, item)),
    meta: buildPaginationMeta(total, pagination),
  };
};

exports.createJob = async ({ req, type, payload, userId }) => {
  const normalizedType = String(type || "").trim().toUpperCase();
  if (!IMPORT_TYPES.has(normalizedType)) {
    throw new AppError("Tipe import tidak valid.", 422);
  }

  await ensureTargets(payload);
  const fileMeta = persistDomainFile({
    entity: `debtor-imports/${normalizedType.toLowerCase()}`,
    input: payload.file,
    fallbackBaseName: `${normalizedType}-import`,
  });
  if (!fileMeta) throw new AppError("File import wajib diunggah.", 422);

  const job = await repository.transaction(async (tx) => {
    const created = await tx.debtor_import_jobs.create({
      data: {
        type: normalizedType,
        status: "PENDING",
        ...fileMeta,
        total_rows: payload.total_rows || 0,
        created_by: userId || null,
      },
    });

    if (["SLIK", "RESTRIK"].includes(normalizedType)) {
      await tx.debtor_external_records.create({
        data: {
          import_job_id: created.id,
          source_type: normalizedType,
          debtor_id: normalizeText(payload.debtor_id),
          contract_id: normalizeText(payload.contract_id),
          period_month: normalizeText(payload.period_month),
          raw_reference: normalizeText(payload.raw_reference),
          summary: payload.summary || undefined,
          file_path: fileMeta.file_path,
          file_name: fileMeta.file_name,
          mime_type: fileMeta.mime_type,
          size_bytes: fileMeta.size_bytes,
          status:
            payload.debtor_id || payload.contract_id
              ? "MATCHED"
              : "MATCH_PENDING",
          created_by: userId || null,
        },
      });
    }

    return tx.debtor_import_jobs.findUnique({
      where: { id: created.id },
      include: {
        records: true,
      },
    });
  });

  return serializeJob(req, job);
};
