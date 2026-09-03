const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  activateRelease,
  createReleaseManifest,
  initializeReleaseLayout,
  resolveCurrentReleaseId,
  rollbackRelease,
  runAtomicPreflight,
} = require("../src/system/atomic-release");
const {
  REQUIRED_PROCESS_IDS,
  verifyPm2Snapshot,
} = require("../src/system/pm2-release-verification");

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeApplicationPreflightReport(releaseRoot, releaseId) {
  const reportPath = path.join(
    releaseRoot,
    "backend",
    "release-reports",
    "latest",
    "preflight.json",
  );
  writeFile(
    reportPath,
    `${JSON.stringify({
      schema_version: 1,
      kind: "preflight",
      status: "passed",
      release_id: releaseId,
      automatic_deployment: false,
      checks: [{ id: "disposable-runtime", status: "passed" }],
    })}\n`,
  );
  return reportPath;
}

function stageRelease(
  deployRoot,
  releaseId,
  marker,
  commitCharacter,
) {
  const releaseRoot = path.join(deployRoot, "releases", releaseId);
  writeFile(path.join(releaseRoot, "backend", "package.json"), '{"name":"backend"}\n');
  writeFile(path.join(releaseRoot, "backend", "src", "release.txt"), `${marker}\n`);
  writeFile(
    path.join(releaseRoot, "backend", "prisma", "migrations", "001_initial", "migration.sql"),
    "SELECT 1;\n",
  );
  writeFile(path.join(releaseRoot, "frontend", "package.json"), '{"name":"frontend"}\n');
  writeFile(path.join(releaseRoot, "frontend", "app", "release.txt"), `${marker}\n`);
  writeFile(path.join(releaseRoot, "frontend", ".next", "BUILD_ID"), `build-${marker}\n`);
  const applicationPreflightReportPath = writeApplicationPreflightReport(
    releaseRoot,
    releaseId,
  );
  createReleaseManifest({
    deployRoot,
    releaseId,
    backendCommitSha: commitCharacter.repeat(40),
    frontendCommitSha: commitCharacter.repeat(40),
  });
  runAtomicPreflight({ deployRoot, releaseId, applicationPreflightReportPath });
  return releaseRoot;
}

function run() {
  const disposableRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ruwang-atomic-simulation-"));
  const deployRoot = path.join(disposableRoot, "deployment");
  try {
    initializeReleaseLayout(deployRoot);
    const backendEnv = path.join(deployRoot, "shared", "env", "backend.env");
    const frontendEnv = path.join(deployRoot, "shared", "env", "frontend.env");
    writeFile(backendEnv, "NODE_ENV=production\n");
    writeFile(frontendEnv, "NODE_ENV=production\n");
    if (process.platform !== "win32") {
      fs.chmodSync(backendEnv, 0o600);
      fs.chmodSync(frontendEnv, 0o600);
    }

    const firstRoot = stageRelease(
      deployRoot,
      "release-0001",
      "first",
      "a",
    );
    const secondRoot = stageRelease(
      deployRoot,
      "release-0002",
      "second",
      "b",
    );
    activateRelease({ deployRoot, releaseId: "release-0001" });
    const firstSnapshot = fs.readFileSync(
      path.join(firstRoot, "backend", "src", "release.txt"),
      "utf8",
    );
    activateRelease({
      deployRoot,
      releaseId: "release-0002",
      expectedCurrentReleaseId: "release-0001",
    });
    assert.equal(resolveCurrentReleaseId(deployRoot), "release-0002");
    assert.equal(
      fs.readFileSync(path.join(deployRoot, "current", "backend", "src", "release.txt"), "utf8"),
      "second\n",
    );
    assert.equal(
      fs.readFileSync(path.join(firstRoot, "backend", "src", "release.txt"), "utf8"),
      firstSnapshot,
    );
    assert.equal(fs.existsSync(secondRoot), true);
    const pm2Result = verifyPm2Snapshot(
      REQUIRED_PROCESS_IDS.map((id, index) => ({
        name: `disposable-${id}`,
        pid: 2000 + index,
        pm2_env: { status: "online" },
      })),
      "disposable",
    );
    assert.equal(pm2Result.process_count, 5);

    rollbackRelease({
      deployRoot,
      toReleaseId: "release-0001",
      expectedCurrentReleaseId: "release-0002",
    });
    assert.equal(resolveCurrentReleaseId(deployRoot), "release-0001");
    assert.equal(
      fs.readFileSync(path.join(deployRoot, "current", "backend", "src", "release.txt"), "utf8"),
      "first\n",
    );
    return {
      status: "passed",
      strategy: "manual-atomic-symlink",
      simulated_platform: process.platform,
      releases_preserved: 2,
      active_release_after_rollback: "release-0001",
      active_release_was_not_overwritten: true,
      pm2_process_contract_verified: 5,
      disposable_root_cleaned: true,
      automatic_deployment: false,
    };
  } finally {
    fs.rmSync(disposableRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(run(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { run };
