const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

test("resume PDF IDEB tidak memuat lampiran atau metadata file sumber", () => {
  const source = readFileSync(
    join(__dirname, "debtorImports.service.js"),
    "utf8",
  );
  const start = source.indexOf("async function renderIdebResumePdf");
  const end = source.indexOf("function parseCurrencyNumber", start);

  assert.ok(start >= 0, "Generator resume PDF IDEB wajib tersedia.");
  assert.ok(end > start, "Batas generator resume PDF IDEB wajib dikenali.");

  const generatorSource = source.slice(start, end);
  assert.doesNotMatch(generatorSource, /upload\.files?\b/);
  assert.doesNotMatch(generatorSource, /file_(?:name|path)\b/i);
  assert.doesNotMatch(generatorSource, /(?:lampiran|file sumber)/i);
});
