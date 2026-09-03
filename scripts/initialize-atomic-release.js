const { initializeReleaseLayout } = require("../src/system/atomic-release");
const { parseOptions, printResult, requireOption } = require("./atomic-release-cli");

function run(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  return initializeReleaseLayout(requireOption(options, "deploy-root"));
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
