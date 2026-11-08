const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");

const { FilesystemMediaStorage } = require("./mediaStorage");
const { getActiveMediaUsage, sanitizeImage, createThumbnail, getContent } = require("./media.service");

test("thumbnail is bounded, strips metadata, preserves aspect ratio and original", async () => {
  for (const [width,height] of [[1536,1024],[1024,1536],[64,32]]) {
    const input=await sharp({create:{width,height,channels:3,background:'#5874b3'}}).withMetadata().png().toBuffer();
    const before=Buffer.from(input),output=await createThumbnail(input),info=await sharp(output).metadata();
    assert.equal(info.format,'webp');assert.ok(info.width<=320&&info.height<=320);
    assert.ok(info.width<=width&&info.height<=height);assert.ok(Math.abs(info.width/info.height-width/height)<0.01);
    assert.equal(info.exif,undefined);assert.deepEqual(input,before);assert.ok(output.length<input.length);
  }
});
test("thumbnail rejects invalid input and invalid variant before accessing DB", async()=>{
  await assert.rejects(createThumbnail(Buffer.from('not image')));
  await assert.rejects(createThumbnail(Buffer.alloc(10*1024*1024+1)),e=>e.statusCode===422);
  for(const variant of ['original','',[],{},['thumbnail','thumbnail']]) {
    await assert.rejects(getContent('not-accessed',variant),e=>e.statusCode===422);
  }
});

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

test("pemakaian media mempertahankan versi disetujui ketika publikasi memiliki draf baru", async () => {
  const calls = [];
  const usage = await getActiveMediaUsage({
    sj_publication_version_media: {
      count: async ({ where }) => {
        calls.push(where);
        return 2;
      },
    },
    sj_public_profiles: {
      count: async ({ where }) => {
        calls.push(where);
        return 1;
      },
    },
    $queryRaw: async (query, ...values) => {
      assert.match(query.join('?'), /ruwang_arsip_sj_media_referenced/);
      assert.deepEqual(values, ["10000000-0000-4000-8000-000000000001"]);
      return [{ used: true }];
    },
  }, "10000000-0000-4000-8000-000000000001");

  assert.deepEqual(usage, { publicationUses: 2, profileUses: 1, referenced: true });
  assert.deepEqual(calls[0].publication_version.OR, [
    { current_for_publication: { is: { state: { not: "ARCHIVED" } } } },
    { published_for_publication: { is: { state: { not: "ARCHIVED" } } } },
  ]);
  assert.deepEqual(calls[1], {
    logo_media_id: "10000000-0000-4000-8000-000000000001",
    state: { not: "HIDDEN" },
  });
});

test("nol referensi yang terlihat tidak menggantikan bukti referensi lintas divisi", async () => {
  // Cross-division SQL/RLS and archive-until-ACK semantics are exercised by
  // sj-media-reference-scenario in an owned DB. This test guards the adapter:
  // visible counts must not override the authoritative reference boolean.
  for (const used of [true, false]) {
    const usage = await getActiveMediaUsage({
      sj_publication_version_media: { count: async () => 0 },
      sj_public_profiles: { count: async () => 0 },
      $queryRaw: async () => [{ used }],
    }, "10000000-0000-4000-8000-000000000001");
    assert.deepEqual(usage, { publicationUses: 0, profileUses: 0, referenced: used });
  }
});

test("hasil referensi media rusak atau query gagal tidak dianggap bebas pemakaian", async () => {
  const counts = {
    sj_publication_version_media: { count: async () => 0 },
    sj_public_profiles: { count: async () => 0 },
  };
  for (const rows of [[], [{ used: null }], [{ used: 'false' }], [{ used: false }, { used: true }]]) {
    await assert.rejects(getActiveMediaUsage({ ...counts, $queryRaw: async () => rows },
      "10000000-0000-4000-8000-000000000001"), error => error.statusCode === 503);
  }
  const failedQuery = new Error('explicit unit database fault');
  await assert.rejects(getActiveMediaUsage({ ...counts, $queryRaw: async () => { throw failedQuery; } },
    "10000000-0000-4000-8000-000000000001"), error => error === failedQuery);
});
