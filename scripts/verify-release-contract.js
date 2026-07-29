const {
  verifyReleaseContract,
} = require("../src/system/release-readiness");

function run() {
  const result = verifyReleaseContract();
  process.stdout.write(
    `${JSON.stringify({ status: "passed", ...result })}\n`,
  );
}

if (require.main === module) {
  try {
    run();
  } catch {
    process.stdout.write(
      `${JSON.stringify({ status: "failed", reason: "release_contract" })}\n`,
    );
    process.exitCode = 1;
  }
}

module.exports = { run };
