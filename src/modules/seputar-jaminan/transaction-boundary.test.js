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
    assert.match(
      source,
      /withDatabaseTransaction\(async \(client\) =>/u,
      `${fileName} harus membuka transaction melalui helper RLS`,
    );
    assert.doesNotMatch(
      source,
      /prisma\.\$transaction\(async \(client\) =>/u,
      `${fileName} tidak boleh memecah transaction mutasi menjadi query RLS terpisah`,
    );
  }
});
