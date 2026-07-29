const fs = require("fs/promises");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");

const EXPIRY_IMPORT_SHEET = "Update Expired";
const EXPIRY_IMPORT_HEADERS = [
  "No Register Agunan",
  "Status [YA]/[Tidak]",
  "Tanggal Expired",
  "Keterangan",
];
const MAX_EXPIRY_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_EXPIRY_IMPORT_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_EXPIRY_IMPORT_ZIP_ENTRIES = 250;
const MAX_EXPIRY_IMPORT_ROWS = 1000;
const MAX_EXPIRY_IMPORT_SCANNED_ROWS = 5000;
const MAX_COLLATERAL_NUMBER_LENGTH = 100;
const MAX_EXPIRY_NOTE_LENGTH = 1000;

function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeHeader(value) {
  return normalizeText(value).toLocaleLowerCase("id-ID");
}

function isFormulaValue(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      (Object.hasOwn(value, "formula") ||
        Object.hasOwn(value, "sharedFormula")),
  );
}

function cellValue(cell) {
  const value = cell?.value;
  if (isFormulaValue(value)) {
    return { formula: true, value: null };
  }
  if (value && typeof value === "object" && Array.isArray(value.richText)) {
    return {
      formula: false,
      value: value.richText.map((part) => part?.text || "").join(""),
    };
  }
  return { formula: false, value };
}

function utcDateOnly(year, month, day) {
  if (![year, month, day].every(Number.isInteger)) return null;
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

function parseExpiryImportDate(value) {
  if (value === null || value === undefined || value === "") {
    return { date: null, error: null };
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return { date: null, error: "Tanggal Expired tidak valid." };
    }
    return {
      date: utcDateOnly(
        value.getUTCFullYear(),
        value.getUTCMonth() + 1,
        value.getUTCDate(),
      ),
      error: null,
    };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const wholeDays = Math.floor(value);
    if (wholeDays <= 0 || wholeDays > 2958465) {
      return { date: null, error: "Tanggal Expired tidak valid." };
    }
    const milliseconds = Date.UTC(1899, 11, 30) + wholeDays * 86400000;
    const date = new Date(milliseconds);
    return {
      date: utcDateOnly(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
      ),
      error: null,
    };
  }

  const text = normalizeText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    return {
      date: null,
      error: "Tanggal Expired harus berupa tanggal Excel atau format YYYY-MM-DD.",
    };
  }

  const date = utcDateOnly(Number(match[1]), Number(match[2]), Number(match[3]));
  return date
    ? { date, error: null }
    : { date: null, error: "Tanggal Expired tidak valid." };
}

function validateExpiryImportRow({ rowNumber, cells }) {
  const errors = [];
  if (cells.some((cell) => cell.formula)) {
    errors.push("Formula tidak diperbolehkan pada kolom upload.");
  }

  const collateralNumber = normalizeText(cells[0]?.value);
  const status = normalizeText(cells[1]?.value).toUpperCase();
  const note = normalizeText(cells[3]?.value) || null;
  const parsedDate = parseExpiryImportDate(cells[2]?.value);

  if (!collateralNumber) {
    errors.push("No Register Agunan wajib diisi.");
  } else if (collateralNumber.length > MAX_COLLATERAL_NUMBER_LENGTH) {
    errors.push(
      `No Register Agunan maksimal ${MAX_COLLATERAL_NUMBER_LENGTH} karakter.`,
    );
  }

  if (!status) {
    errors.push("Status wajib diisi YA atau TIDAK.");
  } else if (!new Set(["YA", "TIDAK"]).has(status)) {
    errors.push("Status hanya boleh YA atau TIDAK.");
  }

  if (note && note.length > MAX_EXPIRY_NOTE_LENGTH) {
    errors.push(`Keterangan maksimal ${MAX_EXPIRY_NOTE_LENGTH} karakter.`);
  }

  if (parsedDate.error) errors.push(parsedDate.error);
  if (status === "YA" && !parsedDate.date && !parsedDate.error) {
    errors.push("Tanggal Expired wajib diisi ketika Status YA.");
  }
  if (status === "TIDAK" && parsedDate.date) {
    errors.push("Tanggal Expired harus kosong ketika Status TIDAK.");
  }

  return {
    rowNumber,
    collateralNumber,
    normalizedCollateralNumber: collateralNumber.toLocaleLowerCase("id-ID"),
    hasExpiryDate: status === "YA",
    expiryDate: status === "YA" ? parsedDate.date : null,
    expiryNote: note,
    errors,
  };
}

