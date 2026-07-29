const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");
const test = require("node:test");

const {
  matchCollateralExpiryImportRows,
  parseCollateralExpiryWorkbook,
  parseExpiryImportDate,
  safeExpiryImportParserErrorMessage,
  summarizeImportErrors,
  validateExpiryImportRow,
} = require("./collateral-expiry-import");

function plainCell(value) {
  return { formula: false, value };
}

test("baris status YA menerima tanggal valid dan keterangan", () => {
  const result = validateExpiryImportRow({
    rowNumber: 6,
    cells: [
      plainCell(" REG-001 "),
      plainCell("ya"),
      plainCell("2027-12-31"),
      plainCell("  Perpanjangan diproses  "),
    ],
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.collateralNumber, "REG-001");
  assert.equal(result.hasExpiryDate, true);
  assert.equal(result.expiryDate.toISOString(), "2027-12-31T00:00:00.000Z");
  assert.equal(result.expiryNote, "Perpanjangan diproses");
});

test("status TIDAK menolak tanggal dan mengosongkan tanggal hasil", () => {
  const result = validateExpiryImportRow({
    rowNumber: 7,
    cells: [
      plainCell("REG-002"),
      plainCell("TIDAK"),
      plainCell("2027-12-31"),
      plainCell(null),
    ],
  });

  assert.equal(result.hasExpiryDate, false);
  assert.equal(result.expiryDate, null);
  assert.match(result.errors.join(" "), /harus kosong/i);
});

test("formula dan status di luar YA atau TIDAK ditolak", () => {
  const result = validateExpiryImportRow({
    rowNumber: 8,
    cells: [
      { formula: true, value: null },
      plainCell("AKTIF"),
      plainCell(null),
      plainCell(null),
    ],
  });

  assert.match(result.errors.join(" "), /Formula tidak diperbolehkan/);
  assert.match(result.errors.join(" "), /Status hanya boleh YA atau TIDAK/);
});

test("parser tanggal hanya menerima tanggal yang nyata dan tidak ambigu", () => {
  assert.equal(
    parseExpiryImportDate("2028-02-29").date.toISOString(),
    "2028-02-29T00:00:00.000Z",
  );
  assert.match(parseExpiryImportDate("2027-02-29").error, /tidak valid/i);
  assert.match(parseExpiryImportDate("31/12/2027").error, /YYYY-MM-DD/);
});

test("template final memiliki sheet dan header resmi tanpa data contoh di sheet upload", async () => {
  const templatePath = path.resolve(
    __dirname,
    "../assets/templates/template-update-expired-agunan.xlsx",
  );
  const stat = await fs.stat(templatePath);
  const result = await parseCollateralExpiryWorkbook({
    temp_path: templatePath,
    size_bytes: stat.size,
  });

  assert.equal(result.sheetName, "Update Expired");
  assert.equal(result.headerRow, 5);
  assert.equal(result.rows.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].messages[0], /Tidak ada baris data/);
});

test("ringkasan kesalahan menegaskan rollback seluruh upload", () => {
  const message = summarizeImportErrors([
    {
      row: 9,
      collateral_number: "REG-009",
      messages: ["Agunan tidak ditemukan."],
    },
  ]);

  assert.match(message, /tidak ada data yang diubah/i);
  assert.match(message, /Baris 9 \(REG-009\)/);
});

test("pesan parser internal tidak membocorkan path temporary", () => {
  assert.equal(
    safeExpiryImportParserErrorMessage(
      new Error("ENOENT: D:/server/tmp/upload-rahasia.xlsx"),
    ),
    "File Excel rusak atau tidak dapat dibaca.",
  );
  assert.match(
    safeExpiryImportParserErrorMessage(
      new Error('Sheet "Update Expired" tidak ditemukan.'),
    ),
    /Update Expired/,
  );
});

test("pencocokan hanya menerima tepat satu agunan per Kode Register", () => {
  const rows = ["REG-001", "REG-002", "REG-003"].map(
    (collateralNumber, index) => ({
      rowNumber: index + 6,
      collateralNumber,
      normalizedCollateralNumber: collateralNumber.toLowerCase(),
    }),
  );
  const result = matchCollateralExpiryImportRows(rows, [
    { id: "one", collateral_number: "reg-001" },
    { id: "duplicate-a", collateral_number: "REG-002" },
    { id: "duplicate-b", collateral_number: "reg-002" },
  ]);

  assert.equal(result.candidatesByNumber.get("reg-001").length, 1);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0].messages[0], /lebih dari satu agunan/);
  assert.match(result.errors[1].messages[0], /tidak ditemukan/);
});
