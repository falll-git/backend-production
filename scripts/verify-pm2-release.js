const path = require("node:path");

const {
  readPm2Snapshot,
  verifyPm2Snapshot,
} = require("../src/system/pm2-release-verification");
const { parseOptions, printResult, requireOption } = require("./atomic-release-cli");

function run(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const snapshotPath = options.snapshot
    ? path.resolve(options.snapshot)
    : null;
  const snapshot = readPm2Snapshot({ snapshotPath });
  return verifyPm2Snapshot(snapshot, requireOption(options, "instance"));
}

if (require.main === module) {
  try {
    printResult(run());
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { run };