function buildImportError(row, messages) {
  return {
    row: row?.rowNumber ?? null,
    collateral_number: row?.collateralNumber || null,
    messages: Array.isArray(messages) ? messages : [String(messages)],
  };
}

function matchCollateralExpiryImportRows(rows, candidates) {
  const candidatesByNumber = new Map();
  for (const candidate of candidates || []) {
    const key = normalizeText(candidate?.collateral_number).toLocaleLowerCase("id-ID");
    if (!key) continue;
    const matches = candidatesByNumber.get(key) || [];
    matches.push(candidate);
    candidatesByNumber.set(key, matches);
  }

  const errors = [];
  for (const row of rows || []) {
    const matches = candidatesByNumber.get(row.normalizedCollateralNumber) || [];
    if (matches.length === 0) {
      errors.push(
        buildImportError(row, [
          "Agunan tidak ditemukan atau tidak dapat diperbarui oleh pengguna ini.",
        ]),
      );
    } else if (matches.length > 1) {
      errors.push(
        buildImportError(row, [
          "Kode Register cocok ke lebih dari satu agunan; pembaruan dibatalkan untuk mencegah salah data.",
        ]),
      );
    }
  }

  return { candidatesByNumber, errors };
}

function summarizeImportErrors(errors, maxItems = 5) {
  const lines = errors.slice(0, maxItems).map((item) => {
    const location = item.row ? `Baris ${item.row}` : "File";
    const number = item.collateral_number
      ? ` (${item.collateral_number})`
      : "";
    return `${location}${number}: ${item.messages.join(" ")}`;
  });
  const remaining = Math.max(0, errors.length - lines.length);
  return [
    "Upload dibatalkan; tidak ada data yang diubah.",
    ...lines,
    ...(remaining > 0 ? [`${remaining} kesalahan lain belum ditampilkan.`] : []),
  ].join(" ");
}

function safeExpiryImportParserErrorMessage(error) {
  const message = normalizeText(error?.message);
  const allowedPrefixes = [
    "File Excel wajib diunggah.",
    "Ukuran file Excel maksimal",
    "Struktur file Excel terlalu kompleks.",
    "Isi file Excel melebihi batas aman pemrosesan.",
    "Struktur workbook Excel tidak lengkap.",
    "Sheet \"Update Expired\" tidak ditemukan.",
    "Header wajib berurutan:",
    "Sheet memiliki terlalu banyak baris",
  ];
  return allowedPrefixes.some((prefix) => message?.startsWith(prefix))
    ? message
    : "File Excel rusak atau tidak dapat dibaca.";
}

function findHeaderRow(worksheet) {
  const expected = EXPIRY_IMPORT_HEADERS.map(normalizeHeader);
  const maxRow = Math.min(20, worksheet.rowCount);
  for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
    const values = expected.map((_, index) =>
      normalizeHeader(cellValue(worksheet.getCell(rowNumber, index + 1)).value),
    );
    if (values.every((value, index) => value === expected[index])) {
      return rowNumber;
    }
  }
  return null;
}

async function validateZipEnvelope(buffer) {
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: false });
  const entries = Object.values(zip.files);
  if (entries.length > MAX_EXPIRY_IMPORT_ZIP_ENTRIES) {
    throw new Error("Struktur file Excel terlalu kompleks.");
  }

  let uncompressedBytes = 0;
  for (const entry of entries) {
    const size = Number(entry?._data?.uncompressedSize || 0);
    if (Number.isFinite(size) && size > 0) uncompressedBytes += size;
    if (uncompressedBytes > MAX_EXPIRY_IMPORT_UNCOMPRESSED_BYTES) {
      throw new Error("Isi file Excel melebihi batas aman pemrosesan.");
    }
  }
  return zip;
}

