const assert = require("node:assert/strict");
const test = require("node:test");

const ExcelJS = require("exceljs");
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const Joi = require("joi");
const messages = require("joi/lib/messages");
const sharp = require("sharp");
const expressRequire = createRequire(require.resolve("express/package.json"));
const proxyaddr = expressRequire("proxy-addr");

test("dependency keamanan yang dipin dipakai oleh consumer runtime sebenarnya", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
  assert.equal(manifest.dependencies.joi, "18.2.9");
  assert.equal(manifest.dependencies.sharp, "0.35.5");
  assert.equal(manifest.overrides["proxy-addr"], "2.0.8");
  assert.equal(Joi.version, manifest.dependencies.joi);
  assert.equal(sharp.versions.sharp, manifest.dependencies.sharp);
  assert.equal(expressRequire("proxy-addr/package.json").version, manifest.overrides["proxy-addr"]);
});

test("Joi menolak kode pesan __proto__ pada compile, merge, dan API schema", () => {
  // GHSA-wr44-6hxh-3jwq: patch menolak kode berbahaya, bukan mengabaikannya.
  const baseline = messages.compile({ "number.min": "minimum {#limit}" });
  for (const message of ["probe", Joi.x("probe")]) {
    for (const input of [
      { ["__proto__"]: message },
      { english: { ["__proto__"]: message } },
    ]) {
      assert.throws(() => messages.compile(input), /Cannot use __proto__ as a message code/);
      assert.throws(() => messages.merge(baseline, input), /Cannot use __proto__ as a message code/);
      assert.throws(() => Joi.number().min(1).messages(input), /Cannot use __proto__ as a message code/);
    }
  }
  assert.equal(Object.getPrototypeOf(baseline), Object.prototype);
  assert.equal(Object.hasOwn(Object.prototype, "number.min"), false);
  const schema = Joi.number().min(1).messages({ "number.min": "minimum {#limit}" });
  assert.equal(schema.validate(0).error.message, "minimum 1");
  assert.equal(Joi.number().validate(0).value, 0);
});

test("Express proxy-addr tidak mempercayai IPv4 melalui prefix IPv6 pendek", () => {
  // GHSA-jqcg-44mw-7w3h; jangan mengubah konfigurasi trust proxy aplikasi.
  for (const subnet of ["::ffff:10.0.0.0/8", "::ffff:0.0.0.0/95", "::/1"]) {
    const trust = proxyaddr.compile(subnet);
    assert.equal(trust("8.8.8.8"), false);
    assert.equal(trust("::ffff:8.8.8.8"), false);
  }
  const trust = proxyaddr.compile("::ffff:10.0.0.0/104");
  assert.equal(trust("10.0.0.1"), true);
  assert.equal(trust("8.8.8.8"), false);
  assert.equal(proxyaddr({ connection: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": "9.9.9.9" } }, "::ffff:10.0.0.0/8"), "127.0.0.1");
});

test("Sharp patch tetap membaca dan mengubah media raster secara in-memory", async () => {
  for (const format of ["jpeg", "png", "webp"]) {
    const image = await sharp({ create: { width: 32, height: 16, channels: 3, background: "#445566" } }).toFormat(format).toBuffer();
    const converted = await sharp(image).resize(16, 8).webp().toBuffer();
    const metadata = await sharp(converted).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 16);
    assert.equal(metadata.height, 8);
  }
});

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
