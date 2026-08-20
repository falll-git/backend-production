const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertDispositionCanRedispose,
  assertDispositionTransition,
  getDispositionCapabilities,
} = require("./persuratan-workflow");

test("kapabilitas disposisi mengikuti urutan Baru ke Dalam Proses ke Selesai", () => {
  assert.deepEqual(getDispositionCapabilities("NEW"), {
    can_start: true,
    can_complete: false,
    can_redispose: false,
  });
  assert.deepEqual(getDispositionCapabilities("IN_PROGRESS"), {
    can_start: false,
    can_complete: true,
    can_redispose: true,
  });
  assert.deepEqual(getDispositionCapabilities("COMPLETED"), {
    can_start: false,
    can_complete: false,
    can_redispose: false,
  });
  assert.deepEqual(getDispositionCapabilities("FORWARDED"), {
    can_start: false,
    can_complete: false,
    can_redispose: false,
  });
});

test("penyelesaian langsung dari status Baru ditolak", () => {
  assert.throws(() => assertDispositionTransition("NEW", "COMPLETED"), {
    message: /Mulai proses terlebih dahulu/,
    statusCode: 400,
  });
  assert.equal(
    assertDispositionTransition("NEW", "IN_PROGRESS"),
    "IN_PROGRESS",
  );
  assert.equal(
    assertDispositionTransition("IN_PROGRESS", "COMPLETED"),
    "COMPLETED",
  );
});

test("disposisi baru harus mulai diproses sebelum diteruskan", () => {
  assert.throws(
    () => assertDispositionCanRedispose("NEW"),
    /Mulai proses terlebih dahulu/,
  );
  assert.equal(assertDispositionCanRedispose("IN_PROGRESS"), "IN_PROGRESS");
  assert.throws(() => assertDispositionCanRedispose("COMPLETED"), /selesai/);
  assert.throws(() => assertDispositionCanRedispose("FORWARDED"), /diteruskan/);
});
