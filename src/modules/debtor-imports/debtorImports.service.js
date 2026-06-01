const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ExcelJS = require("exceljs");
const repository = require("./debtorImports.repository");
const { AppError } = require("../../utils/errors");
const { enqueueSlikImportJob } = require("../../queues/slik-import.queue");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  resolvePagination,
} = require("../../utils/pagination");
const { persistDomainFile, serializeFile } = require("../../utils/domain-files");
const { resolveStoredFilePath } = require("../../utils/digital-archive-files");
const {
  defaultDateForPeriod,
  normalizeText,
  normalizeUpper,
  parseSlikDate,
  prepareParseOptions,
  streamSlikTextFile,
} = require("../../utils/slik-import");

const IMPORT_TYPES = new Set(["SLIK", "RESTRIK", "IDEB"]);
const SLIK_IMPORT_SEGMENTS = new Set(["D01", "D02", "F01", "A01"]);
const IDEB_IMPORT_EXTENSIONS = new Set(["json"]);
const RESTRIK_IMPORT_EXTENSIONS = new Set(["xlsx", "csv"]);
const RESTRIK_REQUIRED_COLUMN_GROUPS = [
  ["no_rekening_fasilitas", "no_kontrak", "nomor_kontrak"],
  ["tanggal_restrukturisasi", "tgl_restrukturisasi"],
  ["jenis_restrukturisasi", "jenis_restruk"],
  ["status"],
];
const RESTRIK_STATUS_LABELS = new Set([
  "DIAJUKAN",
  "DISETUJUI",
  "DITOLAK",
  "AKTIF",
  "SELESAI",
]);
const ACTIVE_SLIK_JOBS = new Set();
const RAW_RECORD_CHUNK_SIZE = 500;
const DEFAULT_SLIK_IMPORT_MAX_FILE_SIZE_MB = 500;
const DEFAULT_SLIK_IMPORT_MAX_ROWS = 1000000;
const DEFAULT_SLIK_IMPORT_BATCH_SIZE = 1000;
const DEFAULT_SLIK_IMPORT_MAX_ERROR_SAMPLES = 50;
const SLIK_IMPORT_TRANSACTION_OPTIONS = {
  maxWait: 10000,
  timeout: 120000,
};

function serializeJob(req, job) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    import_segment: job.import_segment || null,
    cif_status: job.cif_status || null,
    period_month: job.period_month,
    file: serializeFile(req, job, {
      module: "debtor_information",
      entityId: job.id,
      fallbackBaseName: `${job.type}-import`,
    }),
    files: Array.isArray(job.files) ? job.files : [],
    total_rows: job.total_rows,
    success_rows: job.success_rows,
    failed_rows: job.failed_rows,
    error_summary: job.error_summary,
    processing_summary: job.processing_summary,
    started_at: job.started_at,
    completed_at: job.completed_at,
    segments: Array.isArray(job.segments) ? job.segments : [],
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

function getPayloadFiles(payload) {
  if (Array.isArray(payload.files) && payload.files.length > 0) return payload.files;
  return payload.file ? [payload.file] : [];
}

function getExtension(fileName) {
  return String(fileName || "").trim().toLowerCase().split(".").pop() || "";
}

function assertImportFiles(type, files) {
  if (files.length === 0) throw new AppError("File import wajib diunggah.", 422);

  for (const file of files) {
    const extension = getExtension(file.name);
    if (type === "SLIK" && extension !== "txt") {
      throw new AppError("Import SLIK hanya menerima file TXT.", 422);
    }
    if (type === "IDEB" && !IDEB_IMPORT_EXTENSIONS.has(extension)) {
      throw new AppError("Import IDEB hanya menerima file JSON.", 422);
    }
    if (type === "RESTRIK" && !RESTRIK_IMPORT_EXTENSIONS.has(extension)) {
      throw new AppError("Import Restrukturisasi hanya menerima file XLSX atau CSV.", 422);
    }
  }
}

function normalizeSlikImportPayload(payload) {
  const importSegment = normalizeUpper(payload.import_segment);
  const cifStatus = normalizeUpper(payload.cif_status);
  const periodMonth = normalizeText(payload.period_month);

  if (!SLIK_IMPORT_SEGMENTS.has(importSegment)) {
    throw new AppError("Jenis import SLIK wajib dipilih: D01, D02, F01, atau A01.", 422);
  }

  if (importSegment === "D01" && cifStatus && cifStatus !== "I") {
    throw new AppError("Status CIF D01 harus I - Perorangan.", 422);
  }
  if (importSegment === "D02" && cifStatus && cifStatus !== "B") {
    throw new AppError("Status CIF D02 harus B - Badan Usaha/Yayasan.", 422);
  }
  if (!["D01", "D02"].includes(importSegment) && cifStatus) {
    throw new AppError("Status CIF hanya boleh diisi untuk import D01 atau D02.", 422);
  }
  if (importSegment === "F01" && !periodMonth) {
    throw new AppError("Periode Data wajib dipilih untuk import F01.", 422);
  }

  return {
    import_segment: importSegment,
    cif_status:
      importSegment === "D01" ? "I" : importSegment === "D02" ? "B" : null,
    period_month: periodMonth,
  };
}

function persistImportFiles(type, files) {
  return files.map((file) => {
    const fileMeta = persistDomainFile({
      entity: `debtor-imports/${type.toLowerCase()}`,
      input: file,
      fallbackBaseName: `${type}-import`,
    });
    if (!fileMeta) throw new AppError("File import wajib diunggah.", 422);
    return fileMeta;
  });
}

function parsePeriodParts(periodMonth) {
  const normalized = normalizeText(periodMonth);
  const match = normalized ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(normalized) : null;
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
    };
  }

  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  };
}

function readStoredFileText(fileMeta) {
  const absolutePath = resolveStoredFilePath(fileMeta.file_path);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    throw new AppError(`File import tidak ditemukan: ${fileMeta.file_name || fileMeta.file_path}`, 404);
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function parseIdebJsonFile(fileMeta) {
  const text = readStoredFileText(fileMeta);
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Root JSON harus berupa object.");
    }
    return parsed;
  } catch (error) {
    throw new AppError(`File IDEB JSON tidak valid: ${error.message}`, 422);
  }
}

function readObjectValue(source, keys) {
  if (!source || typeof source !== "object") return null;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function normalizeIdebSummary(raw) {
  const debtor = readObjectValue(raw, ["debitur", "debtor", "nasabah"]) || {};
  const summary = readObjectValue(raw, ["ringkasan", "summary", "hasil"]) || {};
  const facilities = readObjectValue(raw, ["fasilitas", "facilities", "pembiayaan"]) || [];
  const mainFacility = Array.isArray(facilities) ? facilities[0] || {} : {};

  return {
    schema_version: normalizeText(raw.schema_version || raw.version) || "ideb-v1",
    period_month: normalizeText(raw.periode || raw.period_month || raw.period),
    debtor_name: normalizeText(
      readObjectValue(debtor, ["nama", "name", "debtor_name", "nama_debitur"]),
    ),
    identity_number: normalizeText(
      readObjectValue(debtor, ["no_identitas", "identity_number", "nik", "npwp"]),
    ),
    debtor_number: normalizeText(
      readObjectValue(debtor, ["no_cif", "nomor_debitur", "debtor_number"]),
    ),
    contract_number: normalizeText(
      readObjectValue(mainFacility, [
        "no_rekening",
        "no_rekening_fasilitas",
        "no_kontrak",
        "contract_number",
      ]),
    ),
    current_collectibility: normalizeText(
      readObjectValue(summary, [
        "kolektibilitas_terburuk",
        "current_collectibility",
        "kol",
      ]) ||
        readObjectValue(mainFacility, ["kol", "collectibility", "kolektibilitas"]),
    ),
    outstanding_pokok:
      parseCurrencyNumber(
        readObjectValue(summary, ["total_baki_debet", "outstanding_pokok", "os_pokok"]) ||
          readObjectValue(mainFacility, ["baki_debet", "outstanding", "outstanding_pokok"]),
      ) || 0,
    financing_status: normalizeText(
      readObjectValue(summary, ["status_pembiayaan", "financing_status"]) ||
        readObjectValue(mainFacility, ["status", "status_pembiayaan"]),
    ),
    conclusion: normalizeText(
      readObjectValue(summary, ["kesimpulan", "conclusion", "summary"]),
    ),
    processed_at: normalizeText(raw.processed_at || raw.tanggal_proses || raw.created_at),
    other_bprs: Array.isArray(facilities)
      ? facilities.map((item) => ({
          name: normalizeText(
            readObjectValue(item, ["pelapor", "nama_bprs", "bprs", "bank", "name"]),
          ) || "-",
          collectibility: normalizeText(
            readObjectValue(item, ["kol", "collectibility", "kolektibilitas"]),
          ),
          outstanding_pokok:
            parseCurrencyNumber(
              readObjectValue(item, ["baki_debet", "outstanding", "outstanding_pokok"]),
            ) || 0,
        }))
      : [],
  };
}

function normalizeHeaderKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const RESTRIK_COLUMN_ALIASES = new Map(
  Object.entries({
    periode: "period_month",
    period: "period_month",
    period_month: "period_month",
    no_cif: "debtor_number",
    nomor_cif: "debtor_number",
    nomor_debitur: "debtor_number",
    no_debitur: "debtor_number",
    cif: "debtor_number",
    no_identitas: "identity_number",
    nomor_identitas: "identity_number",
    nik: "identity_number",
    npwp: "identity_number",
    no_rekening_fasilitas: "contract_number",
    nomor_rekening_fasilitas: "contract_number",
    no_rekening: "contract_number",
    nomor_rekening: "contract_number",
    no_kontrak: "contract_number",
    nomor_kontrak: "contract_number",
    nama_debitur: "debtor_name",
    nama_nasabah: "debtor_name",
    nama: "debtor_name",
    tanggal_restrukturisasi: "restructuring_date",
    tgl_restrukturisasi: "restructuring_date",
    tanggal_restruk: "restructuring_date",
    jenis_restrukturisasi: "restructuring_type",
    jenis_restruk: "restructuring_type",
    alasan_restrukturisasi: "reason",
    alasan_restruk: "reason",
    alasan: "reason",
    plafon_setelah_restruk: "plafond_after",
    plafond_setelah_restruk: "plafond_after",
    plafon_setelah: "plafond_after",
    os_setelah_restruk: "outstanding_after",
    outstanding_setelah_restruk: "outstanding_after",
    baki_debet_setelah_restruk: "outstanding_after",
    tenor_setelah_restruk: "tenor_after",
    tenor_setelah: "tenor_after",
    jatuh_tempo_baru: "new_due_date",
    tanggal_jatuh_tempo_baru: "new_due_date",
    kol_sebelum: "collectibility_before",
    kolektibilitas_sebelum: "collectibility_before",
    kol_setelah: "collectibility_after",
    kolektibilitas_setelah: "collectibility_after",
    status: "status",
    keterangan: "description",
    deskripsi: "description",
    catatan: "description",
  }),
);

function canonicalRestrikHeader(value) {
  const normalized = normalizeHeaderKey(value);
  return RESTRIK_COLUMN_ALIASES.get(normalized) || normalized;
}

function normalizeCellValue(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if (value.text !== undefined) return normalizeCellValue(value.text);
    if (value.result !== undefined) return normalizeCellValue(value.result);
    if (Array.isArray(value.richText)) {
      return normalizeText(value.richText.map((part) => part.text || "").join(""));
    }
    if (value.hyperlink && value.text) return normalizeCellValue(value.text);
  }
  return normalizeText(value);
}

