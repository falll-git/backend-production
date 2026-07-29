const test = require("node:test");
const assert = require("node:assert/strict");

const {
  updateCollateralExpirySchema,
} = require("./debtors.validation");

test("status Ya mewajibkan tanggal expired", () => {
  const { error } = updateCollateralExpirySchema.validate({
    has_expiry_date: true,
    expiry_date: null,
    expiry_note: "Perlu diperpanjang",
  });

  assert.ok(error);
});

test("status Ya menerima tanggal dan keterangan expired", () => {
  const { error, value } = updateCollateralExpirySchema.validate({
    has_expiry_date: true,
    expiry_date: "2030-06-30",
    expiry_note: " Perlu diperpanjang ",
  });

  assert.equal(error, undefined);
  assert.equal(value.has_expiry_date, true);
  assert.equal(value.expiry_note, "Perlu diperpanjang");
});

test("status Tidak hanya menerima tanggal null", () => {
  const invalid = updateCollateralExpirySchema.validate({
    has_expiry_date: false,
    expiry_date: "2030-06-30",
  });
  const valid = updateCollateralExpirySchema.validate({
    has_expiry_date: false,
    expiry_date: null,
    expiry_note: "Tidak berlaku",
  });

  assert.ok(invalid.error);
  assert.equal(valid.error, undefined);
});
