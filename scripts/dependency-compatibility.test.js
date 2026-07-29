const assert = require("node:assert/strict");
const test = require("node:test");

const ExcelJS = require("exceljs");

test("ExcelJS menulis dan membaca XLSX dengan dependency archive terbarui", async () => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Verifikasi");
  worksheet.addRow(["kode", "status"]);
  worksheet.addRow(["CI-001", "aman"]);

  const buffer = await workbook.xlsx.writeBuffer();
  assert.equal(Buffer.from(buffer).subarray(0, 2).toString("ascii"), "PK");

  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer);
  assert.equal(loaded.getWorksheet("Verifikasi").getCell("A2").value, "CI-001");
  assert.equal(loaded.getWorksheet("Verifikasi").getCell("B2").value, "aman");
});
