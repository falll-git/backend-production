const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("controller SJ memasang ulang konteks RLS sebelum menjalankan service", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "seputarJaminan.controller.js"),
    "utf8",
  );

  assert.match(
    source,
    /runWithDatabaseUserContext\(req\.user\.id,\s*\(\)\s*=>\s*service\(req\)\)/u,
  );
});
