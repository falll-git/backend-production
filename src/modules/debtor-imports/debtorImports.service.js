const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
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
const {
  collectUnmappedSlikReferences,
  mergeUnmappedSlikReferences,
} = require("../../utils/slik-reference-dictionary");

const IMPORT_TYPES = new Set(["SLIK", "IDEB"]);
const SLIK_IMPORT_SEGMENTS = new Set(["D01", "D02", "F01", "A01"]);
const IDEB_IMPORT_EXTENSIONS = new Set(["json", "txt"]);
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
const FIXED_COLLECTIBILITY_LEVELS = {
  1: { code: "KOL_1", name: "Lancar", is_npf: false },
  2: { code: "KOL_2", name: "Dalam Perhatian Khusus", is_npf: false },
  3: { code: "KOL_3", name: "Kurang Lancar", is_npf: true },
  4: { code: "KOL_4", name: "Diragukan", is_npf: true },
  5: { code: "KOL_5", name: "Macet", is_npf: true },
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

function serializeIdebPendingUpload(req, item) {
  const externalRecord = item.import_job?.records?.find(
    (record) => record.source_type === "IDEB",
  );
  const resultSummary =
    item.result_summary && typeof item.result_summary === "object" && !Array.isArray(item.result_summary)
      ? item.result_summary
      : {};

  return {
    id: item.id,
    import_job_id: item.import_job_id,
    debtor_id: item.debtor_id,
    contract_id: item.contract_id,
    month: item.month,
    year: item.year,
    status: item.status,
    external_status: externalRecord?.status || (item.debtor_id ? "MATCHED" : "MATCH_PENDING"),
    period_month:
      resultSummary.period_month ||
      (item.year && item.month ? `${item.year}-${String(item.month).padStart(2, "0")}` : null),
    debtor_name: resultSummary.debtor_name || null,
    identity_number: resultSummary.identity_number || null,
    contract_number: resultSummary.contract_number || null,
    report_number: resultSummary.report_number || null,
    reference_number: resultSummary.reference_number || null,
    source_format: resultSummary.source_format || "IDEB_JSON",
    current_collectibility: resultSummary.current_collectibility || null,
    outstanding_pokok: Number(resultSummary.outstanding_pokok || 0),
    summary_detail: resultSummary,
    debtor: item.debtor || null,
    contract: item.contract || null,
    file: serializeFile(req, item, {
      module: "debtor_information",
      entityId: item.id,
      fallbackBaseName: "ideb",
    }),
    files: Array.isArray(item.files)
      ? item.files.map((file) => ({
          id: file.id,
          part_number: file.part_number,
          total_parts: file.total_parts,
          file: serializeFile(req, file, {
            module: "debtor_information",
            entityId: file.id,
            fallbackBaseName: `ideb-part-${file.part_number || 1}`,
          }),
          created_at: file.created_at,
        }))
      : [],
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

function serializeIdebReportUpload(req, item) {
  const base = serializeIdebPendingUpload(req, item);
  const summary =
    item.result_summary && typeof item.result_summary === "object" && !Array.isArray(item.result_summary)
      ? item.result_summary
      : {};
  const metrics = getIdebResumeMetrics(summary);
  const totalParts =
    parseCurrencyNumber(summary.total_parts) ||
    Math.max(...(Array.isArray(item.files) ? item.files.map((file) => file.total_parts || 1) : [1]));
  const receivedParts =
    parseCurrencyNumber(summary.received_parts) ||
    (Array.isArray(item.files) && item.files.length > 0 ? item.files.length : 1);

  return {
    ...base,
    link_status: item.debtor_id ? "TERHUBUNG" : "BELUM_TERHUBUNG",
    result_date: summary.result_date || summary.processed_at || null,
    reporter_count: metrics.reporterCount,
    facilities_count: metrics.facilities.length,
    active_facilities_count: metrics.activeFacilities.length,
    paid_off_facilities_count: metrics.paidOffFacilities.length,
    active_outstanding: metrics.activeOutstanding,
    paid_off_plafond: metrics.paidOffPlafond,
    total_plafond: metrics.totalPlafond,
    total_outstanding: metrics.totalOutstanding,
    total_arrears: metrics.totalArrears,
    worst_collectibility: metrics.worstCollectibility,
    officer_name: metrics.officerName,
    total_parts: totalParts || 1,
    received_parts: receivedParts || 1,
    part_display: `${receivedParts || 1}/${totalParts || 1}`,
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

async function ensureResolveTargets(tx, payload) {
  const debtorId = normalizeText(payload.debtor_id);
  const contractId = normalizeText(payload.contract_id);
  if (!debtorId) throw new AppError("Debitur target wajib dipilih.", 422);

  const debtor = await tx.digital_debtors.findFirst({
    where: {
      id: debtorId,
      deleted_at: null,
    },
    select: {
      id: true,
    },
  });
  if (!debtor) throw new AppError("Debitur target tidak ditemukan.", 404);

  let contract = null;
  if (contractId) {
    contract = await tx.debtor_contracts.findFirst({
      where: {
        id: contractId,
        deleted_at: null,
      },
      select: {
        id: true,
        debtor_id: true,
      },
    });
    if (!contract) throw new AppError("Kontrak target tidak ditemukan.", 404);
    if (contract.debtor_id !== debtorId) {
      throw new AppError("Kontrak tidak sesuai dengan debitur target.", 422);
    }
  }

  return { debtorId, contractId: contract?.id || null };
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
      throw new AppError("Import IDEB hanya menerima file TXT atau JSON.", 422);
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
    throw new AppError(
      `File IDEB harus berekstensi TXT atau JSON dengan isi JSON valid: ${error.message}`,
      422,
    );
  }
}

function getOjkIdebPartInfo(raw, fileMeta = {}) {
  const header = asObject(raw?.header) || {};
  const individual = asObject(raw?.individual) || {};
  const searchParameter = asObject(individual.parameterPencarian) || {};
  const debtorProfile = getFirstObject(individual.dataPokokDebitur);
  const totalParts = parseCurrencyNumber(header.totalBagian) || 1;
  const partNumber = parseCurrencyNumber(header.nomorBagian) || 1;

  return {
    request_id: normalizeText(header.idPermintaan),
    report_number: normalizeText(individual.nomorLaporan),
    identity_number:
      normalizeText(debtorProfile.noIdentitas) ||
      normalizeText(searchParameter.noIdentitas),
    result_date: normalizeText(header.tanggalHasil),
    reference_number: normalizeText(header.kodeReferensiPengguna),
    total_parts: totalParts > 0 ? totalParts : 1,
    part_number: partNumber > 0 ? partNumber : 1,
    file_name: fileMeta.file_name || fileMeta.name || null,
    file_path: fileMeta.file_path || null,
    mime_type: fileMeta.mime_type || null,
    size_bytes: fileMeta.size_bytes || null,
    checksum: fileMeta.checksum || null,
  };
}

function idebPartGroupKey(part) {
  return [
    part.request_id,
    part.report_number,
    part.identity_number,
    part.result_date,
  ].join("|");
}

function readOjkCreditFacilities(raw) {
  const individual = asObject(raw?.individual) || {};
  const facilitiesRoot = asObject(individual.fasilitas) || {};
  return asArray(
    readObjectValue(facilitiesRoot, [
      "kreditPembiayan",
      "kreditPembiayaan",
      "facilities",
    ]),
  ).filter((item) => asObject(item));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeOjkIdebParts(parts) {
  if (parts.length === 0) throw new AppError("File IDEB wajib diunggah.", 422);

  const first = parts[0].part;
  const groupKey = idebPartGroupKey(first);
  const hasDifferentGroup = parts.some((item) => idebPartGroupKey(item.part) !== groupKey);
  if (hasDifferentGroup) {
    throw new AppError(
      "Semua bagian IDEB harus berasal dari satu hasil pengecekan yang sama.",
      422,
    );
  }

  const hasDifferentTotalParts = parts.some(
    (item) => (item.part.total_parts || 1) !== (first.total_parts || 1),
  );
  if (hasDifferentTotalParts) {
    throw new AppError("Total bagian IDEB tidak konsisten antar file yang diunggah.", 422);
  }

  const totalParts = first.total_parts || 1;
  const partNumbers = parts.map((item) => item.part.part_number);
  const invalidPartNumbers = partNumbers.filter(
    (partNumber) => partNumber < 1 || partNumber > totalParts,
  );
  if (invalidPartNumbers.length > 0) {
    throw new AppError(
      `Nomor bagian IDEB tidak valid: ${invalidPartNumbers.join(", ")}.`,
      422,
    );
  }
  const uniquePartNumbers = new Set(partNumbers);
  if (uniquePartNumbers.size !== partNumbers.length) {
    throw new AppError("Nomor bagian file IDEB tidak boleh duplikat.", 422);
  }

  const expectedParts = Array.from({ length: totalParts }, (_, index) => index + 1);
  const missingParts = expectedParts.filter((partNumber) => !uniquePartNumbers.has(partNumber));
  if (missingParts.length > 0) {
    throw new AppError(
      `File IDEB belum lengkap. Bagian yang kurang: ${missingParts.join(", ")}.`,
      422,
    );
  }

  if (parts.length > totalParts) {
    throw new AppError("Jumlah file IDEB melebihi total bagian yang tercatat.", 422);
  }

  const sortedParts = [...parts].sort(
    (left, right) => left.part.part_number - right.part.part_number,
  );
  const merged = cloneJson(sortedParts[0].raw);
  const mergedIndividual = asObject(merged.individual) || {};
  const mergedFacilities = asObject(mergedIndividual.fasilitas) || {};
  mergedIndividual.fasilitas = mergedFacilities;
  merged.individual = mergedIndividual;
  mergedFacilities.kreditPembiayan = sortedParts.flatMap((item) =>
    readOjkCreditFacilities(item.raw).map((facility) => cloneJson(facility)),
  );
  delete mergedFacilities.kreditPembiayaan;
  delete mergedFacilities.facilities;
  if (merged.header && typeof merged.header === "object") {
    merged.header.nomorBagian = "1";
    merged.header.totalBagian = String(totalParts);
  }

  return {
    raw: merged,
    metadata: {
      total_parts: totalParts,
      received_parts: sortedParts.length,
      part_numbers: sortedParts.map((item) => item.part.part_number),
      source_files: sortedParts.map((item) => ({
        part_number: item.part.part_number,
        total_parts: item.part.total_parts,
        file_name: item.part.file_name,
        file_path: item.part.file_path,
        mime_type: item.part.mime_type,
        size_bytes: item.part.size_bytes,
        checksum: item.part.checksum,
      })),
    },
  };
}

function buildIdebImportPayload(fileMetas) {
  const parsedFiles = fileMetas.map((fileMeta) => ({
    fileMeta,
    raw: parseIdebJsonFile(fileMeta),
  }));
  const isAllOjk = parsedFiles.every((item) => asObject(item.raw)?.individual);

  if (parsedFiles.length > 1 && !isAllOjk) {
    throw new AppError(
      "Upload multi-file IDEB hanya didukung untuk format OJK IDEB.",
      422,
    );
  }

  if (isAllOjk) {
    const parts = parsedFiles.map((item) => ({
      ...item,
      part: getOjkIdebPartInfo(item.raw, item.fileMeta),
    }));
    const totalParts = parts[0]?.part.total_parts || 1;
    const hasMultiPart = totalParts > 1 || parts.length > 1;
    const merged = hasMultiPart
      ? mergeOjkIdebParts(parts)
      : {
          raw: parts[0].raw,
          metadata: {
            total_parts: 1,
            received_parts: 1,
            part_numbers: [1],
            source_files: [
              {
                part_number: 1,
                total_parts: 1,
                file_name: parts[0].part.file_name,
                file_path: parts[0].part.file_path,
                mime_type: parts[0].part.mime_type,
                size_bytes: parts[0].part.size_bytes,
                checksum: parts[0].part.checksum,
              },
            ],
          },
        };
    return {
      raw: merged.raw,
      summary: {
        ...normalizeIdebSummary(merged.raw),
        ...merged.metadata,
      },
      parts: parts
        .sort((left, right) => left.part.part_number - right.part.part_number)
        .map((item) => item.part),
    };
  }

  const raw = parsedFiles[0].raw;
  const fileMeta = parsedFiles[0].fileMeta;
  return {
    raw,
    summary: {
      ...normalizeIdebSummary(raw),
      total_parts: 1,
      received_parts: 1,
      part_numbers: [1],
      source_files: [
        {
          part_number: 1,
          total_parts: 1,
          file_name: fileMeta.file_name,
          file_path: fileMeta.file_path,
          mime_type: fileMeta.mime_type,
          size_bytes: fileMeta.size_bytes,
          checksum: fileMeta.checksum,
        },
      ],
    },
    parts: [
      {
        part_number: 1,
        total_parts: 1,
        file_name: fileMeta.file_name,
        file_path: fileMeta.file_path,
        mime_type: fileMeta.mime_type,
        size_bytes: fileMeta.size_bytes,
        checksum: fileMeta.checksum,
      },
    ],
  };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function getFirstObject(value) {
  return asArray(value).find((item) => asObject(item)) || {};
}

function readObjectValue(source, keys) {
  if (!source || typeof source !== "object") return null;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function normalizeYearMonth(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const compact = text.replace(/[^\d]/g, "");
  if (/^\d{6}$/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}`;
  }
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text);
  return match ? text : null;
}

function normalizeCompactDate(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const compact = text.replace(/[^\d]/g, "");
  if (/^\d{14}$/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(
      6,
      8,
    )}T${compact.slice(8, 10)}:${compact.slice(10, 12)}:${compact.slice(12, 14)}`;
  }
  if (/^\d{8}$/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }
  return text;
}

function normalizeNumber(value) {
  return parseCurrencyNumber(value) ?? 0;
}

function formatCodeLabel(code, label) {
  const normalizedCode = normalizeText(code);
  const normalizedLabel = normalizeText(label);
  if (normalizedCode && normalizedLabel) return `${normalizedCode} - ${normalizedLabel}`;
  return normalizedCode || normalizedLabel || null;
}

function normalizeIdebObjectArray(value) {
  return asArray(value)
    .map((item) => asObject(item))
    .filter(Boolean);
}

function normalizeIdebFacilityHistory(facility) {
  const history = [];
  for (let index = 1; index <= 24; index += 1) {
    const suffix = String(index).padStart(2, "0");
    const periodMonth = normalizeYearMonth(facility[`tahunBulan${suffix}`]);
    const collectibilityCode = normalizeText(facility[`tahunBulan${suffix}Kol`]);
    const daysPastDue = parseCurrencyNumber(facility[`tahunBulan${suffix}Ht`]);
    if (!periodMonth && !collectibilityCode && daysPastDue === null) continue;

    history.push({
      month_index: index,
      period_month: periodMonth,
      collectibility_code: collectibilityCode || null,
      days_past_due: daysPastDue,
    });
  }

  return history;
}

function normalizeIdebFacility(facility) {
  const periodMonth =
    normalizeYearMonth(
      normalizeText(facility.tahun) && normalizeText(facility.bulan)
        ? `${facility.tahun}${String(facility.bulan).padStart(2, "0")}`
        : null,
    ) || normalizeYearMonth(facility.periode);
  const monthlyHistory = normalizeIdebFacilityHistory(facility);
  const accountNumber = normalizeText(
    readObjectValue(facility, ["noRekening", "no_rekening", "no_rekening_fasilitas"]),
  );

  return {
    reporter_code: normalizeText(facility.ljk),
    reporter_name: normalizeText(facility.ljkKet),
    branch_code: normalizeText(facility.cabang),
    branch_name: normalizeText(facility.cabangKet),
    account_number: accountNumber,
    period_month: periodMonth,
    credit_nature_code: normalizeText(facility.sifatKreditPembiayaan),
    credit_nature: formatCodeLabel(
      facility.sifatKreditPembiayaan,
      facility.sifatKreditPembiayaanKet,
    ),
    credit_type_code: normalizeText(facility.jenisKreditPembiayaan),
    credit_type: formatCodeLabel(
      facility.jenisKreditPembiayaan,
      facility.jenisKreditPembiayaanKet,
    ),
    financing_scheme_code: normalizeText(facility.akadKreditPembiayaan),
    financing_scheme: formatCodeLabel(
      facility.akadKreditPembiayaan,
      facility.akadKreditPembiayaanKet,
    ),
    initial_akad_number: normalizeText(facility.noAkadAwal),
    initial_akad_date: normalizeCompactDate(facility.tanggalAkadAwal),
    final_akad_number: normalizeText(facility.noAkadAkhir),
    final_akad_date: normalizeCompactDate(facility.tanggalAkadAkhir),
    initial_credit_date: normalizeCompactDate(facility.tanggalAwalKredit),
    start_date: normalizeCompactDate(facility.tanggalMulai),
    due_date: normalizeCompactDate(facility.tanggalJatuhTempo),
    debtor_category_code: normalizeText(facility.kategoriDebiturKode),
    debtor_category: formatCodeLabel(
      facility.kategoriDebiturKode,
      facility.kategoriDebiturKet,
    ),
    usage_type_code: normalizeText(facility.jenisPenggunaan),
    usage_type: formatCodeLabel(facility.jenisPenggunaan, facility.jenisPenggunaanKet),
    economic_sector_code: normalizeText(facility.sektorEkonomi),
    economic_sector: formatCodeLabel(facility.sektorEkonomi, facility.sektorEkonomiKet),
    government_program_code: normalizeText(facility.kreditProgramPemerintah),
    government_program: formatCodeLabel(
      facility.kreditProgramPemerintah,
      facility.kreditProgramPemerintahKet,
    ),
    project_location_code: normalizeText(facility.lokasiProyek),
    project_location: formatCodeLabel(facility.lokasiProyek, facility.lokasiProyekKet),
    currency_code: normalizeText(facility.valutaKode),
    interest_rate: parseCurrencyNumber(facility.sukuBungaImbalan),
    interest_type_code: normalizeText(facility.jenisSukuBungaImbalan),
    interest_type: formatCodeLabel(
      facility.jenisSukuBungaImbalan,
      facility.jenisSukuBungaImbalanKet,
    ),
    collectibility_code: normalizeText(facility.kualitas),
    collectibility: formatCodeLabel(facility.kualitas, facility.kualitasKet),
    days_past_due: parseCurrencyNumber(facility.jumlahHariTunggakan),
    project_value: normalizeNumber(facility.nilaiProyek),
    initial_plafond: normalizeNumber(facility.plafonAwal),
    plafond: normalizeNumber(facility.plafon),
    current_month_realization: normalizeNumber(facility.realisasiBulanBerjalan),
    original_currency_amount: normalizeNumber(facility.nilaiDalamMataUangAsal),
    outstanding: normalizeNumber(facility.bakiDebet),
    problem_reason_code: normalizeText(facility.kodeSebabMacet),
    problem_reason: formatCodeLabel(facility.kodeSebabMacet, facility.sebabMacetKet),
    problem_date: normalizeCompactDate(facility.tanggalMacet),
    principal_arrears: normalizeNumber(facility.tunggakanPokok),
    interest_arrears: normalizeNumber(facility.tunggakanBunga),
    arrears_frequency: parseCurrencyNumber(facility.frekuensiTunggakan),
    penalty: normalizeNumber(facility.denda),
    restructuring_frequency: parseCurrencyNumber(facility.frekuensiRestrukturisasi),
    last_restructuring_date: normalizeCompactDate(facility.tanggalRestrukturisasiAkhir),
    restructuring_method_code: normalizeText(facility.kodeCaraRestrukturisasi),
    restructuring_method: formatCodeLabel(
      facility.kodeCaraRestrukturisasi,
      facility.restrukturisasiKet,
    ),
    condition_code: normalizeText(facility.kondisi),
    condition: formatCodeLabel(facility.kondisi, facility.kondisiKet),
    condition_date: normalizeCompactDate(facility.tanggalKondisi),
    description: normalizeText(facility.keterangan),
    collaterals: normalizeIdebObjectArray(facility.agunan),
    guarantors: normalizeIdebObjectArray(facility.penjamin),
    monthly_collectibility_history: monthlyHistory,
  };
}

function normalizeOjkiDebIndividualSummary(raw) {
  const header = asObject(raw.header) || {};
  const individual = asObject(raw.individual) || {};
  const searchParameter = asObject(individual.parameterPencarian) || {};
  const debtorProfile = getFirstObject(individual.dataPokokDebitur);
  const facilitySummary = asObject(individual.ringkasanFasilitas) || {};
  const rawFacilities = asArray(
    readObjectValue(asObject(individual.fasilitas) || {}, [
      "kreditPembiayan",
      "kreditPembiayaan",
      "facilities",
    ]),
  ).filter((item) => asObject(item));
  const facilities = rawFacilities.map((item) => normalizeIdebFacility(item));
  const mainFacility = facilities[0] || {};
  const periodMonth =
    normalizeYearMonth(individual.posisiDataTerakhir) ||
    mainFacility.period_month ||
    normalizeYearMonth(facilitySummary.kualitasBulanDataTerburuk);
  const resultDate = normalizeCompactDate(header.tanggalHasil);
  const requestDate =
    normalizeCompactDate(header.tanggalPermintaan) ||
    normalizeCompactDate(individual.tanggalPermintaan);
  const debtorName =
    normalizeText(debtorProfile.namaDebitur) ||
    normalizeText(searchParameter.namaDebitur);
  const identityNumber =
    normalizeText(debtorProfile.noIdentitas) ||
    normalizeText(searchParameter.noIdentitas);
  const worstCollectibility = normalizeText(facilitySummary.kualitasTerburuk);
  const totalOutstanding = normalizeNumber(facilitySummary.bakiDebetTotal);
  const totalPlafond = normalizeNumber(facilitySummary.plafonEfektifTotal);

  return {
    schema_version: "ojk-ideb-individual-v1",
    source_format: "OJK_IDEB_INDIVIDUAL",
    period_month: periodMonth,
    officer_name: normalizeText(header.dibuatOleh),
    report_number: normalizeText(individual.nomorLaporan),
    reference_number:
      normalizeText(header.kodeReferensiPengguna) || normalizeText(header.idPermintaan),
    request_date: requestDate,
    result_date: resultDate,
    debtor_name: debtorName,
    identity_number: identityNumber,
    debtor_number: null,
    contract_number: mainFacility.account_number || null,
    current_collectibility:
      formatCodeLabel(worstCollectibility, null) ||
      mainFacility.collectibility ||
      mainFacility.collectibility_code ||
      null,
    outstanding_pokok: totalOutstanding,
    financing_status: mainFacility.condition || mainFacility.condition_code || null,
    conclusion: null,
    processed_at: resultDate || requestDate,
    identity: {
      name: debtorName,
      identity_type: normalizeText(debtorProfile.identitas),
      identity_number: identityNumber,
      tax_number: normalizeText(debtorProfile.npwp) || normalizeText(searchParameter.npwp),
      gender: formatCodeLabel(debtorProfile.jenisKelamin, debtorProfile.jenisKelaminKet),
      birth_place:
        normalizeText(debtorProfile.tempatLahir) ||
        normalizeText(searchParameter.tempatLahir),
      birth_date:
        normalizeCompactDate(debtorProfile.tanggalLahir) ||
        normalizeCompactDate(searchParameter.tanggalLahir),
      address: normalizeText(debtorProfile.alamat),
      village: normalizeText(debtorProfile.kelurahan),
      district: normalizeText(debtorProfile.kecamatan),
      city_code: normalizeText(debtorProfile.kabKota),
      city: formatCodeLabel(debtorProfile.kabKota, debtorProfile.kabKotaKet),
      postal_code: normalizeText(debtorProfile.kodePos),
      country_code: normalizeText(debtorProfile.negara),
      country: formatCodeLabel(debtorProfile.negara, debtorProfile.negaraKet),
      occupation_code: normalizeText(debtorProfile.pekerjaan),
      occupation: formatCodeLabel(debtorProfile.pekerjaan, debtorProfile.pekerjaanKet),
      workplace: normalizeText(debtorProfile.tempatBekerja),
      business_field_code: normalizeText(debtorProfile.bidangUsaha),
      business_field: formatCodeLabel(
        debtorProfile.bidangUsaha,
        debtorProfile.bidangUsahaKet,
      ),
      reporter_code: normalizeText(debtorProfile.pelapor),
      reporter: formatCodeLabel(debtorProfile.pelapor, debtorProfile.pelaporKet),
      created_at_source: normalizeCompactDate(debtorProfile.tanggalDibentuk),
      updated_at_source: normalizeCompactDate(debtorProfile.tanggalUpdate),
    },
    summary: {
      total_plafond: totalPlafond,
      total_outstanding: totalOutstanding,
      worst_collectibility_code: worstCollectibility || null,
      worst_collectibility: formatCodeLabel(worstCollectibility, null),
      worst_collectibility_period: normalizeYearMonth(
        facilitySummary.kualitasBulanDataTerburuk,
      ),
      bank_creditor_count: parseCurrencyNumber(facilitySummary.krediturBankUmum),
      bpr_bprs_creditor_count: parseCurrencyNumber(facilitySummary["krediturBPR/S"]),
      lp_creditor_count: parseCurrencyNumber(facilitySummary.krediturLp),
      other_creditor_count: parseCurrencyNumber(facilitySummary.krediturLainnya),
      effective_plafond_credit: normalizeNumber(
        facilitySummary.plafonEfektifKreditPembiayaan,
      ),
      outstanding_credit: normalizeNumber(facilitySummary.bakiDebetKreditPembiayaan),
    },
    facilities,
    monthly_collectibility_history: facilities.flatMap((facility) =>
      facility.monthly_collectibility_history.map((history) => ({
        account_number: facility.account_number,
        reporter_name: facility.reporter_name,
        ...history,
      })),
    ),
    other_bprs: facilities.map((facility) => ({
      name: facility.reporter_name || facility.reporter_code || "-",
      collectibility: facility.collectibility || facility.collectibility_code,
      outstanding_pokok: facility.outstanding || 0,
    })),
  };
}

function normalizeLegacyIdebSummary(raw) {
  const debtor = readObjectValue(raw, ["debitur", "debtor", "nasabah"]) || {};
  const summary = readObjectValue(raw, ["ringkasan", "summary", "hasil"]) || {};
  const facilities = readObjectValue(raw, ["fasilitas", "facilities", "pembiayaan"]) || [];
  const mainFacility = Array.isArray(facilities) ? facilities[0] || {} : {};

  return {
    schema_version: normalizeText(raw.schema_version || raw.version) || "ideb-v1",
    source_format: "IDEB_JSON",
    period_month: normalizeText(raw.periode || raw.period_month || raw.period),
    officer_name: normalizeText(
      readObjectValue(raw, ["officer_name", "petugas", "dibuatOleh", "created_by_name"]),
    ),
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

function normalizeIdebSummary(raw) {
  if (asObject(raw)?.individual) {
    return normalizeOjkiDebIndividualSummary(raw);
  }
  return normalizeLegacyIdebSummary(raw);
}

function valueOrDash(value) {
  if (value === undefined || value === null) return "-";
  const text = String(value).trim();
  return text || "-";
}

function recordValue(record, keys) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function formatIdebDate(value) {
  const text = normalizeText(value);
  if (!text) return "-";
  const compact = text.replace(/[^\d]/g, "");
  let date = null;
  if (/^\d{14}$/.test(compact)) {
    date = new Date(
      Number(compact.slice(0, 4)),
      Number(compact.slice(4, 6)) - 1,
      Number(compact.slice(6, 8)),
      Number(compact.slice(8, 10)),
      Number(compact.slice(10, 12)),
      Number(compact.slice(12, 14)),
    );
  } else if (/^\d{8}$/.test(compact)) {
    date = new Date(
      Number(compact.slice(0, 4)),
      Number(compact.slice(4, 6)) - 1,
      Number(compact.slice(6, 8)),
    );
  } else {
    date = new Date(text);
  }

  if (!date || Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatIdebPeriod(value) {
  const text = normalizeText(value);
  if (!text) return "-";
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text);
  if (!match) return text;
  return new Intl.DateTimeFormat("id-ID", {
    month: "long",
    year: "numeric",
  }).format(new Date(Number(match[1]), Number(match[2]) - 1, 1));
}

function formatIdebMoney(value) {
  const amount = parseCurrencyNumber(value);
  if (amount === null) return "-";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatIdebNumber(value) {
  const amount = parseCurrencyNumber(value);
  if (amount === null) return "0";
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 0,
  }).format(amount);
}

function idebSourceFormatLabel(value) {
  const text = normalizeText(value);
  if (text === "OJK_IDEB_INDIVIDUAL") return "OJK IDEB";
  if (text === "IDEB_JSON") return "JSON IDEB";
  return text || "-";
}

function idebFacilityArray(summary) {
  return Array.isArray(summary?.facilities)
    ? summary.facilities.filter((item) => item && typeof item === "object" && !Array.isArray(item))
    : [];
}

function idebMonthlyHistoryArray(summary) {
  return Array.isArray(summary?.monthly_collectibility_history)
    ? summary.monthly_collectibility_history.filter(
        (item) => item && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function idebReporterCount(summary, facilities) {
  const stats = summary?.summary && typeof summary.summary === "object" ? summary.summary : {};
  const aggregateCount =
    (parseCurrencyNumber(stats.bank_creditor_count) || 0) +
    (parseCurrencyNumber(stats.bpr_bprs_creditor_count) || 0) +
    (parseCurrencyNumber(stats.lp_creditor_count) || 0) +
    (parseCurrencyNumber(stats.other_creditor_count) || 0);
  if (aggregateCount > 0) return aggregateCount;

  const names = new Set(
    facilities
      .map((facility) => recordValue(facility, ["reporter_name", "reporter_code", "ljk", "bank"]))
      .filter(Boolean)
      .map((value) => String(value).trim()),
  );
  return names.size || facilities.length;
}

function idebReporterNames(facilities) {
  const names = [];
  const seen = new Set();
  for (const facility of facilities) {
    const name =
      recordValue(facility, ["reporter_name", "reporter_code", "ljk", "bank"]) || "-";
    const normalized = String(name).trim().toUpperCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    names.push(String(name));
  }
  return names;
}

function idebFacilityPlafond(facility) {
  return parseCurrencyNumber(
    recordValue(facility, ["plafond", "initial_plafond", "plafon", "plafon_awal"]),
  ) || 0;
}

function idebFacilityOutstanding(facility) {
  return parseCurrencyNumber(
    recordValue(facility, ["outstanding", "baki_debet", "outstanding_pokok"]),
  ) || 0;
}

function idebFacilityArrears(facility) {
  return (
    (parseCurrencyNumber(recordValue(facility, ["principal_arrears", "tunggakan_pokok"])) || 0) +
    (parseCurrencyNumber(recordValue(facility, ["interest_arrears", "tunggakan_bunga"])) || 0) +
    (parseCurrencyNumber(recordValue(facility, ["penalty", "denda"])) || 0)
  );
}

function idebFacilityCondition(facility) {
  return valueOrDash(recordValue(facility, ["condition", "condition_code", "status"]));
}

function isIdebPaidOffFacility(facility) {
  return idebFacilityCondition(facility).toUpperCase().includes("LUNAS");
}

function getIdebResumeMetrics(summary) {
  const facilities = idebFacilityArray(summary);
  const stats = summary?.summary && typeof summary.summary === "object" ? summary.summary : {};
  const activeFacilities = facilities.filter((facility) => !isIdebPaidOffFacility(facility));
  const paidOffFacilities = facilities.filter(isIdebPaidOffFacility);
  const totalPlafond =
    parseCurrencyNumber(recordValue(stats, ["total_plafond", "effective_plafond_credit"])) ??
    facilities.reduce((total, facility) => total + idebFacilityPlafond(facility), 0);
  const totalOutstanding =
    parseCurrencyNumber(recordValue(stats, ["total_outstanding", "outstanding_credit"])) ??
    parseCurrencyNumber(summary?.outstanding_pokok) ??
    facilities.reduce((total, facility) => total + idebFacilityOutstanding(facility), 0);

  return {
    facilities,
    activeFacilities,
    paidOffFacilities,
    reporterCount: idebReporterCount(summary, facilities),
    reporterNames: idebReporterNames(facilities),
    officerName: normalizeText(summary?.officer_name),
    totalPlafond,
    totalOutstanding,
    activeOutstanding: activeFacilities.reduce(
      (total, facility) => total + idebFacilityOutstanding(facility),
      0,
    ),
    paidOffPlafond: paidOffFacilities.reduce(
      (total, facility) => total + idebFacilityPlafond(facility),
      0,
    ),
    totalArrears: facilities.reduce((total, facility) => total + idebFacilityArrears(facility), 0),
    worstCollectibility:
      summary?.current_collectibility ||
      recordValue(stats, ["worst_collectibility", "worst_collectibility_code"]) ||
      "-",
  };
}

function normalizePdfText(value) {
  return String(value || "")
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?");
}

function wrapPdfText(text, font, fontSize, maxWidth) {
  const words = normalizePdfText(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

function compactIdebDateForFile(value) {
  const text = normalizeText(value);
  if (!text) return "tanggal-ideb";
  const compact = text.replace(/[^\d]/g, "");
  if (compact.length >= 8) return compact.slice(0, 8);
  return text.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "tanggal-ideb";
}

function safeIdebPdfFileName(summary) {
  const identity = normalizeText(summary?.identity_number) || "tanpa-identitas";
  const date = compactIdebDateForFile(summary?.result_date || summary?.processed_at);
  return `resume-ideb-${identity}-${date}.pdf`
    .replace(/[<>:"/\\|?*\s]+/g, "-")
    .replace(/-+/g, "-");
}

function idebContactText(identity) {
  return valueOrDash(
    recordValue(identity, [
      "phone",
      "mobile_phone",
      "telephone",
      "phone_number",
      "nomor_telp",
      "nomorTelp",
    ]),
  );
}

function idebAddressText(identity) {
  return [
    recordValue(identity, ["address"]),
    recordValue(identity, ["village"]),
    recordValue(identity, ["district"]),
    recordValue(identity, ["city", "city_code"]),
    recordValue(identity, ["postal_code"]),
  ]
    .filter(Boolean)
    .join(", ") || "-";
}

function idebObjectLabel(record, keys) {
  for (const key of keys) {
    const value = recordValue(record, [key]);
    if (value) return valueOrDash(value);
  }
  return "-";
}

async function renderIdebResumePdf(upload) {
  const summary =
    upload?.result_summary && typeof upload.result_summary === "object" && !Array.isArray(upload.result_summary)
      ? upload.result_summary
      : {};
  const identity =
    summary.identity && typeof summary.identity === "object" && !Array.isArray(summary.identity)
      ? summary.identity
      : {};
  const metrics = getIdebResumeMetrics(summary);
  const monthlyHistory = idebMonthlyHistoryArray(summary);
  const sourceFiles = Array.isArray(summary.source_files) ? summary.source_files : [];
  const collaterals = metrics.facilities.flatMap((facility) =>
    Array.isArray(facility.collaterals) ? facility.collaterals : [],
  );
  const guarantors = metrics.facilities.flatMap((facility) =>
    Array.isArray(facility.guarantors) ? facility.guarantors : [],
  );
  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const colors = {
    navy: rgb(0.03, 0.07, 0.14),
    slate: rgb(0.28, 0.33, 0.42),
    muted: rgb(0.43, 0.48, 0.56),
    border: rgb(0.86, 0.89, 0.93),
    soft: rgb(0.96, 0.98, 1),
    softGray: rgb(0.97, 0.98, 0.99),
    panel: rgb(0.975, 0.982, 0.992),
    accent: rgb(0.79, 0.84, 0.92),
    yellow: rgb(0.97, 0.88, 0.03),
    white: rgb(1, 1, 1),
  };
  const pageSizes = {
    portrait: [595.28, 841.89],
    landscape: [841.89, 595.28],
  };
  const margin = 36;
  let page;
  let pageWidth;
  let pageHeight;
  let contentWidth;
  let orientation = "portrait";
  let y;

  function addPage(nextOrientation = orientation) {
    orientation = nextOrientation;
    page = pdfDoc.addPage(pageSizes[orientation]);
    pageWidth = page.getWidth();
    pageHeight = page.getHeight();
    contentWidth = pageWidth - margin * 2;
    y = pageHeight - margin;
  }

  function ensureSpace(required = 16) {
    if (y >= margin + required) return;
    addPage(orientation);
  }

  function drawWrappedTextAt(text, x, startY, width, options = {}) {
    const font = options.bold ? boldFont : regularFont;
    const size = options.size || 8.5;
    const lineHeight = options.lineHeight || size + 3;
    const color = options.color || colors.navy;
    let lines = wrapPdfText(valueOrDash(text), font, size, width);
    if (options.maxLines && lines.length > options.maxLines) {
      lines = lines.slice(0, options.maxLines);
      let last = lines[lines.length - 1] || "";
      while (last.length > 0 && font.widthOfTextAtSize(`${last}...`, size) > width) {
        last = last.slice(0, -1);
      }
      lines[lines.length - 1] = `${last || ""}...`;
    }
    lines.forEach((line, index) => {
      const textWidth = font.widthOfTextAtSize(normalizePdfText(line), size);
      const lineX = options.align === "right" ? Math.max(x, x + width - textWidth) : x;
      page.drawText(normalizePdfText(line), {
        x: lineX,
        y: startY - index * lineHeight,
        size,
        font,
        color,
      });
    });
    return lines.length * lineHeight;
  }

  function measureWrappedTextHeight(text, width, options = {}) {
    const font = options.bold ? boldFont : regularFont;
    const size = options.size || 8.5;
    const lineHeight = options.lineHeight || size + 3;
    let lines = wrapPdfText(valueOrDash(text), font, size, width);
    if (options.maxLines && lines.length > options.maxLines) {
      lines = lines.slice(0, options.maxLines);
    }
    return Math.max(lineHeight, lines.length * lineHeight);
  }

  function drawTextBlock(text, options = {}) {
    const x = options.x || margin;
    const width = options.width || contentWidth;
    const size = options.size || 8.5;
    const lineHeight = options.lineHeight || size + 3;
    const font = options.bold ? boldFont : regularFont;
    const lines = wrapPdfText(valueOrDash(text), font, size, width);
    const height = Math.max(lineHeight, lines.length * lineHeight);
    ensureSpace(height + 4);
    drawWrappedTextAt(text, x, y, width, options);
    y -= height + (options.gap ?? 4);
  }

  function drawSectionTitle(title) {
    ensureSpace(30);
    y -= 5;
    page.drawRectangle({
      x: margin,
      y: y - 3,
      width: 9,
      height: 15,
      color: colors.yellow,
    });
    page.drawText(normalizePdfText(title), {
      x: margin + 15,
      y,
      size: 10.5,
      font: boldFont,
      color: colors.navy,
    });
    y -= 20;
  }

  function drawBadge(text, x, baselineY, options = {}) {
    const label = valueOrDash(text);
    const fontSize = options.size || 7.2;
    const padX = options.padX || 6;
    const width = Math.min(
      options.maxWidth || 110,
      Math.max(28, (options.font || boldFont).widthOfTextAtSize(normalizePdfText(label), fontSize) + padX * 2),
    );
    const height = options.height || 15;
    page.drawRectangle({
      x,
      y: baselineY - 3,
      width,
      height,
      color: options.color || colors.softGray,
      borderColor: options.borderColor || colors.border,
      borderWidth: 0.6,
    });
    page.drawText(normalizePdfText(label), {
      x: x + padX,
      y: baselineY + 1,
      size: fontSize,
      font: options.font || boldFont,
      color: options.textColor || colors.navy,
    });
    return width;
  }

  function collectibilityLevel(value) {
    const match = /^([1-5])\b|\b([1-5])\b/.exec(normalizeText(value));
    return match ? match[1] || match[2] : null;
  }

  function collectibilityLabel(value) {
    const text = valueOrDash(value);
    const level = collectibilityLevel(text);
    const labels = {
      1: "Lancar",
      2: "DPK",
      3: "Kurang Lancar",
      4: "Diragukan",
      5: "Macet",
    };
    if (!level) return text;
    if (text.includes("-") || /[A-Za-z]/.test(text.replace(String(level), ""))) return text;
    return `${level} - ${labels[level]}`;
  }

  function collectibilityColors(value) {
    switch (collectibilityLevel(value)) {
      case "1":
        return { bg: rgb(0.04, 0.66, 0.28), fg: colors.white, border: rgb(0.03, 0.5, 0.22) };
      case "2":
        return { bg: rgb(0.58, 0.82, 0.28), fg: colors.navy, border: rgb(0.45, 0.68, 0.18) };
      case "3":
        return { bg: rgb(1, 0.83, 0.38), fg: colors.navy, border: rgb(0.92, 0.68, 0.15) };
      case "4":
        return { bg: rgb(1, 0.95, 0.02), fg: colors.navy, border: rgb(0.9, 0.78, 0) };
      case "5":
        return { bg: rgb(0.94, 0.08, 0.08), fg: colors.white, border: rgb(0.72, 0.03, 0.03) };
      default:
        return { bg: colors.softGray, fg: colors.slate, border: colors.border };
    }
  }

  function drawKolBadge(value, x, baselineY, maxWidth = 90) {
    const style = collectibilityColors(value);
    return drawBadge(collectibilityLabel(value), x, baselineY, {
      color: style.bg,
      textColor: style.fg,
      borderColor: style.border,
      maxWidth,
      size: 7,
    });
  }

  function drawMetricCard(item, x, topY, width, height) {
    const isKol = item.type === "kol";
    const style = isKol ? collectibilityColors(item.value) : null;
    page.drawRectangle({
      x,
      y: topY - height,
      width,
      height,
      color: colors.white,
      borderColor: colors.border,
      borderWidth: 0.8,
    });
    page.drawRectangle({
      x,
      y: topY - height,
      width: 4,
      height,
      color: isKol ? style.bg : colors.accent,
    });
    page.drawText(normalizePdfText(item.label.toUpperCase()), {
      x: x + 10,
      y: topY - 14,
      size: 6.6,
      font: boldFont,
      color: colors.muted,
    });
    if (isKol) {
      drawKolBadge(item.value, x + 10, topY - 35, width - 20);
    } else {
      drawWrappedTextAt(item.value, x + 10, topY - 34, width - 20, {
        size: item.small ? 9 : 11,
        bold: true,
        maxLines: 2,
        lineHeight: 12,
        color: colors.navy,
      });
    }
    if (item.description) {
      drawWrappedTextAt(item.description, x + 10, topY - height + 17, width - 20, {
        size: 6.4,
        lineHeight: 8,
        maxLines: 2,
        color: colors.muted,
      });
    }
  }

  function drawMetricGrid(items) {
    const gap = 8;
    const columns = 4;
    const cardWidth = (contentWidth - gap * (columns - 1)) / columns;
    const cardHeight = 76;
    const rows = Math.ceil(items.length / columns);
    ensureSpace(rows * cardHeight + (rows - 1) * gap + 8);
    const startY = y;
    items.forEach((item, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      drawMetricCard(
        item,
        margin + col * (cardWidth + gap),
        startY - row * (cardHeight + gap),
        cardWidth,
        cardHeight,
      );
    });
    y -= rows * cardHeight + (rows - 1) * gap + 18;
  }

  function drawInfoCell(item, x, topY, width, height) {
    page.drawRectangle({
      x,
      y: topY - height,
      width,
      height,
      color: colors.softGray,
      borderColor: colors.border,
      borderWidth: 0.6,
    });
    page.drawText(normalizePdfText(item.label.toUpperCase()), {
      x: x + 8,
      y: topY - 13,
      size: 6.6,
      font: boldFont,
      color: colors.muted,
    });
    drawWrappedTextAt(item.value, x + 8, topY - 29, width - 16, {
      size: 8.3,
      bold: Boolean(item.bold),
      maxLines: item.maxLines || 2,
      lineHeight: 10.5,
      color: colors.navy,
    });
  }

  function drawInfoGrid(items, columns = 2) {
    const gap = 8;
    const cellWidth = (contentWidth - gap * (columns - 1)) / columns;
    let index = 0;
    while (index < items.length) {
      const first = items[index];
      const rowItems = first.fullWidth ? [first] : items.slice(index, index + columns);
      const rowHeight = Math.max(
        42,
        ...rowItems.map((item) => {
          const width = item.fullWidth ? contentWidth : cellWidth;
          const lines = wrapPdfText(valueOrDash(item.value), item.bold ? boldFont : regularFont, 8.3, width - 16);
          return 25 + Math.min(item.maxLines || 2, Math.max(1, lines.length)) * 10.5;
        }),
      );
      ensureSpace(rowHeight + gap);
      rowItems.forEach((item, offset) => {
        const width = item.fullWidth ? contentWidth : cellWidth;
        const x = margin + offset * (cellWidth + gap);
        drawInfoCell(item, x, y, width, rowHeight);
      });
      y -= rowHeight + gap;
      index += first.fullWidth ? 1 : columns;
    }
    y -= 2;
  }

  function drawNoteBox(title, body, options = {}) {
    const bodyLines = wrapPdfText(valueOrDash(body), regularFont, 8.2, contentWidth - 22);
    const height = 38 + bodyLines.length * 10;
    ensureSpace(height + 8);
    page.drawRectangle({
      x: margin,
      y: y - height,
      width: contentWidth,
      height,
      color: options.color || colors.soft,
      borderColor: options.borderColor || colors.border,
      borderWidth: 0.8,
    });
    page.drawText(normalizePdfText(title), {
      x: margin + 10,
      y: y - 15,
      size: 8,
      font: boldFont,
      color: colors.navy,
    });
    drawWrappedTextAt(body, margin + 10, y - 30, contentWidth - 22, {
      size: 8.2,
      lineHeight: 10.5,
      color: colors.slate,
    });
    y -= height + 10;
  }

  function drawTable(columns, rows, options = {}) {
    const tableWidth = columns.reduce((total, column) => total + column.width, 0);
    const startX = margin;
    const headerHeight = options.headerHeight || 22;
    const fontSize = options.fontSize || 7;
    const lineHeight = fontSize + 2.5;

    if (rows.length === 0) {
      drawNoteBox(options.emptyTitle || "Data tidak tersedia", options.emptyText || "Belum ada data pada bagian ini.", {
        color: colors.softGray,
      });
      return;
    }

    function drawHeader() {
      ensureSpace(headerHeight + 10);
      page.drawRectangle({
        x: startX,
        y: y - headerHeight,
        width: tableWidth,
        height: headerHeight,
        color: rgb(0.94, 0.96, 0.98),
        borderColor: colors.border,
        borderWidth: 0.7,
      });
      let x = startX;
      columns.forEach((column) => {
        page.drawText(normalizePdfText(column.header.toUpperCase()), {
          x: x + 4,
          y: y - 14,
          size: 6.4,
          font: boldFont,
          color: colors.slate,
        });
        x += column.width;
      });
      y -= headerHeight;
    }

    drawHeader();
    rows.forEach((row, rowIndex) => {
      const cellLines = columns.map((column) => {
        if (column.type === "kol") return [collectibilityLabel(row[column.key])];
        return wrapPdfText(
          valueOrDash(row[column.key]),
          row.__isTotal || column.bold ? boldFont : regularFont,
          fontSize,
          column.width - 8,
        );
      });
      const rowHeight = Math.max(24, Math.max(...cellLines.map((lines) => lines.length)) * lineHeight + 12);
      if (y < margin + rowHeight + 24) {
        addPage(orientation);
        drawHeader();
      }
      page.drawRectangle({
        x: startX,
        y: y - rowHeight,
        width: tableWidth,
        height: rowHeight,
        color: row.__isTotal ? rgb(0.93, 0.96, 1) : rowIndex % 2 === 0 ? colors.white : rgb(0.985, 0.99, 0.995),
        borderColor: rgb(0.9, 0.92, 0.95),
        borderWidth: row.__isTotal ? 0.8 : 0.4,
      });
      let x = startX;
      columns.forEach((column, colIndex) => {
        if (colIndex > 0) {
          page.drawLine({
            start: { x, y },
            end: { x, y: y - rowHeight },
            thickness: 0.3,
            color: rgb(0.9, 0.92, 0.95),
          });
        }
        if (column.type === "kol") {
          if (!row.__isTotal) {
            drawKolBadge(row[column.key], x + 4, y - 17, column.width - 8);
          }
        } else {
          const cellValue = row[column.key];
          if (row.__isTotal && (cellValue === "" || cellValue === null || cellValue === undefined)) {
            x += column.width;
            return;
          }
          const lineOptions = {
            size: fontSize,
            lineHeight,
            maxLines: column.maxLines || 3,
            bold: Boolean(column.bold || row.__isTotal),
            color: colors.navy,
            align: column.align,
          };
          drawWrappedTextAt(cellValue, x + 4, y - 11, column.width - 8, lineOptions);
        }
        x += column.width;
      });
      y -= rowHeight;
    });
    y -= 12;
  }

  function isWriteOffFacility(facility) {
    const code = normalizeText(recordValue(facility, ["condition_code"]));
    const condition = normalizeText(idebFacilityCondition(facility)).toUpperCase();
    return code === "03" || condition.includes("HAPUS BUKU") || condition.includes("DIHAPUSBUKUKAN");
  }

  function facilityInitialPlafond(facility) {
    return (
      parseCurrencyNumber(
        recordValue(facility, ["initial_plafond", "plafond", "plafon_awal", "plafon"]),
      ) || 0
    );
  }

  function facilityCreditDisplay(facility) {
    const product = valueOrDash(recordValue(facility, ["credit_type", "credit_type_code"]));
    const scheme = valueOrDash(recordValue(facility, ["financing_scheme", "financing_scheme_code"]));
    if (product === "-" && scheme === "-") return "-";
    if (scheme === "-") return product;
    if (product === "-") return scheme;
    return `${product}\n${scheme}`;
  }

  function facilityAkadDate(facility) {
    return formatIdebDate(
      recordValue(facility, ["initial_akad_date", "final_akad_date", "start_date", "initial_credit_date"]),
    );
  }

  function facilityCollateralSummary(facility) {
    const items = Array.isArray(facility.collaterals) ? facility.collaterals : [];
    if (items.length === 0) return "-";
    const labels = items
      .slice(0, 2)
      .map((collateral) =>
        idebObjectLabel(collateral, [
          "type",
          "jenis_agunan",
          "jenisAgunan",
          "collateral_type",
          "agunanKet",
          "description",
          "keterangan",
        ]),
      )
      .filter((label) => label && label !== "-");
    if (labels.length === 0) return "-";
    return items.length > 2 ? `${labels.join(", ")} +${items.length - 2}` : labels.join(", ");
  }

  function facilityDaysPastDue(facility) {
    const value = parseCurrencyNumber(
      recordValue(facility, ["days_past_due", "dpd", "jumlah_hari_tunggakan"]),
    );
    return value === null ? null : value;
  }

  function reporterBreakdownText() {
    const stats = summary?.summary && typeof summary.summary === "object" ? summary.summary : {};
    const buckets = [
      ["Bank Umum", recordValue(stats, ["bank_creditor_count"])],
      ["BPR/BPRS", recordValue(stats, ["bpr_bprs_creditor_count"])],
      ["LP", recordValue(stats, ["lp_creditor_count"])],
      ["Lainnya", recordValue(stats, ["other_creditor_count"])],
    ]
      .map(([label, value]) => [label, parseCurrencyNumber(value) || 0])
      .filter(([, value]) => value > 0);
    if (buckets.length > 0) {
      return buckets.map(([label, value]) => `${formatIdebNumber(value)} ${label}`).join(", ");
    }
    if (metrics.reporterNames.length > 0) {
      return metrics.reporterNames.map((name, index) => `${index + 1}) ${name}`).join("  ");
    }
    return "-";
  }

  function drawCreditPositionTable() {
    const rows = metrics.facilities.map((facility) => ({
      reporter: valueOrDash(recordValue(facility, ["reporter_name", "reporter_code"])),
      product: facilityCreditDisplay(facility),
      akadDate: facilityAkadDate(facility),
      plafond: formatIdebMoney(facilityInitialPlafond(facility)),
      outstanding: formatIdebMoney(idebFacilityOutstanding(facility)),
      kol: recordValue(facility, ["collectibility", "collectibility_code", "kol"]),
      dpd:
        facilityDaysPastDue(facility) === null
          ? "-"
          : `${formatIdebNumber(facilityDaysPastDue(facility))} hari`,
      arrears: formatIdebMoney(idebFacilityArrears(facility)),
      collateral: facilityCollateralSummary(facility),
    }));
    const totalInitialPlafond = metrics.facilities.reduce(
      (total, facility) => total + facilityInitialPlafond(facility),
      0,
    );
    const totalOutstanding = metrics.facilities.reduce(
      (total, facility) => total + idebFacilityOutstanding(facility),
      0,
    );
    const totalArrears = metrics.facilities.reduce(
      (total, facility) => total + idebFacilityArrears(facility),
      0,
    );
    if (rows.length > 0) {
      rows.push({
        reporter: "TOTAL KESELURUHAN",
        product: "",
        akadDate: "",
        plafond: formatIdebMoney(totalInitialPlafond),
        outstanding: formatIdebMoney(totalOutstanding),
        kol: "",
        dpd: "",
        arrears: formatIdebMoney(totalArrears),
        collateral: "",
        __isTotal: true,
      });
    }
    drawTable(
      [
        { key: "reporter", header: "Pelapor", width: 102, bold: true, maxLines: 3 },
        { key: "product", header: "Jenis Kredit / Pembiayaan", width: 148, maxLines: 3 },
        { key: "akadDate", header: "Tanggal Akad", width: 62, maxLines: 2 },
        { key: "plafond", header: "Plafon Awal", width: 70, align: "right", maxLines: 2 },
        { key: "outstanding", header: "Baki Debet Saat Ini", width: 76, align: "right", maxLines: 2 },
        { key: "kol", header: "Kolektibilitas", width: 66, type: "kol" },
        { key: "dpd", header: "DPD / Hari Tunggakan", width: 62, align: "center", maxLines: 2 },
        { key: "arrears", header: "Tunggakan", width: 68, align: "right", maxLines: 2 },
        { key: "collateral", header: "Jaminan / Agunan", width: 115, maxLines: 3 },
      ],
      rows,
      {
        emptyTitle: "Ringkasan Posisi Fasilitas Kredit",
        emptyText: "Belum ada data fasilitas IDEB pada hasil ini.",
        fontSize: 6.5,
      },
    );
  }

  function drawReviewPanel(title, items, x, topY, width) {
    const innerPaddingX = 11;
    const contentTopGap = 42;
    const bottomPadding = 12;
    const gap = 12;
    const columns = 2;
    const innerWidth = width - innerPaddingX * 2;
    const columnWidth = (innerWidth - gap) / columns;
    const rows = [];

    for (let index = 0; index < items.length; ) {
      const first = items[index];
      if (first.fullWidth) {
        rows.push([{ ...first, __width: innerWidth }]);
        index += 1;
        continue;
      }

      rows.push(
        items.slice(index, index + columns).map((item) => ({
          ...item,
          __width: columnWidth,
        })),
      );
      index += columns;
    }

    const rowHeights = rows.map((rowItems) =>
      Math.max(
        23,
        ...rowItems.map((item) => {
          const maxLines = item.maxLines || (item.fullWidth ? 4 : 2);
          const valueHeight = measureWrappedTextHeight(item.value, item.__width, {
            size: 7.4,
            bold: Boolean(item.bold),
            maxLines,
            lineHeight: 8.8,
          });
          return 12 + valueHeight;
        }),
      ),
    );
    const height =
      contentTopGap +
      rowHeights.reduce((sum, rowHeight) => sum + rowHeight, 0) +
      Math.max(0, rowHeights.length - 1) * 8 +
      bottomPadding;

    page.drawRectangle({
      x,
      y: topY - height,
      width,
      height,
      color: colors.white,
      borderColor: colors.border,
      borderWidth: 0.8,
    });
    page.drawRectangle({
      x: x + 10,
      y: topY - 24,
      width: 7,
      height: 14,
      color: colors.yellow,
    });
    page.drawText(normalizePdfText(title), {
      x: x + 23,
      y: topY - 21,
      size: 9.2,
      font: boldFont,
      color: colors.navy,
    });

    let cursorY = topY - contentTopGap;
    rows.forEach((rowItems, rowIndex) => {
      rowItems.forEach((item, itemIndex) => {
        const cellWidth = item.__width;
        const cellX =
          x + innerPaddingX + (rowItems.length === 1 ? 0 : itemIndex * (columnWidth + gap));
        page.drawText(normalizePdfText(item.label.toUpperCase()), {
          x: cellX,
          y: cursorY,
          size: 5.8,
          font: boldFont,
          color: colors.muted,
        });
        drawWrappedTextAt(item.value, cellX, cursorY - 11, cellWidth, {
          size: 7.4,
          bold: Boolean(item.bold),
          maxLines: item.maxLines || (item.fullWidth ? 4 : 2),
          lineHeight: 8.8,
          color: colors.navy,
        });
      });
      cursorY -= rowHeights[rowIndex] + 8;
    });

    return height;
  }

  function drawHeaderBand(title, subtitle, metaLines = []) {
    const subtitleWidth = 430;
    const metaWidth = 238;
    const metaPaddingX = 10;
    const metaPaddingY = 9;
    const metaLineGap = 5;
    const subtitleHeight = measureWrappedTextHeight(subtitle, subtitleWidth, {
      size: 8.2,
      bold: true,
      maxLines: 2,
      lineHeight: 10.5,
    });
    const metaLineHeights = metaLines.map((line, index) =>
      measureWrappedTextHeight(line, metaWidth - metaPaddingX * 2, {
        size: index === 0 ? 7.3 : 6.8,
        bold: index === 0,
        maxLines: 2,
        lineHeight: index === 0 ? 9.5 : 9,
      }),
    );
    const metaContentHeight =
      metaLineHeights.reduce((sum, height) => sum + height, 0) +
      Math.max(0, metaLineHeights.length - 1) * metaLineGap;
    const metaPanelHeight = metaPaddingY * 2 + metaContentHeight;
    const bandHeight = Math.max(106, 34 + Math.max(subtitleHeight, metaPanelHeight) + 18);
    page.drawRectangle({
      x: 0,
      y: pageHeight - bandHeight,
      width: pageWidth,
      height: bandHeight,
      color: rgb(0.978, 0.986, 0.996),
    });
    page.drawRectangle({
      x: margin,
      y: pageHeight - margin - 8,
      width: 50,
      height: 5,
      color: colors.yellow,
    });
    page.drawText(normalizePdfText(title), {
      x: margin,
      y: pageHeight - margin - 28,
      size: 17,
      font: boldFont,
      color: colors.navy,
    });
    drawWrappedTextAt(subtitle, margin, pageHeight - margin - 48, 410, {
      size: 8.2,
      bold: true,
      maxLines: 2,
      color: colors.slate,
    });
    const metaX = pageWidth - margin - metaWidth;
    const metaTopY = pageHeight - margin - 10;
    page.drawRectangle({
      x: metaX,
      y: metaTopY - metaPanelHeight,
      width: metaWidth,
      height: metaPanelHeight,
      color: colors.panel,
      borderColor: colors.border,
      borderWidth: 0.7,
    });
    let metaCursorY = metaTopY - metaPaddingY;
    metaLines.forEach((line, index) => {
      const consumedHeight = drawWrappedTextAt(line, metaX + metaPaddingX, metaCursorY, metaWidth - metaPaddingX * 2, {
        size: index === 0 ? 7.3 : 6.8,
        bold: index === 0,
        maxLines: 2,
        lineHeight: index === 0 ? 9.5 : 9,
        color: index === 0 ? colors.navy : colors.slate,
      });
      metaCursorY -= consumedHeight + metaLineGap;
    });
    y = pageHeight - bandHeight - 18;
  }

  function shortPeriod(value) {
    const text = normalizeText(value);
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text);
    if (!match) return valueOrDash(text);
    const month = new Intl.DateTimeFormat("id-ID", { month: "short" }).format(
      new Date(Number(match[1]), Number(match[2]) - 1, 1),
    );
    return `${month} ${match[1].slice(2)}`;
  }

  function formatFileBytes(value) {
    const size = parseCurrencyNumber(value);
    if (!size || size <= 0) return "-";
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(size >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
    if (size >= 1024) return `${(size / 1024).toFixed(size >= 100 * 1024 ? 0 : 1)} KB`;
    return `${Math.round(size)} B`;
  }

  function drawHistoryMatrix(history) {
    if (history.length === 0) {
      drawNoteBox("Histori KOL", "Belum ada histori KOL bulanan di hasil IDEB ini.", {
        color: colors.softGray,
      });
      return;
    }

    const groups = new Map();
    history.forEach((entry) => {
      const key = [
        valueOrDash(recordValue(entry, ["reporter_name", "reporter_code"])),
        valueOrDash(recordValue(entry, ["account_number", "no_rekening"])),
      ].join(" | ");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });

    const meaningfulGroups = Array.from(groups.entries()).filter(([, entries]) =>
      entries.some(
        (entry) =>
          normalizeText(recordValue(entry, ["collectibility_code", "collectibility", "kol"])) ||
          normalizeText(recordValue(entry, ["days_past_due", "dpd"])),
      ),
    );

    if (meaningfulGroups.length === 0) {
      drawNoteBox(
        "Histori KOL",
        `Histori periode tersedia ${formatIdebNumber(history.length)} bulan, tetapi nilai KOL/DPD tidak tercatat pada file IDEB ini.`,
        { color: colors.softGray },
      );
      return;
    }

    for (const [label, entries] of meaningfulGroups) {
      const meaningfulEntries = entries
        .filter(
          (entry) =>
            normalizeText(recordValue(entry, ["collectibility_code", "collectibility", "kol"])) ||
            normalizeText(recordValue(entry, ["days_past_due", "dpd"])),
        )
        .sort((left, right) => {
        const leftIndex = parseCurrencyNumber(recordValue(left, ["month_index"])) || 0;
        const rightIndex = parseCurrencyNumber(recordValue(right, ["month_index"])) || 0;
        return leftIndex - rightIndex;
      });

      for (let start = 0; start < meaningfulEntries.length; start += 12) {
        const chunk = meaningfulEntries.slice(start, start + 12);
        const labelWidth = 150;
        const cellWidth = (contentWidth - labelWidth) / 12;
        const headerHeight = 18;
        const rowHeight = 34;
        ensureSpace(headerHeight + rowHeight + 14);
        page.drawRectangle({
          x: margin,
          y: y - headerHeight,
          width: contentWidth,
          height: headerHeight,
          color: rgb(0.94, 0.96, 0.98),
          borderColor: colors.border,
          borderWidth: 0.6,
        });
        page.drawText("FASILITAS", {
          x: margin + 5,
          y: y - 12,
          size: 6.4,
          font: boldFont,
          color: colors.slate,
        });
        chunk.forEach((entry, index) => {
          page.drawText(shortPeriod(recordValue(entry, ["period_month"])), {
            x: margin + labelWidth + index * cellWidth + 4,
            y: y - 12,
            size: 6.2,
            font: boldFont,
            color: colors.slate,
          });
        });
        y -= headerHeight;
        page.drawRectangle({
          x: margin,
          y: y - rowHeight,
          width: contentWidth,
          height: rowHeight,
          color: colors.white,
          borderColor: colors.border,
          borderWidth: 0.5,
        });
        drawWrappedTextAt(label, margin + 5, y - 11, labelWidth - 10, {
          size: 6.6,
          bold: true,
          maxLines: 2,
          lineHeight: 8.4,
        });
        chunk.forEach((entry, index) => {
          const x = margin + labelWidth + index * cellWidth;
          const kol = recordValue(entry, ["collectibility_code", "collectibility", "kol"]);
          const dpd = recordValue(entry, ["days_past_due", "dpd"]);
          const style = collectibilityColors(kol);
          page.drawRectangle({
            x,
            y: y - rowHeight,
            width: cellWidth,
            height: rowHeight,
            color: collectibilityLevel(kol) ? style.bg : colors.softGray,
            borderColor: colors.border,
            borderWidth: 0.35,
          });
          page.drawText(`KOL ${valueOrDash(kol)}`, {
            x: x + 4,
            y: y - 13,
            size: 6.2,
            font: boldFont,
            color: collectibilityLevel(kol) ? style.fg : colors.slate,
          });
          page.drawText(`DPD ${valueOrDash(dpd)}`, {
            x: x + 4,
            y: y - 25,
            size: 5.8,
            font: regularFont,
            color: collectibilityLevel(kol) ? style.fg : colors.slate,
          });
        });
        y -= rowHeight + 10;
      }
    }
  }

  function drawDocumentFooter() {
    const pages = pdfDoc.getPages();
    pages.forEach((pdfPage, index) => {
      const width = pdfPage.getWidth();
      pdfPage.drawLine({
        start: { x: margin, y: 24 },
        end: { x: width - margin, y: 24 },
        thickness: 0.4,
        color: colors.border,
      });
      pdfPage.drawText("Ruwang Arsip | Resume IDEB", {
        x: margin,
        y: 12,
        size: 6.5,
        font: regularFont,
        color: colors.muted,
      });
      pdfPage.drawText(`Halaman ${index + 1}/${pages.length}`, {
        x: width - margin - 52,
        y: 12,
        size: 6.5,
        font: regularFont,
        color: colors.muted,
      });
    });
  }

  const debtorName = recordValue(identity, ["name"]) || summary.debtor_name || upload?.debtor?.name;
  const identityNumber =
    recordValue(identity, ["identity_number"]) || summary.identity_number || upload?.debtor?.identity_number;
  const birthText = [
    recordValue(identity, ["birth_place"]),
    formatIdebDate(recordValue(identity, ["birth_date"])),
  ]
    .filter((value) => value && value !== "-")
    .join(" / ");
  const latestIdebDate = formatIdebDate(summary.result_date || summary.processed_at);
  const comparisonText =
    upload.debtor_id || upload.contract_id
      ? `Terhubung ke data internal: ${valueOrDash(upload?.debtor?.name || upload.debtor_id)}${
          upload?.contract?.no_kontrak ? `, kontrak ${upload.contract.no_kontrak}` : ""
        }. Perbandingan rinci tetap tersedia di modal Hasil IDEB pada aplikasi.`
      : "Belum terhubung ke debitur internal, sehingga perbandingan F01 internal belum tersedia.";
  const writeOffFacilities = metrics.facilities.filter(isWriteOffFacility);
  const writeOffPlafond = writeOffFacilities.reduce(
    (total, facility) => total + facilityInitialPlafond(facility),
    0,
  );
  const writeOffOutstanding = writeOffFacilities.reduce(
    (total, facility) => total + idebFacilityOutstanding(facility),
    0,
  );
  const writeOffArrears = writeOffFacilities.reduce(
    (total, facility) => total + idebFacilityArrears(facility),
    0,
  );
  const highestDaysPastDue = metrics.facilities.reduce((current, facility) => {
    const value = facilityDaysPastDue(facility);
    if (value === null) return current;
    return current === null ? value : Math.max(current, value);
  }, null);

  addPage("landscape");
  drawHeaderBand("RESUME HASIL IDEB", `${valueOrDash(debtorName)} | NIK ${valueOrDash(identityNumber)}`, [
    `Tanggal IDEB: ${latestIdebDate}`,
    `Petugas: ${valueOrDash(summary.officer_name)}`,
    `No Laporan: ${valueOrDash(summary.report_number)}`,
    `Bagian: ${formatIdebNumber(summary.received_parts || sourceFiles.length || 1)}/${formatIdebNumber(summary.total_parts || sourceFiles.length || 1)}`,
    `Referensi: ${valueOrDash(summary.reference_number)}`,
  ]);

  drawMetricGrid([
    {
      label: "KOL Terburuk",
      value: metrics.worstCollectibility,
      type: "kol",
      description: `${formatIdebNumber(metrics.reporterCount)} PJK | ${formatIdebNumber(
        metrics.activeFacilities.length,
      )} aktif | DPD ${highestDaysPastDue === null ? "-" : `${formatIdebNumber(highestDaysPastDue)} hari`}`,
    },
    {
      label: "Total Baki Debet Aktif",
      value: formatIdebMoney(metrics.activeOutstanding),
      small: true,
      description: `${formatIdebNumber(metrics.activeFacilities.length)} fasilitas aktif`,
    },
    {
      label: "Total Plafon Lunas",
      value: formatIdebMoney(metrics.paidOffPlafond),
      small: true,
      description: `${formatIdebNumber(metrics.paidOffFacilities.length)} fasilitas lunas`,
    },
    {
      label: "Pembiayaan Hapus Buku",
      value: formatIdebMoney(writeOffOutstanding || writeOffPlafond),
      small: true,
      description: `${formatIdebNumber(writeOffFacilities.length)} fasilitas | Tunggakan ${formatIdebMoney(
        writeOffArrears,
      )}`,
    },
  ]);

  const panelTop = y;
  const panelGap = 10;
  const panelWidth = (contentWidth - panelGap) / 2;
  const profilePanelHeight = drawReviewPanel(
    "PROFIL POKOK DEBITUR",
    [
      { label: "Nama Lengkap", value: debtorName, bold: true },
      { label: "Sektor Usaha", value: recordValue(identity, ["business_field", "business_field_code"]) },
      { label: "Tempat / Tanggal Lahir", value: birthText },
      { label: "Pekerjaan Utama", value: recordValue(identity, ["occupation", "occupation_code", "workplace"]) },
      { label: "Nomor Telp", value: idebContactText(identity) },
      { label: "NIK", value: identityNumber, bold: true },
      { label: "Jenis Kelamin", value: recordValue(identity, ["gender"]) },
      { label: "Alamat Terakhir", value: idebAddressText(identity), maxLines: 4, fullWidth: true },
    ],
    margin,
    panelTop,
    panelWidth,
  );
  const resumePanelHeight = drawReviewPanel(
    "RESUME HASIL IDEB",
    [
      { label: "Tanggal Pengecekan IDEB", value: latestIdebDate },
      { label: "Petugas", value: summary.officer_name },
      { label: "Jumlah Lembaga / PJK", value: formatIdebNumber(metrics.reporterCount), bold: true },
      { label: "Kualitas Terburuk", value: collectibilityLabel(metrics.worstCollectibility), bold: true },
      {
        label: "DPD Tertinggi",
        value: highestDaysPastDue === null ? "-" : `${formatIdebNumber(highestDaysPastDue)} hari`,
        bold: true,
      },
      { label: "Fasilitas Aktif", value: formatIdebNumber(metrics.activeFacilities.length) },
      { label: "Sisa Baki Debet", value: formatIdebMoney(metrics.activeOutstanding), bold: true },
      { label: "Total Plafon", value: formatIdebMoney(metrics.totalPlafond), bold: true },
      { label: "Total Tunggakan", value: formatIdebMoney(metrics.totalArrears), bold: true },
    ],
    margin + panelWidth + panelGap,
    panelTop,
    panelWidth,
  );
  y -= Math.max(profilePanelHeight, resumePanelHeight) + 14;

  drawNoteBox(
    "JUMLAH LEMBAGA PEMBUAT PELAPORAN/KREDITUR",
    reporterBreakdownText(),
    { color: rgb(0.985, 0.99, 0.995) },
  );

  drawSectionTitle("RINGKASAN POSISI FASILITAS KREDIT");
  drawCreditPositionTable();

  addPage("landscape");
  drawHeaderBand("DETAIL LANJUTAN IDEB", `${valueOrDash(debtorName)} | ${valueOrDash(identityNumber)}`, [
    `Tanggal IDEB: ${latestIdebDate}`,
    `Format: ${idebSourceFormatLabel(summary.source_format)}`,
    `Bagian: ${formatIdebNumber(summary.received_parts || sourceFiles.length || 1)}/${formatIdebNumber(summary.total_parts || sourceFiles.length || 1)}`,
  ]);

  drawSectionTitle("PERBANDINGAN DENGAN F01 INTERNAL");
  drawNoteBox(upload.debtor_id || upload.contract_id ? "Status: Terhubung" : "Status: Belum terhubung", comparisonText, {
    color: upload.debtor_id || upload.contract_id ? rgb(0.94, 0.99, 0.96) : rgb(0.98, 0.98, 0.98),
    borderColor: upload.debtor_id || upload.contract_id ? rgb(0.65, 0.88, 0.72) : colors.border,
  });

  drawSectionTitle("HISTORI KOL");
  drawHistoryMatrix(monthlyHistory);

  drawSectionTitle("AGUNAN");
  drawTable(
    [
      { key: "no", header: "No", width: 28, bold: true, maxLines: 1 },
      { key: "type", header: "Jenis Agunan", width: 190, maxLines: 2 },
      { key: "value", header: "Nilai", width: 95, maxLines: 1 },
      { key: "location", header: "Lokasi", width: 330, maxLines: 3 },
    ],
    collaterals.slice(0, 20).map((collateral, index) => ({
      no: String(index + 1),
      type: idebObjectLabel(collateral, ["type", "jenis_agunan", "jenisAgunan", "collateral_type", "agunanKet"]),
      value: formatIdebMoney(recordValue(collateral, ["value", "nilai", "nilai_agunan", "market_value"])),
      location: idebObjectLabel(collateral, ["location", "alamat", "address", "lokasi"]),
    })),
    {
      emptyTitle: "Agunan",
      emptyText: "Tidak ada data agunan pada file IDEB ini.",
    },
  );

  drawSectionTitle("PENJAMIN");
  drawTable(
    [
      { key: "no", header: "No", width: 28, bold: true, maxLines: 1 },
      { key: "name", header: "Nama Penjamin", width: 190, maxLines: 2 },
      { key: "identity", header: "Identitas", width: 135, maxLines: 2 },
      { key: "address", header: "Alamat", width: 290, maxLines: 3 },
    ],
    guarantors.slice(0, 20).map((guarantor, index) => ({
      no: String(index + 1),
      name: idebObjectLabel(guarantor, ["name", "nama", "nama_penjamin", "namaPenjamin"]),
      identity: idebObjectLabel(guarantor, ["identity_number", "no_identitas", "nik", "npwp"]),
      address: idebObjectLabel(guarantor, ["address", "alamat"]),
    })),
    {
      emptyTitle: "Penjamin",
      emptyText: "Tidak ada data penjamin pada file IDEB ini.",
    },
  );

  drawDocumentFooter();

  const bytes = await pdfDoc.save();
  return {
    buffer: Buffer.from(bytes),
    fileName: safeIdebPdfFileName(summary),
  };
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
    const inferredContract = await tx.debtor_contracts.findFirst({
      where: { no_kontrak: summary.contract_number, deleted_at: null },
      select: { id: true, debtor_id: true, no_kontrak: true },
    });
    if (inferredContract && (!debtorId || inferredContract.debtor_id === debtorId)) {
      contract = inferredContract;
      contractId = inferredContract.id;
    }
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

exports.getPendingIdeb = async ({ req, query }) => {
  const pagination = resolvePagination(query, PAGINATION_PROFILES.TABLE);
  const where = {
    deleted_at: null,
    OR: [
      { debtor_id: null },
      {
        import_job: {
          is: {
            records: {
              some: {
                source_type: "IDEB",
                status: "MATCH_PENDING",
                deleted_at: null,
              },
            },
          },
        },
      },
    ],
  };
  const [data, total] = await Promise.all([
    repository.findPendingIdebUploads({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { created_at: "desc" },
    }),
    repository.countPendingIdebUploads(where),
  ]);

  return {
    data: data.map((item) => serializeIdebPendingUpload(req, item)),
    meta: buildPaginationMeta(total, pagination),
  };
};

function buildIdebReportWhere(query = {}) {
  const clauses = [{ deleted_at: null }];
  const linkStatus = normalizeUpper(query.link_status || query.status_link);
  const periodMonth = normalizeText(query.period_month);
  const search = normalizeText(query.search);

  if (linkStatus === "TERHUBUNG" || linkStatus === "LINKED") {
    clauses.push({ debtor_id: { not: null } });
  }
  if (linkStatus === "BELUM_TERHUBUNG" || linkStatus === "UNLINKED") {
    clauses.push({ debtor_id: null });
  }
  if (periodMonth) {
    const period = parsePeriodParts(periodMonth);
    clauses.push({ year: period.year, month: period.month });
  }
  if (search) {
    clauses.push({
      OR: [
        { file_name: { contains: search, mode: "insensitive" } },
        { debtor: { is: { name: { contains: search, mode: "insensitive" } } } },
        { debtor: { is: { identity_number: { contains: search } } } },
        { debtor: { is: { debtor_number: { contains: search } } } },
        {
          result_summary: {
            path: ["debtor_name"],
            string_contains: search,
            mode: "insensitive",
          },
        },
        {
          result_summary: {
            path: ["identity_number"],
            string_contains: search,
          },
        },
        {
          result_summary: {
            path: ["contract_number"],
            string_contains: search,
            mode: "insensitive",
          },
        },
        {
          result_summary: {
            path: ["report_number"],
            string_contains: search,
            mode: "insensitive",
          },
        },
      ],
    });
  }

  return { AND: clauses };
}

exports.getIdebReports = async ({ req, query }) => {
  const pagination = resolvePagination(query, PAGINATION_PROFILES.TABLE);
  const where = buildIdebReportWhere(query);
  const [data, total] = await Promise.all([
    repository.findIdebReports({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { created_at: "desc" },
    }),
    repository.countIdebReports(where),
  ]);

  return {
    data: data.map((item) => serializeIdebReportUpload(req, item)),
    meta: buildPaginationMeta(total, pagination),
  };
};

exports.getIdebReportDetail = async ({ req, uploadId }) => {
  const upload = await repository.findIdebUploadById(uploadId);
  if (!upload) throw new AppError("Laporan IDEB tidak ditemukan.", 404);
  return serializeIdebReportUpload(req, upload);
};

exports.resolveIdeb = async ({ req, uploadId, payload, userId }) => {
  const resolved = await repository.transaction(async (tx) => {
    const upload = await repository.findIdebUploadById(uploadId, tx);
    if (!upload) throw new AppError("Upload IDEB tidak ditemukan.", 404);
    const targets = await ensureResolveTargets(tx, payload);

    await tx.debtor_ideb_uploads.update({
      where: { id: upload.id },
      data: {
        debtor_id: targets.debtorId,
        contract_id: targets.contractId,
        updated_by: userId || null,
      },
    });

    await tx.debtor_external_records.updateMany({
      where: {
        source_type: "IDEB",
        deleted_at: null,
        OR: [
          upload.import_job_id ? { import_job_id: upload.import_job_id } : null,
          upload.file_path ? { file_path: upload.file_path } : null,
        ].filter(Boolean),
      },
      data: {
        debtor_id: targets.debtorId,
        contract_id: targets.contractId,
        status: "MATCHED",
        updated_by: userId || null,
      },
    });

    return tx.debtor_ideb_uploads.findFirst({
      where: { id: upload.id, deleted_at: null },
      include: {
        import_job: {
          include: {
            records: {
              where: {
                deleted_at: null,
                source_type: "IDEB",
              },
            },
          },
        },
        debtor: {
          select: {
            id: true,
            debtor_number: true,
            identity_number: true,
            name: true,
          },
        },
        contract: {
          select: {
            id: true,
            debtor_id: true,
            no_kontrak: true,
            status: true,
          },
        },
      },
    });
  });

  return serializeIdebPendingUpload(req, resolved);
};

exports.getIdebResumePdf = async ({ uploadId }) => {
  const upload = await repository.findIdebUploadById(uploadId);
  if (!upload) throw new AppError("Upload IDEB tidak ditemukan.", 404);
  if (!upload.result_summary || typeof upload.result_summary !== "object") {
    throw new AppError("Ringkasan hasil IDEB belum tersedia.", 422);
  }

  return renderIdebResumePdf(upload);
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
  const idebImport =
    normalizedType === "IDEB" ? buildIdebImportPayload(fileMetas) : null;
  const idebRaw = idebImport?.raw || null;
  const idebSummary = idebImport?.summary || null;
  const resolvedPeriodMonth =
    slikMetadata?.period_month ||
    normalizeText(payload.period_month) ||
    idebSummary?.period_month ||
    null;

  const job = await repository.transaction(async (tx) => {
    const created = await tx.debtor_import_jobs.create({
      data: {
        type: normalizedType,
        status: normalizedType === "SLIK" ? "PENDING" : "COMPLETED",
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
            ? idebSummary?.received_parts || fileMetas.length
            : payload.total_rows || 0,
        success_rows:
          normalizedType === "IDEB" ? idebSummary?.received_parts || fileMetas.length : 0,
        failed_rows: 0,
        completed_at: normalizedType === "SLIK" ? null : new Date(),
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
            format: idebSummary.source_format || "IDEB_JSON",
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
      const upload = await tx.debtor_ideb_uploads.create({
        data: {
          import_job_id: created.id,
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
      await tx.debtor_ideb_upload_files.createMany({
        data: (idebImport?.parts || []).map((part) => ({
          id: crypto.randomUUID(),
          upload_id: upload.id,
          part_number: part.part_number || 1,
          total_parts: part.total_parts || idebSummary.total_parts || 1,
          file_path: part.file_path,
          file_name: part.file_name,
          mime_type: part.mime_type,
          size_bytes: part.size_bytes,
          checksum: part.checksum,
        })),
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

  const fixedCollectibility =
    FIXED_COLLECTIBILITY_LEVELS[normalizedLevel] || {
      code: `KOL_${normalizedLevel}`,
      name: `Kolektibilitas ${normalizedLevel}`,
      is_npf: normalizedLevel >= 3,
    };

  const collectibility = await tx.collectibility_levels.create({
    data: {
      code: fixedCollectibility.code,
      level: normalizedLevel,
      name: fixedCollectibility.name,
      is_npf: fixedCollectibility.is_npf,
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

async function reconcilePendingCollateralsForContract(
  tx,
  contract,
  summary,
  periodMonth,
  userId,
) {
  const facilityNumber =
    normalizeText(summary.facility_number) ||
    normalizeText(summary.contract_number) ||
    normalizeText(contract?.no_kontrak);
  if (!contract?.id || !facilityNumber || !periodMonth) return 0;

  const pendingCollaterals = await tx.debtor_collaterals.findMany({
    where: {
      facility_number: facilityNumber,
      period_month: periodMonth,
      contract_id: null,
      deleted_at: null,
      OR: [
        { debtor_id: null },
        { debtor_id: contract.debtor_id },
      ],
    },
    select: {
      id: true,
      collateral_number: true,
    },
  });
  if (pendingCollaterals.length === 0) return 0;

  const collateralIds = pendingCollaterals.map((item) => item.id);
  const collateralNumbers = pendingCollaterals
    .map((item) => normalizeText(item.collateral_number))
    .filter(Boolean);

  await tx.debtor_collaterals.updateMany({
    where: {
      id: { in: collateralIds },
    },
    data: {
      debtor_id: contract.debtor_id,
      contract_id: contract.id,
      updated_by: userId || null,
    },
  });

  if (collateralNumbers.length > 0) {
    await tx.debtor_slik_records.updateMany({
      where: {
        segment: "A01",
        period_month: periodMonth,
        raw_key: { in: collateralNumbers },
        status: "MATCH_PENDING",
      },
      data: {
        debtor_id: contract.debtor_id,
        contract_id: contract.id,
        status: "IMPORTED",
        error_message: null,
      },
    });
  }

  return pendingCollaterals.length;
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
    unmappedReferences: [],
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
    unmapped_reference_codes: progress.unmappedReferences,
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
  let unmappedReferences = [];
  let successRows = 0;
  let failedRows = 0;

  await prefetchRows(tx, segment.segment, rows, context);

  for (const row of rows) {
    unmappedReferences = mergeUnmappedSlikReferences(
      unmappedReferences,
      collectUnmappedSlikReferences(segment.segment, row.summary),
    );

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
        await reconcilePendingCollateralsForContract(
          tx,
          contract,
          row.summary,
          periodMonth,
          userId,
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
    unmappedReferences,
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

  progress.unmappedReferences = mergeUnmappedSlikReferences(
    progress.unmappedReferences,
    result.unmappedReferences || [],
  );

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
