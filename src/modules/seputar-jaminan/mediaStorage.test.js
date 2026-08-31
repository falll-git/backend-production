const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");

const { FilesystemMediaStorage } = require("./mediaStorage");
const { sanitizeImage } = require("./media.service");

test("filesystem media storage menahan object di dalam root", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ruwang-sj-media-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const storage = new FilesystemMediaStorage(root);
  const content = Buffer.from("gambar-sintetis");
  await storage.put("division/2026/object.webp", content);
  assert.deepEqual(await storage.read("division/2026/object.webp"), content);
  assert.throws(() => storage.resolve("../secret.webp"), /tidak valid|keluar dari root/i);
  await storage.remove("division/2026/object.webp");
  await assert.rejects(storage.read("division/2026/object.webp"), /ENOENT/);
});

test("sanitasi gambar menghasilkan WebP <= 2560 tanpa metadata sumber", async () => {
  const input = await sharp({
    create: { width: 3000, height: 1800, channels: 3, background: "#4255ff" },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const result = await sanitizeImage(input);
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(result.mime, "image/webp");
  assert.ok(result.width <= 2560);
  assert.ok(result.height <= 2560);
  assert.equal(metadata.exif, undefined);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test("sanitasi menolak isi yang bukan gambar", async () => {
  await assert.rejects(sanitizeImage(Buffer.from("bukan gambar")), /bukan gambar/i);
});
