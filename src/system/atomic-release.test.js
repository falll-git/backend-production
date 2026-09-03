const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MANIFEST_FILE,
  activateRelease,
  createReleaseManifest,
  initializeReleaseLayout,
  resolveCurrentReleaseId,
  rollbackRelease,
  runAtomicPreflight,
  verifyReleaseManifest,
} = require("./atomic-release");

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function createDisposableDeployRoot() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ruwang-atomic-test-"));
  const deployRoot = path.join(parent, "deployment");
  initializeReleaseLayout(deployRoot);
  writeFile(path.join(deployRoot, "shared", "env", "backend.env"), "NODE_ENV=production\n");
  writeFile(path.join(deployRoot, "shared", "env", "frontend.env"), "NODE_ENV=production\n");
  if (process.platform !== "win32") {
    fs.chmodSync(path.join(deployRoot, "shared", "env", "backend.env"), 0o600);
    fs.chmodSync(path.join(deployRoot, "shared", "env", "frontend.env"), 0o600);
  }
  return { parent, deployRoot };
}

function createRelease(deployRoot, releaseId, marker) {
  const releaseRoot = path.join(deployRoot, "releases", releaseId);
  writeFile(path.join(releaseRoot, "backend", "package.json"), '{"name":"backend"}\n');
  writeFile(path.join(releaseRoot, "backend", "src", "marker.txt"), `${marker}\n`);
  writeFile(
    path.join(releaseRoot, "backend", "prisma", "migrations", "001_initial", "migration.sql"),
    "SELECT 1;\n",
  );
  writeFile(path.join(releaseRoot, "frontend", "package.json"), '{"name":"frontend"}\n');
  writeFile(path.join(releaseRoot, "frontend", "app", "marker.txt"), `${marker}\n`);
  writeFile(path.join(releaseRoot, "frontend", ".next", "BUILD_ID"), `build-${marker}\n`);
  const applicationPreflightReportPath = path.join(
    releaseRoot,
    "backend",
    "release-reports",
    "latest",
    "preflight.json",
  );
  writeFile(
    applicationPreflightReportPath,
    `${JSON.stringify({
      schema_version: 1,
      kind: "preflight",
      status: "passed",
      release_id: releaseId,
      automatic_deployment: false,
      checks: [{ id: "disposable", status: "passed" }],
    })}\n`,
  );
  createReleaseManifest({
    deployRoot,
    releaseId,
    backendCommitSha: marker.repeat(40).slice(0, 40),
    frontendCommitSha: marker.repeat(40).slice(0, 40),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  return { releaseRoot, applicationPreflightReportPath };
}

test("manifest mendeteksi perubahan dan environment file yang tidak boleh dikirim", () => {
  const { parent, deployRoot } = createDisposableDeployRoot();
  try {
    const { releaseRoot } = createRelease(deployRoot, "release-a1", "a");
    assert.equal(
      verifyReleaseManifest({ deployRoot, releaseId: "release-a1" }).component_count,
      2,
    );
    writeFile(path.join(releaseRoot, "backend", "src", "marker.txt"), "tampered\n");
    assert.throws(
      () => verifyReleaseManifest({ deployRoot, releaseId: "release-a1" }),
      /Checksum atau daftar file backend/,
    );

    const unsafeRoot = path.join(deployRoot, "releases", "release-b2");
    writeFile(path.join(unsafeRoot, "backend", "package.json"), "{}\n");
    writeFile(path.join(unsafeRoot, "backend", ".env"), "SECRET=not-for-release\n");
    writeFile(path.join(unsafeRoot, "frontend", "package.json"), "{}\n");
    assert.throws(
      () => createReleaseManifest({
        deployRoot,
        releaseId: "release-b2",
        backendCommitSha: "b".repeat(40),
        frontendCommitSha: "b".repeat(40),
      }),
      /Environment file tidak boleh/,
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("release tidak dapat diaktifkan sebelum preflight aplikasi dan struktural lulus", () => {
  const { parent, deployRoot } = createDisposableDeployRoot();
  try {
    const { applicationPreflightReportPath } = createRelease(
      deployRoot,
      "release-a1",
      "a",
    );
    assert.throws(
      () => activateRelease({ deployRoot, releaseId: "release-a1" }),
      /Atomic preflight belum dijalankan/,
    );
    runAtomicPreflight({
      deployRoot,
      releaseId: "release-a1",
      applicationPreflightReportPath,
      checkedAt: new Date("2026-01-01T00:00:01.000Z"),
    });
    const applicationReport = fs.readFileSync(applicationPreflightReportPath, "utf8");
    writeFile(
      applicationPreflightReportPath,
      applicationReport.replace('"status":"passed"', '"status":"failed"'),
    );
    assert.throws(
      () => activateRelease({ deployRoot, releaseId: "release-a1" }),
      /belum menyatakan seluruh check lulus/,
    );
    writeFile(applicationPreflightReportPath, applicationReport);
    runAtomicPreflight({
      deployRoot,
      releaseId: "release-a1",
      applicationPreflightReportPath,
      checkedAt: new Date("2026-01-01T00:00:02.000Z"),
    });
    const result = activateRelease({ deployRoot, releaseId: "release-a1" });
    assert.equal(result.current_release, "release-a1");
    assert.equal(result.previous_release, null);
    assert.equal(resolveCurrentReleaseId(deployRoot), "release-a1");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("switch dan rollback menjaga kedua release serta memverifikasi current yang diharapkan", () => {
  const { parent, deployRoot } = createDisposableDeployRoot();
  try {
    const first = createRelease(deployRoot, "release-a1", "a");
    const second = createRelease(deployRoot, "release-b2", "b");
    const firstRoot = first.releaseRoot;
    const secondRoot = second.releaseRoot;
    runAtomicPreflight({
      deployRoot,
      releaseId: "release-a1",
      applicationPreflightReportPath: first.applicationPreflightReportPath,
    });
    runAtomicPreflight({
      deployRoot,
      releaseId: "release-b2",
      applicationPreflightReportPath: second.applicationPreflightReportPath,
    });
    activateRelease({ deployRoot, releaseId: "release-a1" });
    const switched = activateRelease({
      deployRoot,
      releaseId: "release-b2",
      expectedCurrentReleaseId: "release-a1",
    });
    assert.equal(switched.previous_release, "release-a1");
    assert.equal(resolveCurrentReleaseId(deployRoot), "release-b2");
    assert.equal(fs.readFileSync(path.join(firstRoot, "backend", "src", "marker.txt"), "utf8"), "a\n");
    assert.equal(fs.readFileSync(path.join(secondRoot, "backend", "src", "marker.txt"), "utf8"), "b\n");

    assert.throws(
      () => rollbackRelease({
        deployRoot,
        toReleaseId: "release-a1",
        expectedCurrentReleaseId: "release-yang-salah",
      }),
      /Current release berubah/,
    );
    const rolledBack = rollbackRelease({
      deployRoot,
      toReleaseId: "release-a1",
      expectedCurrentReleaseId: "release-b2",
    });
    assert.equal(rolledBack.current_release, "release-a1");
    assert.equal(rolledBack.previous_release, "release-b2");
    assert.equal(resolveCurrentReleaseId(deployRoot), "release-a1");
    assert.equal(fs.existsSync(path.join(secondRoot, MANIFEST_FILE)), true);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("release ID dan deploy root tidak dapat keluar dari batas aman", () => {
  const { parent, deployRoot } = createDisposableDeployRoot();
  try {
    assert.throws(
      () => createReleaseManifest({ deployRoot, releaseId: "../keluar" }),
      /Release ID/,
    );
    assert.throws(
      () => initializeReleaseLayout(path.parse(deployRoot).root),
      /filesystem root/,
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("preflight memvalidasi dan menghitung checksum dari file descriptor yang sama", (context) => {
  const { parent, deployRoot } = createDisposableDeployRoot();
  try {
    const { applicationPreflightReportPath } = createRelease(deployRoot, "release-a1", "a");
    const original = fs.readFileSync(applicationPreflightReportPath);
    const readFile = fs.readFileSync;
    let descriptorReads = 0;
    context.mock.method(fs, "readFileSync", function (filename, ...options) {
      const content = readFile.call(fs, filename, ...options);
      if (typeof filename === "number") {
        descriptorReads += 1;
        fs.writeFileSync(applicationPreflightReportPath, '{"status":"failed"}');
      }
      return content;
    });
    const marker = runAtomicPreflight({ deployRoot, releaseId: "release-a1", applicationPreflightReportPath });
    assert.equal(descriptorReads, 1);
    assert.equal(marker.application_preflight_sha256, crypto.createHash("sha256").update(original).digest("hex"));
    assert.throws(() => activateRelease({ deployRoot, releaseId: "release-a1" }), /belum menyatakan seluruh check lulus/);
  } finally {
    context.mock.restoreAll();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