function detectCsvDelimiter(filePath) {
  const firstLine = fs.readFileSync(filePath, "utf8").split(/\r?\n/, 1)[0] || "";
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  return semicolonCount > commaCount ? ";" : ",";
}

async function readRestrikRows(fileMeta) {
  const absolutePath = resolveStoredFilePath(fileMeta.file_path);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    throw new AppError(`File Restrukturisasi tidak ditemukan: ${fileMeta.file_name || fileMeta.file_path}`, 404);
  }

  const extension = getExtension(fileMeta.file_name || fileMeta.file_path);
  const workbook = new ExcelJS.Workbook();
  if (extension === "csv") {
    await workbook.csv.readFile(absolutePath, {
      parserOptions: { delimiter: detectCsvDelimiter(absolutePath) },
    });
  } else {
    await workbook.xlsx.readFile(absolutePath);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount < 2) {
    throw new AppError("File Restrukturisasi harus memiliki header dan minimal satu baris data.", 422);
  }

  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = canonicalRestrikHeader(normalizeCellValue(cell.value));
  });

  const headerSet = new Set(headers.filter(Boolean));
  const missingGroups = RESTRIK_REQUIRED_COLUMN_GROUPS.filter(
    (group) => !group.some((key) => headerSet.has(canonicalRestrikHeader(key))),
  );
  if (missingGroups.length > 0) {
    throw new AppError(
      `Template Restrukturisasi tidak lengkap. Kolom wajib belum ada: ${missingGroups
        .map((group) => group[0])
        .join(", ")}.`,
      422,
    );
  }

  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const raw = {};
    headers.forEach((header, colNumber) => {
      if (!header) return;
      raw[header] = normalizeCellValue(row.getCell(colNumber).value);
    });
    if (Object.values(raw).some((value) => value !== null && value !== "")) {
      rows.push({ rowNumber, raw });
    }
  });

  return rows;
}

function parseCurrencyNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value)
    .trim()
    .replace(/[^\d,.-]/g, "");
  if (!text) return null;
  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : text.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFlexibleDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = normalizeText(value);
  if (!text) return null;
  const slikDate = parseSlikDate(text);
  if (slikDate) return slikDate;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (local) return new Date(Date.UTC(Number(local[3]), Number(local[2]) - 1, Number(local[1])));
  return null;
}

function parsePositiveInt(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function buildRowHash(periodMonth, raw) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ period_month: periodMonth, raw }))
    .digest("hex");
}

async function inferIdebTargets(tx, payload, summary) {
  let debtorId = normalizeText(payload.debtor_id);
  let contractId = normalizeText(payload.contract_id);
  let contract = null;

  if (contractId) {
    contract = await tx.debtor_contracts.findFirst({
      where: { id: contractId, deleted_at: null },
      select: { id: true, debtor_id: true, no_kontrak: true },
    });
  }

  if (!contract && summary.contract_number) {
    contract = await tx.debtor_contracts.findFirst({
      where: { no_kontrak: summary.contract_number, deleted_at: null },
      select: { id: true, debtor_id: true, no_kontrak: true },
    });
    if (contract) contractId = contract.id;
  }

  if (!debtorId && contract?.debtor_id) debtorId = contract.debtor_id;
  if (!debtorId && (summary.debtor_number || summary.identity_number)) {
    const debtor = await tx.digital_debtors.findFirst({
      where: {
        deleted_at: null,
        OR: [
          summary.debtor_number ? { debtor_number: summary.debtor_number } : null,
          summary.identity_number ? { identity_number: summary.identity_number } : null,
        ].filter(Boolean),
      },
      select: { id: true },
    });
    if (debtor) debtorId = debtor.id;
  }

  return { debtorId, contractId };
}

async function resolveRestrikRowTargets(tx, raw) {
  const contractNumber = normalizeText(raw.contract_number);
  const debtorNumber = normalizeText(raw.debtor_number);
  const identityNumber = normalizeText(raw.identity_number);
  let contract = null;
  let debtor = null;

  if (contractNumber) {
    contract = await tx.debtor_contracts.findFirst({
      where: { no_kontrak: contractNumber, deleted_at: null },
      select: { id: true, debtor_id: true, no_kontrak: true },
    });
  }

  if (contract?.debtor_id) {
    debtor = await tx.digital_debtors.findFirst({
      where: { id: contract.debtor_id, deleted_at: null },
      select: { id: true, debtor_number: true, identity_number: true, name: true },
    });
  } else if (debtorNumber || identityNumber) {
    debtor = await tx.digital_debtors.findFirst({
      where: {
        deleted_at: null,
        OR: [
          debtorNumber ? { debtor_number: debtorNumber } : null,
          identityNumber ? { identity_number: identityNumber } : null,
        ].filter(Boolean),
      },
      select: { id: true, debtor_number: true, identity_number: true, name: true },
    });
  }

  return { debtor, contract };
}

function normalizeRestrikStatus(value) {
  const normalized = normalizeUpper(value) || "AKTIF";
  return RESTRIK_STATUS_LABELS.has(normalized) ? normalized : null;
}

function buildRestrikRecordData({ jobId, row, periodMonth, debtor, contract, userId }) {
  const raw = row.raw;
  const status = normalizeRestrikStatus(raw.status);
  if (!status) {
    throw new AppError(
      `Baris ${row.rowNumber}: status harus salah satu dari DIAJUKAN, DISETUJUI, DITOLAK, AKTIF, SELESAI.`,
      422,
    );
  }

  const restructuringDate = parseFlexibleDate(raw.restructuring_date);
  if (!restructuringDate) {
    throw new AppError(`Baris ${row.rowNumber}: tanggal_restrukturisasi tidak valid.`, 422);
  }

  const rowHash = buildRowHash(periodMonth, raw);
  return {
    import_job_id: jobId,
    debtor_id: debtor?.id || null,
    contract_id: contract?.id || null,
    period_month: periodMonth,
    restructuring_date: restructuringDate,
    restructuring_type: normalizeText(raw.restructuring_type),
    reason: normalizeText(raw.reason),
    plafond_after: parseCurrencyNumber(raw.plafond_after),
    outstanding_after: parseCurrencyNumber(raw.outstanding_after),
    tenor_after: parsePositiveInt(raw.tenor_after),
    new_due_date: parseFlexibleDate(raw.new_due_date),
    collectibility_before: normalizeText(raw.collectibility_before),
    collectibility_after: normalizeText(raw.collectibility_after),
    status,
    description: normalizeText(raw.description),
    raw_data: raw,
    row_hash: rowHash,
    created_by: userId || null,
    updated_by: userId || null,
    deleted_at: null,
    deleted_by: null,
  };
}

