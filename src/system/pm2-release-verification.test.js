const assert = require("node:assert/strict");
const test = require("node:test");

const {
  REQUIRED_PROCESS_IDS,
  parsePm2Snapshot,
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
