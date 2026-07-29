const assert = require("node:assert/strict");
const test = require("node:test");
const {
  isInlineWatermarkProcessingEnabled,
  resolveWatermarkProcessingMode,
} = require("./watermarkProcessor.service");

test("watermark tidak diproses inline pada default production", () => {
  assert.equal(
    resolveWatermarkProcessingMode({ NODE_ENV: "production" }),
    "worker",
  );
  assert.equal(
    isInlineWatermarkProcessingEnabled({ NODE_ENV: "production" }),
    false,
  );
});

test("mode inline tetap tersedia eksplisit untuk development lokal", () => {
  assert.equal(
    resolveWatermarkProcessingMode({ NODE_ENV: "development" }),
    "inline",
  );
  assert.equal(
    isInlineWatermarkProcessingEnabled({
      NODE_ENV: "development",
      WATERMARK_PROCESSING_MODE: "worker",
    }),
    false,
  );
});
