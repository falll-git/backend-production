const { activateRelease } = require("../src/system/atomic-release");
const { parseOptions, printResult, requireOption } = require("./atomic-release-cli");

function run(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const releaseId = requireOption(options, "release-id");
  const confirmation = requireOption(options, "confirm-release");
  if (confirmation !== releaseId) {
    throw new Error("--confirm-release wajib sama persis dengan --release-id.");
  }
  return activateRelease({
    deployRoot: requireOption(options, "deploy-root"),
    releaseId,
    expectedCurrentReleaseId: options["expected-current"] || null,
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