async function normalizeWorkbookForExcelJs(zip, originalBuffer) {
  const workbookEntry = zip.file("xl/workbook.xml");
  if (!workbookEntry) {
    throw new Error("Struktur workbook Excel tidak lengkap.");
  }
  const workbookXml = await workbookEntry.async("string");
  if (!workbookXml.includes("<x:")) return originalBuffer;

  for (const [entryName, entry] of Object.entries(zip.files)) {
    if (!entryName.endsWith(".xml") || entryName === "[Content_Types].xml") {
      continue;
    }
    const xml = await entry.async("string");
    zip.file(
      entryName,
      xml
        .replace(/xmlns:x=/g, "xmlns=")
        .replace(/<x:/g, "<")
        .replace(/<\/x:/g, "</"),
    );
  }

  const contentTypesEntry = zip.file("[Content_Types].xml");
  if (contentTypesEntry) {
    const contentTypes = await contentTypesEntry.async("string");
    zip.file(
      "[Content_Types].xml",
      contentTypes.replace(
        '<Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" />',
        '<Default Extension="xml" ContentType="application/xml" /><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" />',
      ),
    );
  }

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function parseCollateralExpiryWorkbook(file) {
  if (!file?.temp_path) {
    throw new Error("File Excel wajib diunggah.");
  }
  if (
    Number(file.size_bytes || 0) <= 0 ||
    Number(file.size_bytes) > MAX_EXPIRY_IMPORT_FILE_BYTES
  ) {
    throw new Error("Ukuran file Excel maksimal 5 MB.");
  }

  const buffer = await fs.readFile(file.temp_path);
  const zip = await validateZipEnvelope(buffer);
  const parserBuffer = await normalizeWorkbookForExcelJs(zip, buffer);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(parserBuffer, {
    ignoreNodes: [
      "dataValidations",
      "conditionalFormatting",
      "extLst",
      "drawing",
      "picture",
      "tableParts",
    ],
  });

  const worksheet = workbook.getWorksheet(EXPIRY_IMPORT_SHEET);
  if (!worksheet) {
    throw new Error(`Sheet "${EXPIRY_IMPORT_SHEET}" tidak ditemukan.`);
  }

  const headerRow = findHeaderRow(worksheet);
  if (!headerRow) {
    throw new Error(
      `Header wajib berurutan: ${EXPIRY_IMPORT_HEADERS.join(", ")}.`,
    );
  }
  if (worksheet.rowCount - headerRow > MAX_EXPIRY_IMPORT_SCANNED_ROWS) {
    throw new Error("Sheet memiliki terlalu banyak baris untuk diproses dengan aman.");
  }

  const rows = [];
  const errors = [];
  const seen = new Map();
  for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const cells = [1, 2, 3, 4].map((column) =>
      cellValue(worksheet.getCell(rowNumber, column)),
    );
    const isEmpty = cells.every(
      (cell) => cell.value === null || cell.value === undefined || normalizeText(cell.value) === "",
    );
    if (isEmpty) continue;

    const row = validateExpiryImportRow({ rowNumber, cells });
    rows.push(row);
    if (row.errors.length > 0) errors.push(buildImportError(row, row.errors));

    if (row.normalizedCollateralNumber) {
      const firstRow = seen.get(row.normalizedCollateralNumber);
      if (firstRow) {
        errors.push(
          buildImportError(row, [
            `No Register Agunan duplikat dengan baris ${firstRow}.`,
          ]),
        );
      } else {
        seen.set(row.normalizedCollateralNumber, row.rowNumber);
      }
    }
  }

  if (rows.length === 0) {
    errors.push(buildImportError(null, ["Tidak ada baris data untuk diunggah."]));
  }
  if (rows.length > MAX_EXPIRY_IMPORT_ROWS) {
    errors.push(
      buildImportError(null, [
        `Maksimal ${MAX_EXPIRY_IMPORT_ROWS} baris data per upload.`,
      ]),
    );
  }

  return { rows, errors, headerRow, sheetName: worksheet.name };
}

module.exports = {
  EXPIRY_IMPORT_HEADERS,
  EXPIRY_IMPORT_SHEET,
  MAX_EXPIRY_IMPORT_FILE_BYTES,
  MAX_EXPIRY_IMPORT_ROWS,
  buildImportError,
  matchCollateralExpiryImportRows,
  parseCollateralExpiryWorkbook,
  parseExpiryImportDate,
  safeExpiryImportParserErrorMessage,
  summarizeImportErrors,
  validateExpiryImportRow,
};