async function processRestrikRows(tx, { jobId, rows, periodMonth, userId }) {
  const imported = [];
  const errors = [];

  for (const row of rows) {
    try {
      const contractNumber = normalizeText(row.raw.contract_number);
      if (!contractNumber) {
        throw new AppError(`Baris ${row.rowNumber}: no_rekening_fasilitas/no_kontrak wajib diisi.`, 422);
      }

      const { debtor, contract } = await resolveRestrikRowTargets(tx, row.raw);
      if (!contract) {
        throw new AppError(`Baris ${row.rowNumber}: kontrak ${contractNumber} tidak ditemukan.`, 422);
      }

      const data = buildRestrikRecordData({
        jobId,
        row,
        periodMonth,
        debtor,
        contract,
        userId,
      });

      const saved = await tx.debtor_restructuring_records.upsert({
        where: {
          period_month_row_hash: {
            period_month: periodMonth,
            row_hash: data.row_hash,
          },
        },
        create: data,
        update: {
          ...data,
          updated_by: userId || null,
        },
      });
      imported.push(saved);
    } catch (error) {
      errors.push({
        row_number: row.rowNumber,
        message: error.message || "Baris Restrukturisasi gagal diproses.",
      });
    }
  }

  return { imported, errors };
}

function readPositiveIntEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readNonNegativeIntEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function getSlikImportConfig() {
  const maxFileSizeMb = readPositiveIntEnv(
    "SLIK_IMPORT_MAX_FILE_SIZE_MB",
    DEFAULT_SLIK_IMPORT_MAX_FILE_SIZE_MB,
  );

  return {
    maxFileSizeBytes: maxFileSizeMb * 1024 * 1024,
    maxRows: readNonNegativeIntEnv("SLIK_IMPORT_MAX_ROWS", DEFAULT_SLIK_IMPORT_MAX_ROWS),
    batchSize: readPositiveIntEnv(
      "SLIK_IMPORT_BATCH_SIZE",
      DEFAULT_SLIK_IMPORT_BATCH_SIZE,
    ),
    maxErrorSamples: readPositiveIntEnv(
      "SLIK_IMPORT_MAX_ERROR_SAMPLES",
      DEFAULT_SLIK_IMPORT_MAX_ERROR_SAMPLES,
    ),
  };
}

function getStoredImportFileRefs(job, config = getSlikImportConfig()) {
  const files =
    Array.isArray(job.files) && job.files.length > 0
      ? job.files
      : [
          {
            file_path: job.file_path,
            file_name: job.file_name,
            mime_type: job.mime_type,
            size_bytes: job.size_bytes,
          },
        ];

  return files.map((file) => {
    const absolutePath = resolveStoredFilePath(file.file_path);
    if (!absolutePath || !fs.existsSync(absolutePath)) {
      throw new Error(`File import tidak ditemukan di storage: ${file.file_name || file.file_path}`);
    }

    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      throw new Error(`Path import bukan file valid: ${file.file_name || file.file_path}`);
    }
    if (stat.size > config.maxFileSizeBytes) {
      throw new Error(
        `Ukuran file ${file.file_name || file.file_path} melebihi batas ${Math.round(
          config.maxFileSizeBytes / 1024 / 1024,
        )} MB.`,
      );
    }

    return {
      absolutePath,
      name: file.file_name || file.file_path,
      file_name: file.file_name || file.file_path,
      mime_type: file.mime_type,
      size_bytes: Number(file.size_bytes || stat.size),
    };
  });
}

exports.getAll = async ({ req, query }) => {
  const pagination = resolvePagination(query, PAGINATION_PROFILES.HISTORY);
  const clauses = [{ deleted_at: null }];
  if (query.type) clauses.push({ type: String(query.type).trim().toUpperCase() });
  if (query.status) clauses.push({ status: String(query.status).trim().toUpperCase() });
  if (query.period_month) clauses.push({ period_month: String(query.period_month).trim() });
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

  const files = getPayloadFiles(payload);
  assertImportFiles(normalizedType, files);
  const slikMetadata =
    normalizedType === "SLIK" ? normalizeSlikImportPayload(payload) : null;
  await ensureTargets(payload);
  const fileMetas = persistImportFiles(normalizedType, files);
  const primaryFile = fileMetas[0];
  const idebRaw = normalizedType === "IDEB" ? parseIdebJsonFile(primaryFile) : null;
  const idebSummary = idebRaw ? normalizeIdebSummary(idebRaw) : null;
  const restrikRows =
    normalizedType === "RESTRIK" ? await readRestrikRows(primaryFile) : null;
  const resolvedPeriodMonth =
    slikMetadata?.period_month ||
    normalizeText(payload.period_month) ||
    idebSummary?.period_month ||
    null;

  const job = await repository.transaction(async (tx) => {
    const created = await tx.debtor_import_jobs.create({
      data: {
        type: normalizedType,
        status:
          normalizedType === "SLIK"
            ? "PENDING"
            : normalizedType === "RESTRIK"
              ? "PROCESSING"
              : "COMPLETED",
        import_segment: slikMetadata?.import_segment || null,
        cif_status: slikMetadata?.cif_status || null,
        period_month: resolvedPeriodMonth,
        file_path: primaryFile.file_path,
        file_name: primaryFile.file_name,
        mime_type: primaryFile.mime_type,
        size_bytes: primaryFile.size_bytes,
        checksum: primaryFile.checksum,
        files: fileMetas,
        total_rows:
          normalizedType === "IDEB"
            ? 1
            : normalizedType === "RESTRIK"
              ? restrikRows.length
              : payload.total_rows || 0,
        success_rows: normalizedType === "IDEB" ? 1 : 0,
        failed_rows: 0,
        completed_at:
          normalizedType === "SLIK" || normalizedType === "RESTRIK" ? null : new Date(),
        created_by: userId || null,
      },
    });

    if (normalizedType === "IDEB") {
      const targets = await inferIdebTargets(tx, payload, idebSummary);
      const period = parsePeriodParts(resolvedPeriodMonth);
      await tx.debtor_external_records.create({
        data: {
          import_job_id: created.id,
          source_type: normalizedType,
          debtor_id: targets.debtorId,
          contract_id: targets.contractId,
          period_month: resolvedPeriodMonth,
          raw_reference: normalizeText(payload.raw_reference),
          summary: {
            format: "IDEB_JSON",
            raw: idebRaw,
            parsed: idebSummary,
          },
          file_path: primaryFile.file_path,
          file_name: primaryFile.file_name,
          mime_type: primaryFile.mime_type,
          size_bytes: primaryFile.size_bytes,
          status: targets.debtorId || targets.contractId ? "MATCHED" : "MATCH_PENDING",
          created_by: userId || null,
        },
      });
      await tx.debtor_ideb_uploads.create({
        data: {
          debtor_id: targets.debtorId,
          contract_id: targets.contractId,
          month: period.month,
          year: period.year,
          status: "CHECKED",
          result_summary: {
            ...idebSummary,
            raw_reference: normalizeText(payload.raw_reference),
          },
          file_path: primaryFile.file_path,
          file_name: primaryFile.file_name,
          mime_type: primaryFile.mime_type,
          size_bytes: primaryFile.size_bytes,
          checksum: primaryFile.checksum,
          uploaded_by: userId || null,
          created_by: userId || null,
        },
      });
    }

    if (normalizedType === "RESTRIK") {
      const result = await processRestrikRows(tx, {
        jobId: created.id,
        rows: restrikRows,
        periodMonth: resolvedPeriodMonth,
        userId,
      });
      const successRows = result.imported.length;
      const failedRows = result.errors.length;
      const status =
        successRows > 0
          ? failedRows > 0
            ? "COMPLETED_WITH_ERRORS"
            : "COMPLETED"
          : "FAILED";
      const summary = {
        format: "RESTRIK_XLSX_CSV",
        total_rows: restrikRows.length,
        success_rows: successRows,
        failed_rows: failedRows,
        error_samples: result.errors.slice(0, 20),
      };

      await tx.debtor_external_records.create({
        data: {
          import_job_id: created.id,
          source_type: normalizedType,
          period_month: resolvedPeriodMonth,
          raw_reference: normalizeText(payload.raw_reference),
          summary,
          file_path: primaryFile.file_path,
          file_name: primaryFile.file_name,
          mime_type: primaryFile.mime_type,
          size_bytes: primaryFile.size_bytes,
          status,
          created_by: userId || null,
        },
      });

      await tx.debtor_import_jobs.update({
        where: { id: created.id },
        data: {
          status,
          total_rows: restrikRows.length,
          success_rows: successRows,
          failed_rows: failedRows,
          error_summary: result.errors.length > 0 ? result.errors.slice(0, 20) : undefined,
          processing_summary: summary,
          completed_at: new Date(),
          updated_by: userId || null,
        },
      });
    }

    return tx.debtor_import_jobs.findUnique({
      where: { id: created.id },
      include: {
        records: true,
        segments: true,
      },
    });
  });

  if (normalizedType === "SLIK") {
    await scheduleSlikJob(job.id, userId);
  }

  return serializeJob(req, job);
};

