const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildStorageReconciliation,
  extractJsonReferences,
  normalizeStoredPath,
} = require("./storage-reconciliation");

test("reconciliation melaporkan missing, orphan, duplikasi, dan checksum berbeda", () => {
  const databaseReferences = [
    {
      stored_path: "/api/digital-archive-files/a.pdf",
      checksum: "expected",
      source: { table: "documents", column: "file", record_id: "1" },
    },
    {
      stored_path: "/api/digital-archive-files/a.pdf",
      checksum: null,
      source: { table: "document_files", column: "file_path", record_id: "2" },
    },
    {
      stored_path: "/api/persuratan-files/missing.pdf",
      checksum: null,
      source: { table: "incoming_mails", column: "file", record_id: "3" },
    },
  ];
  const diskFiles = [
    {
      stored_path: "/api/digital-archive-files/a.pdf",
      checksum: "actual",
      size_bytes: 10,
    },
    {
      stored_path: "/api/digital-archive-files/orphan.pdf",
      checksum: "actual",
      size_bytes: 10,
    },
  ];

  const report = buildStorageReconciliation({ databaseReferences, diskFiles });
  assert.equal(report.dry_run, true);
  assert.equal(report.summary.missing_files, 1);
  assert.equal(report.summary.orphan_candidates, 1);
  assert.equal(report.summary.duplicate_reference_paths, 1);
  assert.equal(report.summary.duplicate_content_groups, 1);
  assert.equal(report.summary.checksum_mismatches, 1);
});

test("referensi file pada JSON dikenali tanpa menerima URL asing", () => {
  const output = [];
  extractJsonReferences(
    {
      files: [
        {
          file_path: "/api/digital-archive-files/import/a.txt",
          checksum: "ABC",
        },
        { file_path: "https://example.com/file.txt" },
      ],
    },
    { table: "jobs", column: "files", record_id: "1", json_path: "$" },
    output,
  );

  assert.equal(output.length, 1);
  assert.equal(output[0].checksum, "abc");
  assert.equal(normalizeStoredPath("https://example.com/file.txt"), null);
});
