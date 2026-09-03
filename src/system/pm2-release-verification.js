const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

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

function verifyPm2Snapshot(snapshot, instanceValue) {
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
  return {
    status: "passed",
    instance,
    process_count: checks.length,
    automatic_deployment: false,
    checks,
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
  verifyPm2Snapshot,
};