function createImportContext() {
  return {
    branches: new Map(),
    products: new Map(),
    contractTypes: new Map(),
    collectibilities: new Map(),
    debtorsByNumber: new Map(),
    debtorsByIdentity: new Map(),
    contractsByNumber: new Map(),
    collateralsByKey: new Map(),
  };
}

function cacheDebtor(context, debtor) {
  if (!context || !debtor) return debtor;
  if (debtor.debtor_number) context.debtorsByNumber.set(debtor.debtor_number, debtor);
  if (debtor.identity_number) context.debtorsByIdentity.set(debtor.identity_number, debtor);
  return debtor;
}

function cacheContract(context, contract) {
  if (!context || !contract?.no_kontrak) return contract;
  context.contractsByNumber.set(contract.no_kontrak, contract);
  return contract;
}

function collateralCacheKey(collateralNumber, facilityNumber) {
  return `${normalizeText(collateralNumber) || ""}::${normalizeText(facilityNumber) || ""}`;
}

function cacheCollateral(context, collateral) {
  if (!context || !collateral) return collateral;
  context.collateralsByKey.set(
    collateralCacheKey(collateral.collateral_number, collateral.facility_number),
    collateral,
  );
  return collateral;
}

async function findOrCreateBranch(tx, code, context = null) {
  const normalizedCode = normalizeText(code);
  if (!normalizedCode) return null;
  if (context?.branches.has(normalizedCode)) return context.branches.get(normalizedCode);

  const branch = await tx.branches.upsert({
    where: { code: normalizedCode },
    update: {},
    create: {
      code: normalizedCode,
      name: `Kode Cabang SLIK ${normalizedCode}`,
      is_active: true,
    },
  });
  if (context) context.branches.set(normalizedCode, branch);
  return branch;
}

async function findOrCreateProduct(tx, code, context = null) {
  const normalizedCode = normalizeUpper(code) || "SLIK_UNKNOWN";
  const codeValue = `SLIK_${normalizedCode}`.slice(0, 100);
  if (context?.products.has(codeValue)) return context.products.get(codeValue);

  const product = await tx.financing_products.upsert({
    where: { code: codeValue },
    update: {},
    create: {
      code: codeValue,
      name: `Kode Produk SLIK ${normalizedCode}`,
      description: "Dibuat dari kode referensi pada file SLIK. Lengkapi nama jika diperlukan.",
      is_active: true,
    },
  });
  if (context) context.products.set(codeValue, product);
  return product;
}

async function findOrCreateContractType(tx, code, context = null) {
  const normalizedCode = normalizeUpper(code) || "SLIK_UNKNOWN";
  const codeValue = `SLIK_${normalizedCode}`.slice(0, 100);
  if (context?.contractTypes.has(codeValue)) return context.contractTypes.get(codeValue);

  const contractType = await tx.contract_types.upsert({
    where: { code: codeValue },
    update: {},
    create: {
      code: codeValue,
      name: `Kode Akad SLIK ${normalizedCode}`,
      description: "Dibuat dari kode referensi pada file SLIK. Lengkapi nama jika diperlukan.",
      is_active: true,
    },
  });
  if (context) context.contractTypes.set(codeValue, contractType);
  return contractType;
}

async function findOrCreateCollectibility(tx, level, context = null) {
  const normalizedLevel = Number.isFinite(Number(level)) ? Number(level) : 1;
  if (context?.collectibilities.has(normalizedLevel)) {
    return context.collectibilities.get(normalizedLevel);
  }

  const existing = await tx.collectibility_levels.findUnique({
    where: { level: normalizedLevel },
  });
  if (existing) {
    if (context) context.collectibilities.set(normalizedLevel, existing);
    return existing;
  }

  const collectibility = await tx.collectibility_levels.create({
    data: {
      code: `KOL_${normalizedLevel}`,
      level: normalizedLevel,
      name: `Kolektibilitas ${normalizedLevel}`,
      is_npf: normalizedLevel >= 3,
      is_active: true,
    },
  });
  if (context) context.collectibilities.set(normalizedLevel, collectibility);
  return collectibility;
}

function compactData(data) {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  );
}

function normalizeSlikDate(value) {
  return parseSlikDate(value);
}

function individualProfileData(summary) {
  const profile = summary.profile || {};
  return compactData({
    identity_type_code: normalizeText(profile.identity_type_code),
    name_as_identity: normalizeText(profile.name_as_identity),
    full_name: normalizeText(profile.full_name),
    education_degree_code: normalizeText(profile.education_degree_code),
    gender: normalizeText(profile.gender),
    birth_place: normalizeText(profile.birth_place),
    birth_date: normalizeSlikDate(profile.birth_date),
    tax_number: normalizeText(profile.tax_number),
    address_detail: normalizeText(profile.address_detail),
    village: normalizeText(profile.village),
    district: normalizeText(profile.district),
    city_code: normalizeText(profile.city_code),
    postal_code: normalizeText(profile.postal_code),
    phone: normalizeText(profile.phone),
    mobile_phone: normalizeText(profile.mobile_phone),
    email: normalizeText(profile.email),
    domicile_country_code: normalizeText(profile.domicile_country_code),
    occupation_code: normalizeText(profile.occupation_code),
    workplace: normalizeText(profile.workplace),
    workplace_business_field_code: normalizeText(profile.workplace_business_field_code),
    workplace_address: normalizeText(profile.workplace_address),
    annual_gross_income: profile.annual_gross_income || 0,
    income_source_code: normalizeText(profile.income_source_code),
    dependent_count: Number(profile.dependent_count || 0),
    relationship_with_reporter_code: normalizeText(profile.relationship_with_reporter_code),
    debtor_group_code: normalizeText(profile.debtor_group_code),
    marital_status_code: normalizeText(profile.marital_status_code),
    spouse_identity_number: normalizeText(profile.spouse_identity_number),
    spouse_name: normalizeText(profile.spouse_name),
    spouse_birth_date: normalizeSlikDate(profile.spouse_birth_date),
    separate_assets_agreement: normalizeText(profile.separate_assets_agreement),
    violates_bmpk: normalizeText(profile.violates_bmpk),
    exceeds_bmpk: normalizeText(profile.exceeds_bmpk),
    mother_maiden_name: normalizeText(profile.mother_maiden_name),
    branch_code: normalizeText(profile.branch_code),
    operation_code: normalizeUpper(profile.operation_code),
    status_code: normalizeUpper(profile.status_code) || "I",
  });
}

function legalEntityProfileData(summary) {
  const profile = summary.profile || {};
  return compactData({
    business_identity_number: normalizeText(profile.business_identity_number),
    business_name: normalizeText(profile.business_name),
    legal_form_code: normalizeText(profile.legal_form_code),
    establishment_place: normalizeText(profile.establishment_place),
    establishment_deed_number: normalizeText(profile.establishment_deed_number),
    establishment_deed_date: normalizeSlikDate(profile.establishment_deed_date),
    latest_amendment_deed_number: normalizeText(profile.latest_amendment_deed_number),
    latest_amendment_deed_date: normalizeSlikDate(profile.latest_amendment_deed_date),
    phone: normalizeText(profile.phone),
    mobile_phone: normalizeText(profile.mobile_phone),
    email: normalizeText(profile.email),
    address_detail: normalizeText(profile.address_detail),
    village: normalizeText(profile.village),
    district: normalizeText(profile.district),
    city_code: normalizeText(profile.city_code),
    postal_code: normalizeText(profile.postal_code),
    domicile_country_code: normalizeText(profile.domicile_country_code),
    business_field_code: normalizeText(profile.business_field_code),
    relationship_with_reporter_code: normalizeText(profile.relationship_with_reporter_code),
    violates_bmpk: normalizeText(profile.violates_bmpk),
    exceeds_bmpk: normalizeText(profile.exceeds_bmpk),
    go_public: normalizeText(profile.go_public),
    debtor_group_code: normalizeText(profile.debtor_group_code),
    rating: normalizeText(profile.rating),
    rating_agency: normalizeText(profile.rating_agency),
    rating_date: normalizeSlikDate(profile.rating_date),
    debtor_group_name: normalizeText(profile.debtor_group_name),
    branch_code: normalizeText(profile.branch_code),
    operation_code: normalizeUpper(profile.operation_code),
    status_code: normalizeUpper(profile.status_code) || "B",
  });
}

