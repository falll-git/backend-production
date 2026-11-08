const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const SERVICE_FILES = [
  "media.service.js",
  "profileContact.service.js",
  "seputarJaminan.service.js",
];

test("mutasi HTTP Seputar Jaminan memakai transaction helper yang mempertahankan konteks RLS", () => {
  for (const fileName of SERVICE_FILES) {
    const source = fs.readFileSync(path.join(__dirname, fileName), "utf8");

    assert.match(
      source,
      /require\("\.\.\/\.\.\/config\/database-rls"\)/u,
      `${fileName} harus memakai helper transaction RLS`,
    );
    if (fileName === 'media.service.js') {
      assert.match(source, /withDatabaseTransaction\(async \(client\) =>/u);
    } else {
      // Combined save/submit injects the SAME transaction; standalone APIs keep
      // the RLS helper as default. An independent nested commit is forbidden.
      assert.match(source, /transaction = withDatabaseTransaction/u);
      assert.match(source, /transaction\(async \(client\) =>/u);
    }
    assert.doesNotMatch(
      source,
      /prisma\.\$transaction\(async \(client\) =>/u,
      `${fileName} tidak boleh memecah transaction mutasi menjadi query RLS terpisah`,
    );
  }
  const combined = fs.readFileSync(path.join(__dirname, 'saveOperation.service.js'), 'utf8');
  assert.match(combined, /withDatabaseTransaction\(async client =>/u);
  assert.match(combined, /const transaction = callback => callback\(client\)/u);
  for (const method of ['saveProfileDraft','submitProfile','createContact','updateContact','submitContact','createPublication','updatePublicationDraft','submitPublication']) {
    assert.match(combined, new RegExp(`${method}\\([^;\\n]*,transaction\\)`));
  }
});
