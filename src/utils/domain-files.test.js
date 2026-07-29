const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ruwang-domain-files-"));
process.env.UPLOAD_DIR = uploadRoot;

const {
  deleteReplacedStoredFile,
  persistDigitalArchiveFile,
  resolveStoredFilePath,
} = require("./digital-archive-files");
const { withDomainFileRollback } = require("./domain-files");

after(() => {
  fs.rmSync(uploadRoot, { recursive: true, force: true });
});

function fileInput(contents, name = "bukti.txt") {
  return {
    buffer: Buffer.from(contents),
    file_name: name,
    mime_type: "text/plain",
  };
}

test("file baru dibersihkan ketika operasi database gagal", async () => {
  let storedPath;

  await assert.rejects(
    withDomainFileRollback(async (persistFiles) => {
      const [fileMeta] = persistFiles({
        entity: "test-rollback",
        inputs: [fileInput("rollback")],
        fallbackBaseName: "rollback",
      });
      storedPath = fileMeta.file_path;
      assert.equal(fs.existsSync(resolveStoredFilePath(storedPath)), true);
      throw new Error("database gagal");
    }),
    /database gagal/,
  );

  assert.equal(fs.existsSync(resolveStoredFilePath(storedPath)), false);
});

test("file baru dipertahankan ketika operasi database berhasil", async () => {
  const storedPath = await withDomainFileRollback(async (persistFiles) => {
    const [fileMeta] = persistFiles({
      entity: "test-commit",
      inputs: [fileInput("commit")],
      fallbackBaseName: "commit",
    });
    return fileMeta.file_path;
  });

  assert.equal(fs.existsSync(resolveStoredFilePath(storedPath)), true);
});

test("file lama baru dihapus eksplisit setelah penggantinya siap", () => {
  const previous = persistDigitalArchiveFile({
    entity: "test-replacement",
    input: fileInput("lama"),
    fallbackBaseName: "lama",
  });
  const replacement = persistDigitalArchiveFile({
    entity: "test-replacement",
    input: fileInput("baru"),
    previousPath: previous.storedPath,
    fallbackBaseName: "baru",
  });

  assert.equal(fs.existsSync(resolveStoredFilePath(previous.storedPath)), true);
  assert.equal(fs.existsSync(resolveStoredFilePath(replacement.storedPath)), true);

  deleteReplacedStoredFile(previous.storedPath, replacement.storedPath);

  assert.equal(fs.existsSync(resolveStoredFilePath(previous.storedPath)), false);
  assert.equal(fs.existsSync(resolveStoredFilePath(replacement.storedPath)), true);
});
