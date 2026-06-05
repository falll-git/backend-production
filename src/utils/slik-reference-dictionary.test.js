const assert = require("node:assert/strict");
const test = require("node:test");

const {
  collectUnmappedSlikReferences,
  resolveSlikReference,
  withSlikReferenceFields,
} = require("./slik-reference-dictionary");

test("resolveSlikReference returns verified labels for mapped codes", () => {
  const reference = resolveSlikReference("collectibility_code", "1");

  assert.equal(reference.code, "1");
  assert.equal(reference.label, "Lancar");
  assert.equal(reference.display, "1 - Lancar");
  assert.equal(reference.is_mapped, true);
  assert.equal(reference.source, "SEOJK No. 11/SEOJK.01/2024");
});

test("resolveSlikReference treats empty values as null", () => {
  assert.equal(resolveSlikReference("collectibility_code", ""), null);
  assert.equal(resolveSlikReference("collectibility_code", null), null);
});

test("resolveSlikReference does not guess unknown codes", () => {
  const reference = resolveSlikReference("collectibility_code", "9");

  assert.equal(reference.code, "9");
  assert.equal(reference.label, null);
  assert.equal(reference.display, "9 - Belum dipetakan");
  assert.equal(reference.is_mapped, false);
});

test("resolveSlikReference preserves zero-padded string codes", () => {
  const reference = resolveSlikReference("binding_type_code", "01");

  assert.equal(reference.code, "01");
  assert.equal(reference.label, "Hak Tanggungan");
  assert.equal(reference.display, "01 - Hak Tanggungan");
});

test("resolveSlikReference returns verified SEOJK labels for large SLIK dictionaries", () => {
  assert.equal(
    resolveSlikReference("city_code", "0198").display,
    "0198 - Kota Bekasi",
  );
  assert.equal(
    resolveSlikReference("economic_sector_code", "530000").display,
    "530000 - AKTIVITAS POS DAN KURIR",
  );
  assert.equal(
    resolveSlikReference("economic_sector_code", "829000").display,
    "829000 - AKTIVITAS JASA PENUNJANG USAHA YTDL",
  );
  assert.equal(
    resolveSlikReference("debtor_group_code", "S11002059L").display,
    "S11002059L - Perusahaan Jasa Konstruksi Lainnya",
  );
});

test("withSlikReferenceFields appends label and display without replacing raw code", () => {
  const enriched = withSlikReferenceFields(
    {
      collectibility_code: "5",
      condition_code: "02",
    },
    {
      collectibility_code: "collectibility_code",
      condition_code: "condition_code",
    },
  );

  assert.equal(enriched.collectibility_code, "5");
  assert.equal(enriched.collectibility_label, "Macet");
  assert.equal(enriched.collectibility_display, "5 - Macet");
  assert.equal(enriched.condition_code, "02");
  assert.equal(enriched.condition_label, "Lunas");
  assert.equal(enriched.condition_display, "02 - Lunas");
});

test("collectUnmappedSlikReferences reports only unverified codes", () => {
  const unmapped = collectUnmappedSlikReferences("F01", {
    credit_type_code: "P99",
    collectibility_code: "1",
    economic_sector_code: "ZZ9999",
  });

  assert.deepEqual(unmapped, [
    {
      segment: "F01",
      field: "economic_sector_code",
      category: "economic_sector_code",
      code: "ZZ9999",
      count: 1,
    },
  ]);
});
