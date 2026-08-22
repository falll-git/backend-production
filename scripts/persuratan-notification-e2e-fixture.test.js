const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  fixtureRecordCounts,
  hasFixtureRecords,
  loadPdfFixture,
} = require("./persuratan-notification-e2e-fixture");

function records(overrides = {}) {
  return {
    divisionIds: [],
    dispositionIds: [],
    memorandumIds: [],
    recipientIds: [],
    storedPaths: [],
    ...overrides,
  };
}

test("fixture notifikasi membedakan database bersih dari record stale", () => {
  const clean = records();
  const stale = records({ memorandumIds: ["memo-stale"] });

  assert.equal(hasFixtureRecords(clean), false);
  assert.equal(hasFixtureRecords(stale), true);
  assert.deepEqual(fixtureRecordCounts(stale), {
    divisions: 0,
    dispositions: 0,
    memorandums: 1,
    recipients: 0,
  });
});

test("validasi PDF memeriksa dan membaca file dari descriptor yang sama", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "persuratan-pdf-"));
  const pdfPath = path.join(directory, "fixture.pdf");
  fs.writeFileSync(pdfPath, "%PDF-1.4\n%%EOF\n", { flag: "wx", mode: 0o600 });

  const originalStatSync = fs.statSync;
  fs.statSync = () => {
    throw new Error("path-based stat tidak boleh digunakan");
  };

  try {
    const fixture = loadPdfFixture(pdfPath);
    assert.equal(fixture.path, path.resolve(pdfPath));
    assert.equal(fixture.name, "fixture.pdf");
    assert.equal(fixture.buffer.toString("utf8"), "%PDF-1.4\n%%EOF\n");
  } finally {
    fs.statSync = originalStatSync;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("validasi PDF menolak directory dan signature non-PDF", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "persuratan-pdf-"));
  const directoryPath = path.join(directory, "folder.pdf");
  const invalidPath = path.join(directory, "invalid.pdf");
  fs.mkdirSync(directoryPath);
  fs.writeFileSync(invalidPath, "bukan-pdf", { flag: "wx", mode: 0o600 });

  try {
    assert.throws(
      () => loadPdfFixture(directoryPath),
      /membutuhkan file PDF yang valid/,
    );
    assert.throws(
      () => loadPdfFixture(invalidPath),
      /tidak memiliki signature PDF/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
