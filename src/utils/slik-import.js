const path = require("path");
const readline = require("readline");

const SLIK_FILE_NAME_PATTERN =
  /^(?<reporter_type>\d{4})\.(?<reporter_code>\d{6})\.(?<year>\d{4})\.(?<month>\d{2})\.(?<segment>[A-Z]\d{2})\.(?<sequence>\d+)\.txt$/i;

const SUPPORTED_SEGMENTS = new Set([
  "A01",
  "D01",
  "D02",
  "F01",
  "F02",
  "F06",
  "K01",
  "M01",
  "P01",
]);
const IMPORTABLE_SEGMENTS = new Set(["D01", "D02", "F01", "A01"]);
const EXPECTED_DATA_FIELD_COUNTS = {
  D01: 38,
  D02: 30,
  F01: 47,
  A01: 27,
};

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().replace(/\s+/g, " ");
  return normalized || null;
}

function normalizeUpper(value) {
  const text = normalizeText(value);
  return text ? text.toUpperCase() : null;
}

function parseInteger(value, fallback = 0) {
  const text = normalizeText(value);
  if (!text) return fallback;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDecimal(value, fallback = 0) {
  const text = normalizeText(value);
  if (!text) return fallback;
  const parsed = Number(String(text).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNullableDecimal(value) {
  return parseDecimal(value, null);
}

function parseSlikDate(value) {
  const text = normalizeText(value);
  if (!text || !/^\d{8}$/.test(text)) return null;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function calculateTenorMonths(startValue, endValue) {
  const startDate = parseSlikDate(startValue);
  const endDate = parseSlikDate(endValue);
  if (!startDate || !endDate || endDate <= startDate) return 1;

  const yearDiff = endDate.getUTCFullYear() - startDate.getUTCFullYear();
  const monthDiff = endDate.getUTCMonth() - startDate.getUTCMonth();
  const dayAdjustment = endDate.getUTCDate() < startDate.getUTCDate() ? -1 : 0;
  return Math.max(yearDiff * 12 + monthDiff + dayAdjustment, 1);
}

function resolveCifStatus(segment, providedStatus, expectedStatus) {
  const status = normalizeUpper(providedStatus);
  if (!status) {
    return expectedStatus;
  }
  if (status !== expectedStatus) {
    throw new Error(
      `Status CIF ${status} tidak sesuai segmen ${segment}. Segmen ${segment} harus berstatus ${expectedStatus}.`,
    );
  }
  return status;
}

function expectedCifStatusForSegment(segment) {
  if (segment === "D01") return "I";
  if (segment === "D02") return "B";
  return null;
}

function parsePeriodFromHeader(headerFields) {
  const year = headerFields[3];
  const month = headerFields[4];
  if (!/^\d{4}$/.test(year || "") || !/^(0[1-9]|1[0-2])$/.test(month || "")) {
    return null;
  }

  return `${year}-${month}`;
}

function parseFileName(fileName) {
  const baseName = path.basename(String(fileName || ""));
  const match = baseName.match(SLIK_FILE_NAME_PATTERN);
  if (!match?.groups) return null;

  return {
    reporter_type: match.groups.reporter_type,
    reporter_code: match.groups.reporter_code,
    year: match.groups.year,
    month: match.groups.month,
    period_month: `${match.groups.year}-${match.groups.month}`,
    segment: match.groups.segment.toUpperCase(),
    sequence: parseInteger(match.groups.sequence, 1),
  };
}

function readText(buffer) {
  return Buffer.from(buffer)
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function summarizeRow(segment, fields, options = {}) {
  switch (segment) {
    case "D01": {
      const statusCode = resolveCifStatus(segment, options.cifStatus, "I");
      return {
        debtor_number: normalizeText(fields[1]),
        identity_number: normalizeText(fields[3]),
        name: normalizeText(fields[4]) || normalizeText(fields[5]),
        address: [fields[11], fields[12], fields[13], fields[14], fields[15]]
          .map(normalizeText)
          .filter(Boolean)
          .join(", "),
        phone: normalizeText(fields[17]),
        branch_code: normalizeText(fields[37]),
        customer_type: "INDIVIDUAL",
        slik_segment: "D01",
        slik_status_code: statusCode,
        slik_operation_code: normalizeUpper(fields[38]),
        profile: {
          identity_type_code: normalizeText(fields[2]),
          name_as_identity: normalizeText(fields[4]),
          full_name: normalizeText(fields[5]),
          education_degree_code: normalizeText(fields[6]),
          gender: normalizeText(fields[7]),
          birth_place: normalizeText(fields[8]),
          birth_date: normalizeText(fields[9]),
          tax_number: normalizeText(fields[10]),
          address_detail: normalizeText(fields[11]),
          village: normalizeText(fields[12]),
          district: normalizeText(fields[13]),
          city_code: normalizeText(fields[14]),
          postal_code: normalizeText(fields[15]),
          phone: normalizeText(fields[16]),
          mobile_phone: normalizeText(fields[17]),
          email: normalizeText(fields[18]),
          domicile_country_code: normalizeText(fields[19]),
          occupation_code: normalizeText(fields[20]),
          workplace: normalizeText(fields[21]),
          workplace_business_field_code: normalizeText(fields[22]),
          workplace_address: normalizeText(fields[23]),
          annual_gross_income: parseDecimal(fields[24]),
          income_source_code: normalizeText(fields[25]),
          dependent_count: parseInteger(fields[26], 0),
          relationship_with_reporter_code: normalizeText(fields[27]),
          debtor_group_code: normalizeText(fields[28]),
          marital_status_code: normalizeText(fields[29]),
          spouse_identity_number: normalizeText(fields[30]),
          spouse_name: normalizeText(fields[31]),
          spouse_birth_date: normalizeText(fields[32]),
          separate_assets_agreement: normalizeText(fields[33]),
          violates_bmpk: normalizeText(fields[34]),
          exceeds_bmpk: normalizeText(fields[35]),
          mother_maiden_name: normalizeText(fields[36]),
          branch_code: normalizeText(fields[37]),
          operation_code: normalizeUpper(fields[38]),
          status_code: statusCode,
        },
      };
    }
    case "D02": {
      const statusCode = resolveCifStatus(segment, options.cifStatus, "B");
      return {
        debtor_number: normalizeText(fields[1]),
        identity_number: normalizeText(fields[2]),
        name: normalizeText(fields[3]),
        address: [fields[13], fields[14], fields[15], fields[16], fields[17]]
          .map(normalizeText)
          .filter(Boolean)
          .join(", "),
        phone: normalizeText(fields[10]),
        branch_code: normalizeText(fields[29]),
        customer_type: "LEGAL_ENTITY",
        slik_segment: "D02",
        slik_status_code: statusCode,
        slik_operation_code: normalizeUpper(fields[30]),
        profile: {
          business_identity_number: normalizeText(fields[2]),
          business_name: normalizeText(fields[3]),
          legal_form_code: normalizeText(fields[4]),
          establishment_place: normalizeText(fields[5]),
          establishment_deed_number: normalizeText(fields[6]),
          establishment_deed_date: normalizeText(fields[7]),
          latest_amendment_deed_number: normalizeText(fields[8]),
          latest_amendment_deed_date: normalizeText(fields[9]),
          phone: normalizeText(fields[10]),
          mobile_phone: normalizeText(fields[11]),
          email: normalizeText(fields[12]),
          address_detail: normalizeText(fields[13]),
          village: normalizeText(fields[14]),
          district: normalizeText(fields[15]),
          city_code: normalizeText(fields[16]),
          postal_code: normalizeText(fields[17]),
          domicile_country_code: normalizeText(fields[18]),
          business_field_code: normalizeText(fields[19]),
          relationship_with_reporter_code: normalizeText(fields[20]),
          violates_bmpk: normalizeText(fields[21]),
          exceeds_bmpk: normalizeText(fields[22]),
          go_public: normalizeText(fields[23]),
          debtor_group_code: normalizeText(fields[24]),
          rating: normalizeText(fields[25]),
          rating_agency: normalizeText(fields[26]),
          rating_date: normalizeText(fields[27]),
          debtor_group_name: normalizeText(fields[28]),
          branch_code: normalizeText(fields[29]),
          operation_code: normalizeUpper(fields[30]),
          status_code: statusCode,
        },
      };
    }
    case "F01":
      return {
        segment,
        facility_number: normalizeText(fields[1]),
        debtor_number: normalizeText(fields[2]),
        credit_nature_code: normalizeText(fields[3]),
        credit_type_code: normalizeText(fields[4]),
        product_code: normalizeText(fields[4]),
        contract_number: normalizeText(fields[1]),
        financing_scheme_code: normalizeText(fields[5]),
        akad_code: normalizeText(fields[5]),
        initial_akad_number: normalizeText(fields[6]),
        initial_akad_date: normalizeText(fields[7]),
        final_akad_number: normalizeText(fields[8]),
        final_akad_date: normalizeText(fields[9]),
        akad_date: normalizeText(fields[9]) || normalizeText(fields[7]),
        new_or_extension_code: normalizeText(fields[10]),
        credit_start_date: normalizeText(fields[11]),
        start_date:
          normalizeText(fields[12]) ||
          normalizeText(fields[11]) ||
          normalizeText(fields[7]) ||
          normalizeText(fields[9]),
        due_date: normalizeText(fields[13]),
        debtor_category_code: normalizeText(fields[14]),
        usage_type_code: normalizeText(fields[15]),
        usage_orientation_code: normalizeText(fields[16]),
        economic_sector_code: normalizeText(fields[17]),
        project_location_city_code: normalizeText(fields[18]),
        project_value: parseNullableDecimal(fields[19]),
        currency_code: normalizeText(fields[20]),
        interest_rate: parseNullableDecimal(fields[21]),
        interest_type_code: normalizeText(fields[22]),
        government_program_code: normalizeText(fields[23]),
        takeover_from: normalizeText(fields[24]),
        source_of_funds_code: normalizeText(fields[25]),
        initial_plafond: parseNullableDecimal(fields[26]),
        tenor: calculateTenorMonths(
          normalizeText(fields[12]) ||
            normalizeText(fields[11]) ||
            normalizeText(fields[7]) ||
            normalizeText(fields[9]),
          fields[13],
        ),
        plafond: parseNullableDecimal(fields[27]),
        pokok: parseNullableDecimal(fields[27]),
        current_month_disbursement: parseNullableDecimal(fields[28]),
        penalty: parseNullableDecimal(fields[29]),
        baki_debet: parseNullableDecimal(fields[30]),
        outstanding_pokok: parseNullableDecimal(fields[30]),
        original_currency_amount: parseNullableDecimal(fields[31]),
        collectibility_code: normalizeText(fields[32]),
        outstanding_margin: parseNullableDecimal(fields[36]),
        margin: parseNullableDecimal(fields[36]),
        collectibility_level: parseInteger(fields[32], 1),
        default_date: normalizeText(fields[33]),
        default_reason_code: normalizeText(fields[34]),
        principal_arrears: parseNullableDecimal(fields[35]),
        margin_arrears: parseNullableDecimal(fields[36]),
        dpd: parseInteger(fields[37], 0),
        days_past_due: parseInteger(fields[37], 0),
        arrears_frequency: parseInteger(fields[38], null),
        restructuring_frequency: parseInteger(fields[39], null),
        initial_restructuring_date: normalizeText(fields[40]),
        final_restructuring_date: normalizeText(fields[41]),
        restructuring_method_code: normalizeText(fields[42]),
        condition_code: normalizeText(fields[43]),
        condition_date: normalizeText(fields[44]),
        object_description: normalizeText(fields[45]),
        description: normalizeText(fields[45]),
        branch_code: normalizeText(fields[46]),
        operation_code: normalizeUpper(fields[47]),
      };
    case "F02":
    case "F06":
      return {
        segment,
        facility_number: normalizeText(fields[1]),
        debtor_number: normalizeText(fields[2]),
        raw_key: normalizeText(fields[1]) || normalizeText(fields[2]),
        canonical_status: "RAW_PENDING",
        canonical_message: `Segmen ${segment} belum dipetakan ke kontrak canonical.`,
      };
    case "A01":
      return {
        collateral_number: normalizeText(fields[1]),
        facility_number: normalizeText(fields[2]),
        debtor_number: normalizeText(fields[3]),
        facility_segment_code: normalizeText(fields[4]),
        collateral_status_code: normalizeText(fields[5]),
        collateral_type: normalizeText(fields[6]),
        rating: normalizeText(fields[7]),
        rating_agency_code: normalizeText(fields[8]),
        binding_type_code: normalizeText(fields[9]),
        binding_date: normalizeText(fields[10]),
        owner_name: normalizeText(fields[11]),
        proof_number: normalizeText(fields[12]),
        address: normalizeText(fields[13]),
        location_city_code: normalizeText(fields[14]),
        market_value: parseNullableDecimal(fields[15]),
        appraisal_value: parseNullableDecimal(fields[16]),
        reporter_appraisal_date: normalizeText(fields[17]),
        independent_appraisal_value: parseNullableDecimal(fields[18]),
        independent_appraiser_name: normalizeText(fields[19]),
        independent_appraisal_date: normalizeText(fields[20]),
        paripasu_status: normalizeText(fields[21]),
        paripasu_percentage: parseNullableDecimal(fields[22]),
        joint_credit_status: normalizeText(fields[23]),
        insured_status: normalizeText(fields[24]),
        description: normalizeText(fields[25]),
        branch_code: normalizeText(fields[26]),
        operation_code: normalizeUpper(fields[27]),
      };
    case "M01":
    case "P01":
    case "K01":
    default:
      return {
        raw_key: normalizeText(fields[1]) || normalizeText(fields[2]),
      };
  }
}

function validateImportOptions(options) {
  if (!options.importSegment) {
    throw new Error("Jenis import SLIK wajib dipilih: D01, D02, F01, atau A01.");
  }
  if (!IMPORTABLE_SEGMENTS.has(options.importSegment)) {
    throw new Error(`Jenis import SLIK ${options.importSegment} tidak didukung.`);
  }
  if (options.importSegment === "F01" && !options.expectedPeriod) {
    throw new Error("Periode Data wajib dipilih untuk import F01.");
  }

  const expectedCifStatus = expectedCifStatusForSegment(options.importSegment);
  if (expectedCifStatus) {
    if (options.cifStatus && options.cifStatus !== expectedCifStatus) {
      throw new Error(
        `Status CIF ${options.cifStatus} tidak sesuai segmen ${options.importSegment}. Segmen ${options.importSegment} harus berstatus ${expectedCifStatus}.`,
      );
    }
    options.cifStatus = expectedCifStatus;
  } else if (options.cifStatus) {
    throw new Error("Status CIF hanya boleh diisi untuk import D01 atau D02.");
  }

  return options;
}

function prepareParseOptions(optionsOrExpectedPeriod = null) {
  return validateImportOptions(normalizeParseOptions(optionsOrExpectedPeriod));
}

function validateSlikFileMeta(fileName, options = {}) {
  const fileNameMeta = parseFileName(fileName);
  if (!fileNameMeta) {
    throw new Error(
      `Nama file ${fileName} tidak sesuai pola SLIK OJK: KODEJENIS.KODEPELAPOR.YYYY.MM.SEGMEN.URUTAN.txt.`,
    );
  }
  if (!SUPPORTED_SEGMENTS.has(fileNameMeta.segment)) {
    throw new Error(`Segmen ${fileNameMeta.segment} pada file ${fileName} belum didukung.`);
  }
  if (!IMPORTABLE_SEGMENTS.has(fileNameMeta.segment)) {
    throw new Error(
      `Segmen ${fileNameMeta.segment} belum menjadi target import Informasi Debitur. Gunakan D01, D02, F01, atau A01.`,
    );
  }
  if (options.importSegment && fileNameMeta.segment !== options.importSegment) {
    throw new Error(
      `File ${fileName} berisi segmen ${fileNameMeta.segment}, tidak sesuai pilihan import ${options.importSegment}.`,
    );
  }

  return fileNameMeta;
}

function parseSlikHeaderLine(line, fileNameMeta, fileName, options = {}) {
  const headerFields = line.split("|");
  if (headerFields[0] !== "H") {
    throw new Error(`File ${fileName} tidak memiliki header H.`);
  }

  const headerSegment = normalizeUpper(headerFields[5]);
  if (headerSegment !== fileNameMeta.segment) {
    throw new Error(
      `Segmen header ${headerSegment || "-"} tidak sesuai nama file ${fileNameMeta.segment}.`,
    );
  }

  const headerPeriod = parsePeriodFromHeader(headerFields);
  if (headerPeriod !== fileNameMeta.period_month) {
    throw new Error(
      `Periode header ${headerPeriod || "-"} tidak sesuai nama file ${fileNameMeta.period_month}.`,
    );
  }
  if (options.expectedPeriod && options.expectedPeriod !== headerPeriod) {
    throw new Error(`Periode form ${options.expectedPeriod} tidak sesuai file SLIK ${headerPeriod}.`);
  }

  return {
    headerFields,
    period_month: headerPeriod,
    declared_rows: parseInteger(headerFields[6], 0),
  };
}

function parseSlikDataLine(line, fileNameMeta, fileName, rowNumber, lineNumber, options = {}) {
  const fields = line.split("|");
  if (fields[0] !== "D") {
    throw new Error(`Baris ${lineNumber} pada file ${fileName} tidak diawali D.`);
  }
  const expectedFieldCount = EXPECTED_DATA_FIELD_COUNTS[fileNameMeta.segment];
  const actualFieldCount = fields.length - 1;
  if (expectedFieldCount && actualFieldCount !== expectedFieldCount) {
    throw new Error(
      `Jumlah field data baris ${lineNumber} file ${fileName} tidak sesuai template ${fileNameMeta.segment}: ` +
        `expected ${expectedFieldCount}, actual ${actualFieldCount}. Periksa delimiter "|".`,
    );
  }

  return {
    row_number: rowNumber,
    fields,
    summary: summarizeRow(fileNameMeta.segment, fields, options),
  };
}

function normalizeInputLine(line, isFirstLine = false) {
  const text = String(line || "").trim();
  return isFirstLine ? text.replace(/^\uFEFF/, "") : text;
}

function parseSlikTextFile(file, options = {}) {
  const fileName = String(file.name || "").trim();
  const fileNameMeta = validateSlikFileMeta(fileName, options);
  const text = readText(file.buffer);
  const lines = text.split("\n").map((line, index) => normalizeInputLine(line, index === 0)).filter(Boolean);
  if (lines.length === 0) {
    throw new Error(`File ${fileName} kosong.`);
  }

  const header = parseSlikHeaderLine(lines[0], fileNameMeta, fileName, options);
  const rows = [];
  for (let index = 1; index < lines.length; index += 1) {
    rows.push(parseSlikDataLine(lines[index], fileNameMeta, fileName, index, index + 1, options));
  }

  if (header.declared_rows !== rows.length) {
    throw new Error(
      `Jumlah baris file ${fileName} tidak sesuai header: header ${header.declared_rows}, aktual ${rows.length}.`,
    );
  }

  return {
    file_name: path.basename(fileName),
    ...fileNameMeta,
    declared_rows: header.declared_rows,
    actual_rows: rows.length,
    rows,
  };
}

async function streamSlikTextFile({
  fileName,
  stream,
  options = {},
  batchSize = 1000,
  maxRows = null,
  onSegment,
  onRows,
}) {
  const normalizedFileName = String(fileName || "").trim();
  const fileNameMeta = validateSlikFileMeta(normalizedFileName, options);
  const safeBatchSize = Math.max(Number(batchSize) || 1000, 1);
  const rowLimit = Number(maxRows) > 0 ? Number(maxRows) : null;
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  let lineNumber = 0;
  let rowNumber = 0;
  let header = null;
  let batch = [];

  async function flushBatch() {
    if (batch.length === 0) return;
    const rows = batch;
    batch = [];
    if (onRows) {
      await onRows({
        file_name: path.basename(normalizedFileName),
        ...fileNameMeta,
        declared_rows: header.declared_rows,
        actual_rows: rowNumber,
        rows,
      });
    }
  }

  for await (const rawLine of reader) {
    lineNumber += 1;
    const line = normalizeInputLine(rawLine, lineNumber === 1);
    if (!line) continue;

    if (!header) {
      header = parseSlikHeaderLine(line, fileNameMeta, normalizedFileName, options);
      if (onSegment) {
        await onSegment({
          file_name: path.basename(normalizedFileName),
          ...fileNameMeta,
          declared_rows: header.declared_rows,
          actual_rows: 0,
        });
      }
      continue;
    }

    rowNumber += 1;
    if (rowLimit && rowNumber > rowLimit) {
      throw new Error(
        `Jumlah baris file ${normalizedFileName} melebihi batas ${rowLimit}.`,
      );
    }

    batch.push(
      parseSlikDataLine(
        line,
        fileNameMeta,
        normalizedFileName,
        rowNumber,
        lineNumber,
        options,
      ),
    );
    if (batch.length >= safeBatchSize) {
      await flushBatch();
    }
  }

  if (!header) {
    throw new Error(`File ${normalizedFileName} kosong atau tidak memiliki header H.`);
  }

  await flushBatch();

  if (header.declared_rows !== rowNumber) {
    throw new Error(
      `Jumlah baris file ${normalizedFileName} tidak sesuai header: header ${header.declared_rows}, aktual ${rowNumber}.`,
    );
  }

  return {
    file_name: path.basename(normalizedFileName),
    ...fileNameMeta,
    declared_rows: header.declared_rows,
    actual_rows: rowNumber,
    rows: [],
  };
}

function extractSlikFiles(inputFiles) {
  const files = [];

  for (const input of inputFiles) {
    const fileName = String(input.name || "").trim();
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith(".txt")) {
      files.push(input);
      continue;
    }

    throw new Error(`Format file ${fileName} tidak valid. Import SLIK hanya menerima TXT.`);
  }

  if (files.length === 0) {
    throw new Error("Tidak ada file TXT SLIK yang bisa diproses.");
  }

  return files;
}

function normalizeParseOptions(optionsOrExpectedPeriod = null) {
  if (
    typeof optionsOrExpectedPeriod === "string" ||
    optionsOrExpectedPeriod === null ||
    optionsOrExpectedPeriod === undefined
  ) {
    return {
      expectedPeriod: normalizeText(optionsOrExpectedPeriod),
      importSegment: null,
      cifStatus: null,
    };
  }

  return {
    expectedPeriod: normalizeText(optionsOrExpectedPeriod.expectedPeriod),
    importSegment: normalizeUpper(optionsOrExpectedPeriod.importSegment),
    cifStatus: normalizeUpper(optionsOrExpectedPeriod.cifStatus),
  };
}

function parseSlikFiles(inputFiles, optionsOrExpectedPeriod = null) {
  const options = prepareParseOptions(optionsOrExpectedPeriod);
  const textFiles = extractSlikFiles(inputFiles);
  const segments = textFiles.map((file) => parseSlikTextFile(file, options));
  const periods = new Set(segments.map((segment) => segment.period_month));

  if (periods.size !== 1) {
    throw new Error("Semua file SLIK dalam satu import harus memiliki periode yang sama.");
  }

  const periodMonth = [...periods][0];
  if (options.expectedPeriod && options.expectedPeriod !== periodMonth) {
    throw new Error(`Periode form ${options.expectedPeriod} tidak sesuai file SLIK ${periodMonth}.`);
  }

  return {
    period_month: periodMonth,
    import_segment: options.importSegment,
    cif_status: options.cifStatus,
    segments,
    total_rows: segments.reduce((total, segment) => total + segment.actual_rows, 0),
  };
}

function defaultDateForPeriod(periodMonth) {
  const [year, month] = String(periodMonth || "").split("-");
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  if (!parsedYear || !parsedMonth) return new Date();
  return new Date(Date.UTC(parsedYear, parsedMonth - 1, 1));
}

module.exports = {
  EXPECTED_DATA_FIELD_COUNTS,
  parseDecimal,
  parseInteger,
  parseSlikDate,
  parseSlikFiles,
  prepareParseOptions,
  streamSlikTextFile,
  defaultDateForPeriod,
  normalizeText,
  normalizeUpper,
};
