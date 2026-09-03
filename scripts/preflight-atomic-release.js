const { runAtomicPreflight } = require("../src/system/atomic-release");
const { parseOptions, printResult, requireOption } = require("./atomic-release-cli");

function run(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  return runAtomicPreflight({
    deployRoot: requireOption(options, "deploy-root"),
    releaseId: requireOption(options, "release-id"),
    applicationPreflightReportPath: requireOption(
      options,
      "application-preflight-report",
    ),
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