async function upsertDebtorProfile(tx, debtor, summary, userId) {
  if (summary.customer_type === "INDIVIDUAL") {
    const data = individualProfileData(summary);
    await tx.debtor_individual_profiles.upsert({
      where: { debtor_id: debtor.id },
      update: {
        ...data,
        updated_by: userId || null,
      },
      create: {
        ...data,
        debtor_id: debtor.id,
        created_by: userId || null,
      },
    });
  }

  if (summary.customer_type === "LEGAL_ENTITY") {
    const data = legalEntityProfileData(summary);
    await tx.debtor_legal_entity_profiles.upsert({
      where: { debtor_id: debtor.id },
      update: {
        ...data,
        updated_by: userId || null,
      },
      create: {
        ...data,
        debtor_id: debtor.id,
        created_by: userId || null,
      },
    });
  }
}

async function upsertDebtor(tx, summary, userId, context = null) {
  const debtorNumber = normalizeText(summary.debtor_number);
  const identityNumber = normalizeText(summary.identity_number);
  const clauses = [];
  if (debtorNumber) clauses.push({ debtor_number: debtorNumber });
  if (identityNumber) clauses.push({ identity_number: identityNumber });
  if (clauses.length === 0) throw new Error("Nomor debitur atau identitas debitur kosong.");

  const branch = await findOrCreateBranch(tx, summary.branch_code, context);
  const cached =
    (debtorNumber && context?.debtorsByNumber.get(debtorNumber)) ||
    (identityNumber && context?.debtorsByIdentity.get(identityNumber));
  const existing =
    cached ||
    (await tx.digital_debtors.findFirst({
      where: {
        OR: clauses,
      },
    }));
  const name = normalizeText(summary.name) || `Debitur ${debtorNumber || identityNumber}`;
  const data = compactData({
    debtor_number: debtorNumber,
    identity_number: identityNumber,
    name,
    address: normalizeText(summary.address),
    phone: normalizeText(summary.phone),
    branch_id: branch?.id,
    customer_type: normalizeUpper(summary.customer_type),
    slik_segment: normalizeUpper(summary.slik_segment),
    slik_status_code: normalizeUpper(summary.slik_status_code),
    slik_operation_code: normalizeUpper(summary.slik_operation_code),
    status: "ACTIVE",
    deleted_at: null,
    deleted_by: null,
  });

  if (existing) {
    const debtor = await tx.digital_debtors.update({
      where: { id: existing.id },
      data: {
        ...data,
        updated_by: userId || null,
      },
    });
    await upsertDebtorProfile(tx, debtor, summary, userId);
    return cacheDebtor(context, debtor);
  }

  const debtor = await tx.digital_debtors.create({
    data: {
      ...data,
      created_by: userId || null,
    },
  });
  await upsertDebtorProfile(tx, debtor, summary, userId);
  return cacheDebtor(context, debtor);
}

async function findDebtorByNumber(tx, debtorNumber, context = null) {
  const normalized = normalizeText(debtorNumber);
  if (!normalized) return null;
  if (context?.debtorsByNumber.has(normalized)) {
    return context.debtorsByNumber.get(normalized);
  }
  const debtor = await tx.digital_debtors.findFirst({
    where: {
      debtor_number: normalized,
      deleted_at: null,
    },
  });
  return cacheDebtor(context, debtor);
}

async function upsertContract(tx, summary, debtor, periodMonth, userId, context = null) {
  const noKontrak = normalizeText(summary.contract_number);
  if (!noKontrak) throw new Error("Nomor kontrak/fasilitas kosong.");
  const product = await findOrCreateProduct(tx, summary.product_code, context);
  const akadType = await findOrCreateContractType(tx, summary.akad_code, context);
  const branch = await findOrCreateBranch(tx, summary.branch_code, context);
  const outstandingPokok = summary.outstanding_pokok || 0;
  const outstandingMargin = summary.outstanding_margin || 0;
  const akadDate =
    parseSlikDate(summary.akad_date) || defaultDateForPeriod(periodMonth);
  const dueDate = parseSlikDate(summary.due_date);
  const existing =
    context?.contractsByNumber.get(noKontrak) ||
    (await tx.debtor_contracts.findFirst({
      where: {
        no_kontrak: noKontrak,
      },
    }));
  const data = compactData({
    no_kontrak: noKontrak,
    debtor_id: debtor.id,
    product_id: product.id,
    akad_type_id: akadType.id,
    branch_id: branch?.id || debtor.branch_id || null,
    marketing_user_id: debtor.marketing_user_id || null,
    tanggal_akad: akadDate,
    tanggal_jatuh_tempo: dueDate,
    plafond: summary.plafond || 0,
    pokok: summary.pokok || 0,
    margin: summary.margin || 0,
    tenor: Math.max(Number(summary.tenor || 1), 1),
    outstanding_pokok: outstandingPokok,
    outstanding_margin: outstandingMargin,
    status: outstandingPokok + outstandingMargin > 0 ? "ACTIVE" : "CLOSED",
    objek_pembiayaan: normalizeText(summary.object_description),
    deleted_at: null,
    deleted_by: null,
  });

  if (existing) {
    const contract = await tx.debtor_contracts.update({
      where: { id: existing.id },
      data: {
        ...data,
        updated_by: userId || null,
      },
    });
    return cacheContract(context, contract);
  }

  const contract = await tx.debtor_contracts.create({
    data: {
      ...data,
      created_by: userId || null,
    },
  });
  return cacheContract(context, contract);
}

async function upsertCollectibility(tx, summary, contract, periodMonth, userId, context = null) {
  const kolLevel = await findOrCreateCollectibility(
    tx,
    summary.collectibility_level,
    context,
  );
  return tx.debtor_collectibilities.upsert({
    where: {
      contract_id_period_month: {
        contract_id: contract.id,
        period_month: periodMonth,
      },
    },
    update: {
      kol_level_id: kolLevel.id,
      outstanding_pokok: summary.outstanding_pokok || 0,
      outstanding_margin: summary.outstanding_margin || 0,
      dpd: summary.dpd || 0,
      notes: "Update otomatis dari Import SLIK.",
      updated_by: userId || null,
      deleted_at: null,
      deleted_by: null,
    },
    create: {
      contract_id: contract.id,
      period_month: periodMonth,
      kol_level_id: kolLevel.id,
      outstanding_pokok: summary.outstanding_pokok || 0,
      outstanding_margin: summary.outstanding_margin || 0,
      dpd: summary.dpd || 0,
      notes: "Import SLIK.",
      created_by: userId || null,
    },
  });
}

async function upsertContractSnapshot(tx, summary, contract, periodMonth, userId, fields) {
  const facilityNumber = normalizeText(summary.facility_number) || contract.no_kontrak;
  const data = compactData({
    debtor_id: contract.debtor_id,
    contract_id: contract.id,
    period_month: periodMonth,
    facility_number: facilityNumber,
    debtor_number: normalizeText(summary.debtor_number),
    credit_nature_code: normalizeText(summary.credit_nature_code),
    credit_type_code: normalizeText(summary.credit_type_code),
    financing_scheme_code: normalizeText(summary.financing_scheme_code),
    initial_akad_number: normalizeText(summary.initial_akad_number),
    initial_akad_date: normalizeSlikDate(summary.initial_akad_date),
    final_akad_number: normalizeText(summary.final_akad_number),
    final_akad_date: normalizeSlikDate(summary.final_akad_date),
    new_or_extension_code: normalizeText(summary.new_or_extension_code),
    credit_start_date: normalizeSlikDate(summary.credit_start_date),
    start_date: normalizeSlikDate(summary.start_date),
    due_date: normalizeSlikDate(summary.due_date),
    debtor_category_code: normalizeText(summary.debtor_category_code),
    usage_type_code: normalizeText(summary.usage_type_code),
    usage_orientation_code: normalizeText(summary.usage_orientation_code),
    economic_sector_code: normalizeText(summary.economic_sector_code),
    project_location_city_code: normalizeText(summary.project_location_city_code),
    project_value: summary.project_value,
    currency_code: normalizeText(summary.currency_code),
    interest_rate: summary.interest_rate,
    interest_type_code: normalizeText(summary.interest_type_code),
    government_program_code: normalizeText(summary.government_program_code),
    takeover_from: normalizeText(summary.takeover_from),
    source_of_funds_code: normalizeText(summary.source_of_funds_code),
    initial_plafond: summary.initial_plafond,
    plafond: summary.plafond,
    current_month_disbursement: summary.current_month_disbursement,
    penalty: summary.penalty,
    baki_debet: summary.baki_debet,
    original_currency_amount: summary.original_currency_amount,
    collectibility_code: normalizeText(summary.collectibility_code),
    default_date: normalizeSlikDate(summary.default_date),
    default_reason_code: normalizeText(summary.default_reason_code),
    principal_arrears: summary.principal_arrears,
    margin_arrears: summary.margin_arrears,
    days_past_due: summary.days_past_due,
    arrears_frequency: summary.arrears_frequency,
    restructuring_frequency: summary.restructuring_frequency,
    initial_restructuring_date: normalizeSlikDate(summary.initial_restructuring_date),
    final_restructuring_date: normalizeSlikDate(summary.final_restructuring_date),
    restructuring_method_code: normalizeText(summary.restructuring_method_code),
    condition_code: normalizeText(summary.condition_code),
    condition_date: normalizeSlikDate(summary.condition_date),
    description: normalizeText(summary.description),
    branch_code: normalizeText(summary.branch_code),
    operation_code: normalizeUpper(summary.operation_code),
    raw_data: { fields, summary },
    deleted_at: null,
    deleted_by: null,
  });

  return tx.debtor_contract_slik_snapshots.upsert({
    where: {
      facility_number_period_month: {
        facility_number: facilityNumber,
        period_month: periodMonth,
      },
    },
    update: {
      ...data,
      updated_by: userId || null,
    },
    create: {
      ...data,
      created_by: userId || null,
    },
  });
}

