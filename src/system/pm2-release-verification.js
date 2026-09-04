const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseEnv } = require("node:util");

const REQUIRED_PROCESS_IDS = Object.freeze([
  "frontend",
  "api",
  "slik-import-worker",
  "watermark-worker",
  "seputar-jaminan-worker",
]);

function assertInstanceSlug(value) {
  const instance = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(instance)) {
    throw new Error("Instance PM2 wajib berupa slug aman.");
  }
  return instance;
}

function parsePm2Snapshot(source) {
  let snapshot;
  try {
    snapshot = JSON.parse(String(source || ""));
  } catch {
    throw new Error("Snapshot PM2 bukan JSON yang valid.");
  }
  if (!Array.isArray(snapshot)) throw new Error("Snapshot PM2 wajib berupa array.");
  return snapshot;
}

function verifyFrontendReleaseIdentity(deployRoot, expectedFrontendCommitSha) {
  if (typeof deployRoot !== "string" || !path.isAbsolute(deployRoot)) {
    throw new Error("Deploy root wajib berupa absolute path.");
  }
  const commitSha = String(expectedFrontendCommitSha || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new Error("Commit SHA frontend wajib berisi 40 karakter heksadesimal.");
  }
  const current = path.join(deployRoot, "current");
  const frontendDirectory = path.join(current, "frontend");
  let manifest;
  let build;
  let frontendEnv;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(current, "release-manifest.json"), "utf8"));
    build = JSON.parse(fs.readFileSync(path.join(frontendDirectory, ".next", "required-server-files.json"), "utf8"));
    frontendEnv = parseEnv(fs.readFileSync(path.join(deployRoot, "shared", "env", "frontend.env"), "utf8"));
  } catch {
    throw new Error("Manifest release, manifest build, atau environment frontend tidak dapat dibaca.");
  }
  if (
    manifest?.components?.frontend?.root !== "frontend" ||
    manifest.components.frontend.commit_sha !== commitSha ||
    build?.config?.deploymentId !== commitSha ||
    build.config.env?.NEXT_PUBLIC_APP_RELEASE !== commitSha ||
    frontendEnv.NEXT_DEPLOYMENT_ID !== commitSha ||
    frontendEnv.NEXT_PUBLIC_APP_RELEASE !== commitSha
  ) {
    throw new Error("Identitas frontend pada manifest release, build, dan environment wajib sama dengan commit SHA frontend target.");
  }
  return { frontend_commit_sha: commitSha, frontend_directory: frontendDirectory };
}

function verifyPm2Snapshot(snapshot, instanceValue, frontendRelease = null) {
  if (!Array.isArray(snapshot)) throw new Error("Snapshot PM2 wajib berupa array.");
  const instance = assertInstanceSlug(instanceValue);
  const checks = [];
  for (const processId of REQUIRED_PROCESS_IDS) {
    const expectedName = `${instance}-${processId}`;
    const matches = snapshot.filter((entry) => entry?.name === expectedName);
    if (matches.length !== 1) {
      throw new Error(`Proses PM2 ${expectedName} wajib tersedia tepat satu instance.`);
    }
    const entry = matches[0];
    if (
      entry.pm2_env?.status !== "online" ||
      !Number.isInteger(entry.pid) ||
      entry.pid <= 0
    ) {
      throw new Error(`Proses PM2 ${expectedName} belum online.`);
    }
    checks.push({ id: processId, name: expectedName, status: "online" });
  }
  let identity = null;
  if (frontendRelease) {
    identity = verifyFrontendReleaseIdentity(
      frontendRelease.deployRoot,
      frontendRelease.frontendCommitSha,
    );
    const frontend = snapshot.find((entry) => entry.name === `${instance}-frontend`);
    const environment = frontend.pm2_env;
    for (const key of ["NEXT_DEPLOYMENT_ID", "NEXT_PUBLIC_APP_RELEASE"]) {
      const effective = environment[key] ?? environment.env?.[key];
      if (
        effective !== identity.frontend_commit_sha ||
        (environment.env?.[key] !== undefined && environment.env[key] !== identity.frontend_commit_sha)
      ) {
        throw new Error(`Environment PM2 frontend ${key} tidak sesuai release target.`);
      }
    }
    if (
      typeof environment.pm_cwd !== "string" ||
      !path.isAbsolute(environment.pm_cwd) ||
      fs.realpathSync(environment.pm_cwd) !== fs.realpathSync(identity.frontend_directory)
    ) {
      throw new Error("Working directory PM2 frontend tidak sesuai release target.");
    }
  }
  return {
    status: "passed",
    scope: identity ? "processes-and-frontend-deployment" : "processes-only",
    instance,
    process_count: checks.length,
    automatic_deployment: false,
    checks,
    ...(identity ? { frontend_commit_sha: identity.frontend_commit_sha } : {}),
  };
}

function readPm2Snapshot({ snapshotPath, timeoutMs = 15000 } = {}) {
  if (snapshotPath) {
    return parsePm2Snapshot(fs.readFileSync(snapshotPath, "utf8"));
  }
  const result = spawnSync("pm2", ["jlist"], {
    encoding: "utf8",
    shell: false,
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error("PM2 jlist gagal dijalankan.");
  }
  return parsePm2Snapshot(result.stdout);
}

module.exports = {
  REQUIRED_PROCESS_IDS,
  assertInstanceSlug,
  parsePm2Snapshot,
  readPm2Snapshot,
  verifyFrontendReleaseIdentity,
  verifyPm2Snapshot,
};
