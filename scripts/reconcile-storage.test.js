const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("storage reconciliation memakai system client untuk audit lintas scope", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "reconcile-storage.js"),
    "utf8",
  );

  assert.match(source, /require\("\.\.\/src\/config\/prisma-system"\)/);
  assert.doesNotMatch(
    source,
    /const prisma = require\("\.\.\/src\/config\/prisma"\);/,
  );
});