async function applyCollateral(tx, summary, periodMonth, userId, fields = null, context = null) {
  const facilityNumber = normalizeText(summary.facility_number);
  const collateralNumber = normalizeText(summary.collateral_number);
  if (!collateralNumber) return { contract: null, collateral: null };

  const contract = facilityNumber
    ? context?.contractsByNumber.get(facilityNumber) ||
      (await tx.debtor_contracts.findFirst({
          where: {
            no_kontrak: facilityNumber,
            deleted_at: null,
          },
        }))
    : null;
  cacheContract(context, contract);
  const debtor =
    !contract && summary.debtor_number
      ? await findDebtorByNumber(tx, summary.debtor_number, context)
      : null;

  const collateralText = [
    summary.collateral_type,
    summary.proof_number,
    summary.owner_name,
    summary.description,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(" | ");

  const collateralData = compactData({
    debtor_id: contract?.debtor_id || debtor?.id || null,
    contract_id: contract?.id || null,
    collateral_number: collateralNumber,
    facility_number: facilityNumber,
    facility_segment_code: normalizeText(summary.facility_segment_code),
    collateral_status_code: normalizeText(summary.collateral_status_code),
    collateral_type: normalizeText(summary.collateral_type),
    rating: normalizeText(summary.rating),
    rating_agency_code: normalizeText(summary.rating_agency_code),
    binding_type_code: normalizeText(summary.binding_type_code),
    binding_date: normalizeSlikDate(summary.binding_date),
    owner_name: normalizeText(summary.owner_name),
    proof_number: normalizeText(summary.proof_number),
    address: normalizeText(summary.address),
    location_city_code: normalizeText(summary.location_city_code),
    market_value: summary.market_value,
    appraisal_value: summary.appraisal_value,
    reporter_appraisal_date: normalizeSlikDate(summary.reporter_appraisal_date),
    independent_appraisal_value: summary.independent_appraisal_value,
    independent_appraiser_name: normalizeText(summary.independent_appraiser_name),
    independent_appraisal_date: normalizeSlikDate(summary.independent_appraisal_date),
    paripasu_status: normalizeText(summary.paripasu_status),
    paripasu_percentage: summary.paripasu_percentage,
    joint_credit_status: normalizeText(summary.joint_credit_status),
    insured_status: normalizeText(summary.insured_status),
    description: normalizeText(summary.description),
    branch_code: normalizeText(summary.branch_code),
    operation_code: normalizeUpper(summary.operation_code),
    period_month: periodMonth,
    last_import_period_month: periodMonth,
    raw_data: { fields, summary },
    deleted_at: null,
    deleted_by: null,
  });

  const cacheKey = collateralCacheKey(collateralNumber, facilityNumber);
  const existingCollateral =
    context?.collateralsByKey.get(cacheKey) ||
    (await tx.debtor_collaterals.findFirst({
      where: {
        collateral_number: collateralNumber,
        facility_number: facilityNumber,
        deleted_at: null,
      },
    }));
  const collateral = existingCollateral
    ? await tx.debtor_collaterals.update({
        where: { id: existingCollateral.id },
        data: {
          ...collateralData,
          updated_by: userId || null,
        },
      })
    : await tx.debtor_collaterals.create({
        data: {
      ...collateralData,
      created_by: userId || null,
        },
      });
  cacheCollateral(context, collateral);

  if (!contract || !collateralText) return { contract, collateral };

  const existingAgunan = normalizeText(contract.agunan);
  const nextAgunan =
    existingAgunan && existingAgunan.includes(collateralText)
      ? existingAgunan
      : [existingAgunan, collateralText].filter(Boolean).join("\n");

  const updatedContract = await tx.debtor_contracts.update({
    where: { id: contract.id },
    data: {
      agunan: nextAgunan,
      updated_by: userId || null,
    },
  });

  return { contract: updatedContract, collateral };
}

async function createRawRecords(tx, rawRecords) {
  for (let index = 0; index < rawRecords.length; index += RAW_RECORD_CHUNK_SIZE) {
    const now = new Date();
    const chunk = rawRecords
      .slice(index, index + RAW_RECORD_CHUNK_SIZE)
      .map((record) => ({ ...record, updated_at: now }));
    if (chunk.length === 0) continue;
    await tx.debtor_slik_records.createMany({ data: chunk });
  }
}

function rawKeyForRow(segment, summary) {
  if (["D01", "D02"].includes(segment)) {
    return summary.debtor_number || summary.identity_number || null;
  }
  if (["F01", "F02", "F06"].includes(segment)) {
    return summary.contract_number || summary.facility_number || null;
  }
  if (segment === "A01") return summary.collateral_number || summary.facility_number || null;
  return summary.raw_key || null;
}

function uniqueText(values) {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
}

async function prefetchRows(tx, segmentCode, rows, context) {
  if (!context || !Array.isArray(rows) || rows.length === 0) return;

  if (["D01", "D02"].includes(segmentCode)) {
    const debtorNumbers = uniqueText(rows.map((row) => row.summary.debtor_number));
    const identityNumbers = uniqueText(rows.map((row) => row.summary.identity_number));
    const clauses = [];
    if (debtorNumbers.length > 0) clauses.push({ debtor_number: { in: debtorNumbers } });
    if (identityNumbers.length > 0) clauses.push({ identity_number: { in: identityNumbers } });
    if (clauses.length === 0) return;

    const debtors = await tx.digital_debtors.findMany({
      where: { OR: clauses },
    });
    debtors.forEach((debtor) => cacheDebtor(context, debtor));
    return;
  }

  if (segmentCode === "F01") {
    const debtorNumbers = uniqueText(rows.map((row) => row.summary.debtor_number));
    const contractNumbers = uniqueText(rows.map((row) => row.summary.contract_number));

    if (debtorNumbers.length > 0) {
      const debtors = await tx.digital_debtors.findMany({
        where: {
          debtor_number: { in: debtorNumbers },
          deleted_at: null,
        },
      });
      debtors.forEach((debtor) => cacheDebtor(context, debtor));
    }

    if (contractNumbers.length > 0) {
      const contracts = await tx.debtor_contracts.findMany({
        where: {
          no_kontrak: { in: contractNumbers },
          deleted_at: null,
        },
      });
      contracts.forEach((contract) => cacheContract(context, contract));
    }
    return;
  }

  if (segmentCode === "A01") {
    const facilityNumbers = uniqueText(rows.map((row) => row.summary.facility_number));
    const debtorNumbers = uniqueText(rows.map((row) => row.summary.debtor_number));
    const collateralNumbers = uniqueText(rows.map((row) => row.summary.collateral_number));

    if (facilityNumbers.length > 0) {
      const contracts = await tx.debtor_contracts.findMany({
        where: {
          no_kontrak: { in: facilityNumbers },
          deleted_at: null,
        },
      });
      contracts.forEach((contract) => cacheContract(context, contract));
    }

    if (debtorNumbers.length > 0) {
      const debtors = await tx.digital_debtors.findMany({
        where: {
          debtor_number: { in: debtorNumbers },
          deleted_at: null,
        },
      });
      debtors.forEach((debtor) => cacheDebtor(context, debtor));
    }

    if (collateralNumbers.length > 0) {
      const where = {
        collateral_number: { in: collateralNumbers },
        deleted_at: null,
      };
      if (facilityNumbers.length > 0) where.facility_number = { in: facilityNumbers };
      const collaterals = await tx.debtor_collaterals.findMany({ where });
      collaterals.forEach((collateral) => cacheCollateral(context, collateral));
    }
  }
}

function createImportProgress(job, config) {
  return {
    periodMonth: normalizeText(job.period_month),
    importSegment: normalizeUpper(job.import_segment),
    cifStatus: normalizeUpper(job.cif_status),
    totalRows: 0,
    processedRows: 0,
    successRows: 0,
    failedRows: 0,
    errorTotal: 0,
    errorSamples: [],
    maxErrorSamples: config.maxErrorSamples,
    currentFile: null,
    currentSegment: null,
    currentRow: 0,
    segments: [],
    segmentMap: new Map(),
    segmentFailures: new Map(),
    stats: {
      debtors: 0,
      contracts: 0,
      contract_snapshots: 0,
      collectibilities: 0,
      collaterals: 0,
      raw_records: 0,
    },
  };
}

function getPublicProgress(progress) {
  return {
    period_month: progress.periodMonth,
    import_segment: progress.importSegment,
    cif_status: progress.cifStatus,
    current_file: progress.currentFile,
    current_segment: progress.currentSegment,
    current_row: progress.currentRow,
    processed_rows: progress.processedRows,
    total_rows: progress.totalRows,
    success_rows: progress.successRows,
    failed_rows: progress.failedRows,
    segments: progress.segments,
    imported: progress.stats,
  };
}

function addProgressErrors(progress, errors) {
  for (const error of errors) {
    progress.errorTotal += 1;
    if (progress.errorSamples.length < progress.maxErrorSamples) {
      progress.errorSamples.push(error);
    }
  }
}

async function updateJobProgress(jobId, progress) {
  await repository.prisma.debtor_import_jobs.update({
    where: { id: jobId },
    data: {
      import_segment: progress.importSegment,
      cif_status: progress.cifStatus,
      period_month: progress.periodMonth,
      total_rows: progress.totalRows,
      success_rows: progress.successRows,
      failed_rows: progress.failedRows,
      processing_summary: getPublicProgress(progress),
      error_summary:
        progress.errorTotal > 0
          ? {
              total: progress.errorTotal,
              samples: progress.errorSamples,
            }
          : null,
    },
  });
}

function addSegmentProgress(progress, segment) {
  const key = `${segment.segment}::${segment.file_name}`;
  progress.currentFile = segment.file_name;
  progress.currentSegment = segment.segment;
  progress.currentRow = 0;
  if (!progress.periodMonth) progress.periodMonth = segment.period_month;
  if (progress.periodMonth !== segment.period_month) {
    throw new Error(
      `Periode file ${segment.file_name} (${segment.period_month}) tidak sama dengan job ${progress.periodMonth}.`,
    );
  }

  progress.totalRows += Number(segment.declared_rows || 0);
  const item = {
    segment: segment.segment,
    file_name: segment.file_name,
    declared_rows: Number(segment.declared_rows || 0),
    actual_rows: 0,
    status: "PROCESSING",
  };
  progress.segmentMap.set(key, item);
  progress.segments = [...progress.segmentMap.values()];
  return item;
}

async function upsertImportSegment(tx, jobId, segment) {
  return tx.debtor_import_segments.upsert({
    where: {
      import_job_id_segment_file_name: {
        import_job_id: jobId,
        segment: segment.segment,
        file_name: segment.file_name,
      },
    },
    update: {
      sequence: segment.sequence,
      declared_rows: Number(segment.declared_rows || 0),
      actual_rows: 0,
      status: "PROCESSING",
      error_summary: null,
    },
    create: {
      import_job_id: jobId,
      segment: segment.segment,
      file_name: segment.file_name,
      sequence: segment.sequence,
      declared_rows: Number(segment.declared_rows || 0),
      actual_rows: 0,
      status: "PROCESSING",
    },
  });
}

async function updateImportSegmentProgress(tx, jobId, segment, progressItem, status = "PROCESSING") {
  if (progressItem) {
    progressItem.actual_rows = Number(segment.actual_rows || 0);
    progressItem.status = status;
  }

  return tx.debtor_import_segments.update({
    where: {
      import_job_id_segment_file_name: {
        import_job_id: jobId,
        segment: segment.segment,
        file_name: segment.file_name,
      },
    },
    data: {
      actual_rows: Number(segment.actual_rows || 0),
      status,
    },
  });
}

async function processRowsChunk({ tx, job, segment, rows, periodMonth, userId, context }) {
  const stats = {
    debtors: 0,
    contracts: 0,
    contract_snapshots: 0,
    collectibilities: 0,
    collaterals: 0,
    raw_records: 0,
  };
  const rawRecords = [];
  const errors = [];
  let successRows = 0;
  let failedRows = 0;

  await prefetchRows(tx, segment.segment, rows, context);

  for (const row of rows) {
    if (["D01", "D02"].includes(segment.segment)) {
      try {
        const debtor = await upsertDebtor(tx, row.summary, userId, context);
        stats.debtors += 1;
        successRows += 1;
        rawRecords.push({
          import_job_id: job.id,
          segment: segment.segment,
          period_month: periodMonth,
          row_number: row.row_number,
          raw_key: rawKeyForRow(segment.segment, row.summary),
          raw_data: { fields: row.fields, summary: row.summary },
          debtor_id: debtor.id,
          status: "IMPORTED",
        });
      } catch (error) {
        failedRows += 1;
        const message = error.message || "Gagal memproses debitur.";
        errors.push({ file: segment.file_name, row: row.row_number, message });
        rawRecords.push({
          import_job_id: job.id,
          segment: segment.segment,
          period_month: periodMonth,
          row_number: row.row_number,
          raw_key: rawKeyForRow(segment.segment, row.summary),
          raw_data: { fields: row.fields, summary: row.summary },
          status: "FAILED",
          error_message: message,
        });
      }
      continue;
    }

    if (segment.segment === "F01") {
      try {
        const debtorNumber = row.summary.debtor_number;
        const debtor = await findDebtorByNumber(tx, debtorNumber, context);
        if (!debtor) throw new Error(`Debitur ${debtorNumber || "-"} tidak ditemukan.`);
        const contract = await upsertContract(
          tx,
          row.summary,
          debtor,
          periodMonth,
          userId,
          context,
        );
        await upsertCollectibility(tx, row.summary, contract, periodMonth, userId, context);
        await upsertContractSnapshot(tx, row.summary, contract, periodMonth, userId, row.fields);
        stats.contracts += 1;
        stats.contract_snapshots += 1;
        stats.collectibilities += 1;
        successRows += 1;
        rawRecords.push({
          import_job_id: job.id,
          segment: segment.segment,
          period_month: periodMonth,
          row_number: row.row_number,
          raw_key: rawKeyForRow(segment.segment, row.summary),
          raw_data: { fields: row.fields, summary: row.summary },
          debtor_id: debtor.id,
          contract_id: contract.id,
          status: "IMPORTED",
        });
      } catch (error) {
        failedRows += 1;
        const message = error.message || "Gagal memproses fasilitas.";
        errors.push({ file: segment.file_name, row: row.row_number, message });
        rawRecords.push({
          import_job_id: job.id,
          segment: segment.segment,
          period_month: periodMonth,
          row_number: row.row_number,
          raw_key: rawKeyForRow(segment.segment, row.summary),
          raw_data: { fields: row.fields, summary: row.summary },
          status: "FAILED",
          error_message: message,
        });
      }
      continue;
    }

    if (segment.segment === "A01") {
      try {
        const { contract, collateral } = await applyCollateral(
          tx,
          row.summary,
          periodMonth,
          userId,
          row.fields,
          context,
        );
        stats.collaterals += collateral ? 1 : 0;
        successRows += 1;
        rawRecords.push({
          import_job_id: job.id,
          segment: segment.segment,
          period_month: periodMonth,
          row_number: row.row_number,
          raw_key: rawKeyForRow(segment.segment, row.summary),
          raw_data: { fields: row.fields, summary: row.summary },
          debtor_id: collateral?.debtor_id || null,
          contract_id: contract?.id || null,
          status: contract ? "IMPORTED" : "MATCH_PENDING",
          error_message: contract ? null : "Kontrak fasilitas agunan belum ditemukan.",
        });
      } catch (error) {
        failedRows += 1;
        const message = error.message || "Gagal memproses agunan.";
        errors.push({ file: segment.file_name, row: row.row_number, message });
        rawRecords.push({
          import_job_id: job.id,
          segment: segment.segment,
          period_month: periodMonth,
          row_number: row.row_number,
          raw_key: rawKeyForRow(segment.segment, row.summary),
          raw_data: { fields: row.fields, summary: row.summary },
          status: "FAILED",
          error_message: message,
        });
      }
    }
  }

  await createRawRecords(tx, rawRecords);
  stats.raw_records = rawRecords.length;

  return {
    successRows,
    failedRows,
    errors,
    stats,
  };
}

function mergeChunkResult(progress, result, segment) {
  progress.processedRows += result.successRows + result.failedRows;
  progress.successRows += result.successRows;
  progress.failedRows += result.failedRows;
  progress.currentFile = segment.file_name;
  progress.currentSegment = segment.segment;
  progress.currentRow = Number(segment.actual_rows || progress.processedRows);
  progress.segmentFailures.set(
    `${segment.segment}::${segment.file_name}`,
    (progress.segmentFailures.get(`${segment.segment}::${segment.file_name}`) || 0) +
      result.failedRows,
  );

  for (const [key, value] of Object.entries(result.stats || {})) {
    progress.stats[key] = (progress.stats[key] || 0) + value;
  }

  addProgressErrors(progress, result.errors || []);
}

async function processStreamedSegmentBatch({
  job,
  segment,
  rows,
  userId,
  context,
  progress,
}) {
  const key = `${segment.segment}::${segment.file_name}`;
  const progressItem = progress.segmentMap.get(key);
  const result = await repository.transaction(async (tx) => {
    const chunkResult = await processRowsChunk({
      tx,
      job,
      segment,
      rows,
      periodMonth: segment.period_month,
      userId,
      context,
    });
    await updateImportSegmentProgress(tx, job.id, segment, progressItem, "PROCESSING");
    return chunkResult;
  }, SLIK_IMPORT_TRANSACTION_OPTIONS);

  mergeChunkResult(progress, result, segment);
  await updateJobProgress(job.id, progress);
}

async function beginStreamedSegment({ job, segment, progress, config }) {
  addSegmentProgress(progress, segment);
  if (config.maxRows > 0 && progress.totalRows > config.maxRows) {
    throw new Error(`Jumlah baris import melebihi batas ${config.maxRows}.`);
  }

  await repository.transaction(async (tx) => {
    await upsertImportSegment(tx, job.id, segment);
  }, SLIK_IMPORT_TRANSACTION_OPTIONS);
  await updateJobProgress(job.id, progress);
}

async function finishStreamedSegment({ job, segment, progress }) {
  const key = `${segment.segment}::${segment.file_name}`;
  const failures = progress.segmentFailures.get(key) || 0;
  const status = failures > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED";
  const progressItem = progress.segmentMap.get(key);
  if (progressItem) {
    progressItem.actual_rows = Number(segment.actual_rows || 0);
    progressItem.status = status;
  }

  await repository.transaction(async (tx) => {
    await updateImportSegmentProgress(tx, job.id, segment, progressItem, status);
  }, SLIK_IMPORT_TRANSACTION_OPTIONS);
  await updateJobProgress(job.id, progress);
}

async function processTextStream({
  fileName,
  stream,
  job,
  options,
  context,
  progress,
  config,
  userId,
}) {
  let latestSegment = null;
  const segment = await streamSlikTextFile({
    fileName,
    stream,
    options,
    batchSize: config.batchSize,
    maxRows: config.maxRows || null,
    onSegment: async (nextSegment) => {
      latestSegment = nextSegment;
      await beginStreamedSegment({ job, segment: nextSegment, progress, config });
    },
    onRows: async (segmentBatch) => {
      latestSegment = segmentBatch;
      await processStreamedSegmentBatch({
        job,
        segment: segmentBatch,
        rows: segmentBatch.rows,
        userId,
        context,
        progress,
      });
    },
  });

  await finishStreamedSegment({ job, segment: segment || latestSegment, progress });
}

async function validateTextStream({ fileName, stream, options, config }) {
  return streamSlikTextFile({
    fileName,
    stream,
    options,
    batchSize: config.batchSize,
    maxRows: config.maxRows || null,
  });
}

function assertValidatedSegments(segments, options, config) {
  if (segments.length === 0) {
    throw new Error("Tidak ada file TXT SLIK yang bisa diproses.");
  }

  const periods = new Set(segments.map((segment) => segment.period_month));
  if (periods.size !== 1) {
    throw new Error("Semua file SLIK dalam satu import harus memiliki periode yang sama.");
  }
  const periodMonth = [...periods][0];
  if (options.expectedPeriod && options.expectedPeriod !== periodMonth) {
    throw new Error(`Periode form ${options.expectedPeriod} tidak sesuai file SLIK ${periodMonth}.`);
  }

  const totalRows = segments.reduce(
    (total, segment) => total + Number(segment.actual_rows || 0),
    0,
  );
  if (config.maxRows > 0 && totalRows > config.maxRows) {
    throw new Error(`Jumlah baris import ${totalRows} melebihi batas ${config.maxRows}.`);
  }
}

async function validateStoredImportFiles(fileRefs, options, config) {
  const segments = [];
  for (const fileRef of fileRefs) {
    const fileName = fileRef.file_name || fileRef.name;
    const extension = path.extname(fileName || "").toLowerCase();
    if (extension === ".txt") {
      segments.push(
        await validateTextStream({
          fileName,
          stream: fs.createReadStream(fileRef.absolutePath),
          options,
          config,
        }),
      );
      continue;
    }

    throw new Error(`Format file ${fileName} tidak valid. Import SLIK hanya menerima TXT.`);
  }

  assertValidatedSegments(segments, options, config);
  return segments;
}

async function processStoredImportFile({ fileRef, job, options, context, progress, config, userId }) {
  const fileName = fileRef.file_name || fileRef.name;
  const extension = path.extname(fileName || "").toLowerCase();
  if (extension === ".txt") {
    await processTextStream({
      fileName,
      stream: fs.createReadStream(fileRef.absolutePath),
      job,
      options,
      context,
      progress,
      config,
      userId,
    });
    return;
  }

  throw new Error(`Format file ${fileName} tidak valid. Import SLIK hanya menerima TXT.`);
}

async function processSlikJobStreaming(job, userId) {
  const config = getSlikImportConfig();
  const options = prepareParseOptions({
    expectedPeriod: job.period_month,
    importSegment: job.import_segment,
    cifStatus: job.cif_status,
  });
  const files = getStoredImportFileRefs(job, config);
  await validateStoredImportFiles(files, options, config);

  const context = createImportContext();
  const progress = createImportProgress(job, config);

  await repository.prisma.debtor_import_segments.deleteMany({
    where: { import_job_id: job.id },
  });
  await repository.prisma.debtor_slik_records.deleteMany({
    where: { import_job_id: job.id },
  });
  await updateJobProgress(job.id, progress);

  for (const fileRef of files) {
    await processStoredImportFile({
      fileRef,
      job,
      options,
      context,
      progress,
      config,
      userId,
    });
  }

  return {
    successRows: progress.successRows,
    failedRows: progress.failedRows,
    errors: progress.errorSamples,
    errorTotal: progress.errorTotal,
    period_month: progress.periodMonth,
    import_segment: progress.importSegment,
    cif_status: progress.cifStatus,
    processing_summary: getPublicProgress(progress),
    error_summary:
      progress.errorTotal > 0
        ? {
            total: progress.errorTotal,
            samples: progress.errorSamples,
          }
        : null,
  };
}

async function processSlikJob(jobId, userId = null) {
  if (ACTIVE_SLIK_JOBS.has(jobId)) return;
  ACTIVE_SLIK_JOBS.add(jobId);

  try {
    const job = await repository.findJobById(jobId);
    if (!job || job.type !== "SLIK" || job.status === "COMPLETED") return;

    await repository.prisma.debtor_import_jobs.update({
      where: { id: job.id },
      data: {
        status: "PROCESSING",
        started_at: new Date(),
        error_summary: null,
        processing_summary: {
          import_segment: job.import_segment,
          cif_status: job.cif_status,
          period_month: job.period_month,
          processed_rows: 0,
          total_rows: 0,
        },
        failed_rows: 0,
        success_rows: 0,
        total_rows: 0,
      },
    });

    const result = await processSlikJobStreaming(job, userId || job.created_by);

    await repository.prisma.debtor_import_jobs.update({
      where: { id: job.id },
      data: {
        status: result.failedRows > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
        import_segment: result.import_segment,
        cif_status: result.cif_status,
        period_month: result.period_month,
        success_rows: result.successRows,
        failed_rows: result.failedRows,
        processing_summary: result.processing_summary,
        error_summary: result.error_summary,
        completed_at: new Date(),
      },
    });
  } catch (error) {
    console.error("[debtor-imports] SLIK import failed", { jobId, error });
    await repository.prisma.debtor_import_jobs.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        error_summary: {
          message: error.message || "Gagal memproses import SLIK.",
        },
        completed_at: new Date(),
      },
    });
    throw error;
  } finally {
    ACTIVE_SLIK_JOBS.delete(jobId);
  }
}

