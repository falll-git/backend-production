const { rollbackRelease } = require("../src/system/atomic-release");
const { parseOptions, printResult, requireOption } = require("./atomic-release-cli");

function run(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const target = requireOption(options, "to-release");
  const confirmation = requireOption(options, "confirm-release");
  if (confirmation !== target) {
    throw new Error("--confirm-release wajib sama persis dengan --to-release.");
  }
  return rollbackRelease({
    deployRoot: requireOption(options, "deploy-root"),
    toReleaseId: target,
    expectedCurrentReleaseId: requireOption(options, "expected-current"),
  });
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
