const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getFileExtension,
  isUploadContentAllowed,
  isUploadMetadataAllowed,
} = require("./upload-file-policy");
const {
  PUBLIC_PREFIX: PERSURATAN_PUBLIC_PREFIX,
  normalizeStoredPath,
} = require("./persuratan-files");

const DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "txt",
  "jpg",
  "png",
]);

function upload({ name, mime, buffer }) {
  return {
    originalname: name,
    mimetype: mime,
    buffer,
  };
}

test("metadata upload wajib memiliki pasangan ekstensi dan MIME yang sesuai", () => {
  assert.equal(
    isUploadMetadataAllowed(
      upload({
        name: "dokumen.pdf",
        mime: "application/pdf",
        buffer: Buffer.from("%PDF-1.7"),
      }),
      { allowedExtensions: DOCUMENT_EXTENSIONS },
    ),
    true,
  );

  assert.equal(
    isUploadMetadataAllowed(
      upload({
        name: "dokumen.exe",
        mime: "application/pdf",
        buffer: Buffer.from("%PDF-1.7"),
      }),
      { allowedExtensions: DOCUMENT_EXTENSIONS },
    ),
    false,
  );

  assert.equal(
    isUploadMetadataAllowed(
      upload({
        name: "dokumen.pdf",
        mime: "application/x-msdownload",
        buffer: Buffer.from("MZ"),
      }),
      { allowedExtensions: DOCUMENT_EXTENSIONS },
    ),
    false,
  );
});

test("signature file yang sesuai diterima", () => {
  assert.equal(
    isUploadContentAllowed(
      upload({
        name: "dokumen.pdf",
        mime: "application/pdf",
        buffer: Buffer.from("%PDF-1.7\n"),
      }),
    ),
    true,
  );
  assert.equal(
    isUploadContentAllowed(
      upload({
        name: "gambar.png",
        mime: "image/png",
        buffer: Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]),
      }),
    ),
    true,
  );
  assert.equal(
    isUploadContentAllowed(
      upload({
        name: "data.txt",
        mime: "text/plain",
        buffer: Buffer.from("D01|DATA SLIK\n", "utf8"),
      }),
    ),
    true,
  );
});

test("file executable yang menyamar sebagai PDF ditolak", () => {
  assert.equal(
    isUploadContentAllowed(
      upload({
        name: "dokumen.pdf",
        mime: "application/pdf",
        buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]),
      }),
    ),
    false,
  );
  assert.equal(
    isUploadContentAllowed(
      upload({
        name: "dokumen.pdf",
        mime: "application/pdf",
        buffer: Buffer.from("MZ executable %PDF-1.7", "ascii"),
      }),
    ),
    false,
  );
});

test("nama file tanpa ekstensi valid ditolak oleh resolver ekstensi", () => {
  assert.equal(getFileExtension("../dokumen"), "");
  assert.equal(getFileExtension(".env"), "");
  assert.equal(getFileExtension("dokumen.PDF"), "pdf");
});

test("referensi URL eksternal tidak diterima sebagai file persuratan tersimpan", () => {
  assert.equal(
    normalizeStoredPath("https://example.com/api/persuratan-files/a.pdf"),
    null,
  );
  assert.equal(
    normalizeStoredPath(`${PERSURATAN_PUBLIC_PREFIX}/incoming/a.pdf`),
    `${PERSURATAN_PUBLIC_PREFIX}/incoming/a.pdf`,
  );
});
