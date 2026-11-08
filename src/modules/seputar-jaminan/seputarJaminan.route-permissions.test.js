const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = readFileSync(
  path.join(__dirname, "seputarJaminan.route.js"),
  "utf8",
);

test("endpoint bank memakai lima child permission Seputar Jaminan", () => {
  assert.match(source, /router\.get\("\/dashboard", authorize\(SUMMARY, "read"\)/);
  assert.match(source, /router\.get\("\/profile", authorize\(PROFILE, "read"\)/);
  assert.match(source, /router\.get\("\/contacts", authorize\(CONTACTS, "read"\)/);
  assert.match(source, /router\.get\("\/contacts\/:id", authorize\(CONTACTS, "read"\), controller\.getContact\)/);
  assert.match(source, /router\.get\("\/publications", authorize\(PUBLICATIONS, "read"\)/);
  assert.match(source, /router\.get\(\s*"\/submissions",\s*authorize\(SUBMISSIONS, "read"\)/);
});

test("keputusan lama memakai fitur Pengajuan dan bukan izin parent", () => {
  assert.match(source, /const submissionFeature = \(name\) =>[\s\S]*authorize\(SUBMISSIONS, "update", \{ feature: name \}\)/);
  assert.doesNotMatch(source, /authorize\(ROOT,/);
});