async function scheduleSlikJob(jobId, userId = null, { markFailedOnError = true } = {}) {
  try {
    await enqueueSlikImportJob({ jobId, userId });
  } catch (error) {
    console.error("[debtor-imports] SLIK queue enqueue failed", {
      jobId,
      error,
    });
    if (markFailedOnError) {
      await repository.prisma.debtor_import_jobs.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          error_summary: {
            message:
              "Queue import SLIK tidak tersedia. Pastikan Redis dan worker import berjalan.",
            detail: error.message || "Gagal enqueue job import SLIK.",
          },
          completed_at: new Date(),
        },
      });
    }
    throw new AppError(
      "Queue import SLIK tidak tersedia. Pastikan Redis dan worker import berjalan.",
      503,
    );
  }
}

exports.recoverPendingDebtorImportJobs = async () => {
  const jobs = await repository.prisma.debtor_import_jobs.findMany({
    where: {
      type: "SLIK",
      deleted_at: null,
      status: {
        in: ["PENDING", "PROCESSING"],
      },
    },
    select: {
      id: true,
      created_by: true,
    },
    orderBy: {
      created_at: "asc",
    },
    take: 5,
  });

  for (const job of jobs) {
    try {
      await scheduleSlikJob(job.id, job.created_by, { markFailedOnError: false });
    } catch (error) {
      console.error("[debtor-imports] pending SLIK job recovery failed", {
        jobId: job.id,
        error,
      });
    }
  }

  return jobs.length;
};

exports.processSlikJob = processSlikJob;
