const assert = require("node:assert/strict");
const test = require("node:test");

const repository = require("./watermarkSettings.repository");
const service = require("./watermarkSettings.service");

test("preview watermark hanya mengembalikan managed asset path", async (t) => {
  const originalFindFirst = repository.findFirst;
  t.after(() => {
    repository.findFirst = originalFindFirst;
  });

  repository.findFirst = async () => ({
    image_path: "/api/watermark-assets/2026/07/123-logo.png",
  });

  assert.equal(
    await service.getImagePreviewPath(),
    "/api/watermark-assets/2026/07/123-logo.png",
  );
});

test("preview watermark menolak path di luar storage terkelola", async (t) => {
  const originalFindFirst = repository.findFirst;
  t.after(() => {
    repository.findFirst = originalFindFirst;
  });

  repository.findFirst = async () => ({
    image_path: "/api/watermark-assets/../../secret.png",
  });

  await assert.rejects(service.getImagePreviewPath(), (error) => {
    assert.equal(error.statusCode, 404);
    assert.match(error.message, /belum tersedia/);
    return true;
  });
});
