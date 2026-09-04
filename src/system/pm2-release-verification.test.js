const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  REQUIRED_PROCESS_IDS,
  parsePm2Snapshot,
  verifyFrontendReleaseIdentity,
  verifyPm2Snapshot,
} = require("./pm2-release-verification");

function validSnapshot(instance = "demo") {
  return REQUIRED_PROCESS_IDS.map((id, index) => ({
    name: `${instance}-${id}`,
    pid: 1000 + index,
    pm2_env: {
      status: "online",
      env: { DATABASE_URL: "postgresql://should-never-be-reported" },
    },
  }));
}

test("verifikasi PM2 mewajibkan lima proses dan tidak mengembalikan environment", () => {
  const result = verifyPm2Snapshot(validSnapshot(), "demo");
  assert.equal(result.status, "passed");
  assert.equal(result.process_count, 5);
  assert.doesNotMatch(JSON.stringify(result), /DATABASE_URL|postgresql/);
});

function mockFrontendRelease(context) {
  const deployRoot = path.resolve("/srv/ruwang/demo");
  const commitSha = "a".repeat(40);
  const files = new Map([
    [path.join(deployRoot, "current", "release-manifest.json"), JSON.stringify({
      components: {
        backend: { root: "backend", commit_sha: "b".repeat(40) },
        frontend: { root: "frontend", commit_sha: commitSha },
      },
    })],
    [path.join(deployRoot, "current", "frontend", ".next", "required-server-files.json"), JSON.stringify({
      config: { deploymentId: commitSha, env: { NEXT_PUBLIC_APP_RELEASE: commitSha } },
    })],
    [path.join(deployRoot, "shared", "env", "frontend.env"),
      `NEXT_DEPLOYMENT_ID=${commitSha}\nNEXT_PUBLIC_APP_RELEASE=${commitSha}\nUNRELATED_SECRET=never-report-this\n`],
  ]);
  context.mock.method(fs, "readFileSync", (filename) => {
    if (!files.has(filename)) throw new Error("unexpected-read");
    return files.get(filename);
  });
  context.mock.method(fs, "realpathSync", (filename) => path.resolve(filename));
  return { deployRoot, frontendCommitSha: commitSha, files };
}

test("identitas frontend mencocokkan manifest, build, shared env, dan PM2 tanpa secret", (context) => {
  const release = mockFrontendRelease(context);
  const snapshot = validSnapshot();
  const env = snapshot[0].pm2_env;
  env.pm_cwd = path.join(release.deployRoot, "current", "frontend");
  env.NEXT_DEPLOYMENT_ID = release.frontendCommitSha;
  env.NEXT_PUBLIC_APP_RELEASE = release.frontendCommitSha;
  const result = verifyPm2Snapshot(snapshot, "demo", release);
  assert.equal(result.scope, "processes-and-frontend-deployment");
  assert.equal(result.frontend_commit_sha, release.frontendCommitSha);
  assert.doesNotMatch(JSON.stringify(result), /DATABASE_URL|UNRELATED_SECRET|never-report-this/);
  env.NEXT_DEPLOYMENT_ID = "b".repeat(40);
  assert.throws(() => verifyPm2Snapshot(snapshot, "demo", release), /Environment PM2 frontend NEXT_DEPLOYMENT_ID/);
  env.NEXT_DEPLOYMENT_ID = release.frontendCommitSha;
  env.env.NEXT_PUBLIC_APP_RELEASE = "b".repeat(40);
  assert.throws(() => verifyPm2Snapshot(snapshot, "demo", release), /Environment PM2 frontend NEXT_PUBLIC_APP_RELEASE/);
  delete env.env.NEXT_PUBLIC_APP_RELEASE;
  env.pm_cwd = path.join(release.deployRoot, "releases", "old", "frontend");
  assert.throws(() => verifyPm2Snapshot(snapshot, "demo", release), /Working directory PM2/);
});

test("identitas frontend menolak mismatch tiap sumber dan JSON rusak tanpa memantulkan isinya", (context) => {
  const release = mockFrontendRelease(context);
  const verify = () => verifyFrontendReleaseIdentity(release.deployRoot, release.frontendCommitSha);
  for (const [filename, original] of release.files) {
    release.files.set(filename, original.replaceAll(release.frontendCommitSha, "c".repeat(40)));
    assert.throws(verify, /Identitas frontend/);
    release.files.set(filename, original);
  }
  assert.throws(() => verifyFrontendReleaseIdentity("relative", release.frontendCommitSha), /absolute path/);
  assert.throws(() => verifyFrontendReleaseIdentity(release.deployRoot, "short"), /40 karakter/);
  const manifestPath = path.join(release.deployRoot, "current", "release-manifest.json");
  release.files.set(manifestPath, "sensitive-invalid-json");
  assert.throws(verify, (error) => {
    assert.match(error.message, /tidak dapat dibaca/);
    assert.doesNotMatch(error.message, /sensitive-invalid-json/);
    return true;
  });
});

test("verifikasi PM2 menolak worker hilang, proses offline, dan instance tidak aman", () => {
  assert.throws(
    () => verifyPm2Snapshot(validSnapshot().slice(0, -1), "demo"),
    /wajib tersedia tepat satu/,
  );
  const offline = validSnapshot();
  offline[1].pm2_env.status = "stopped";
  assert.throws(() => verifyPm2Snapshot(offline, "demo"), /belum online/);
  assert.throws(() => verifyPm2Snapshot(validSnapshot(), "../demo"), /slug aman/);
});

test("parser PM2 menolak output non-JSON dan non-array tanpa membocorkan isinya", () => {
  assert.throws(() => parsePm2Snapshot("not-json-secret"), /bukan JSON/);
  assert.throws(() => parsePm2Snapshot("{}"), /wajib berupa array/);
});
