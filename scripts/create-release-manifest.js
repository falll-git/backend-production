const { createReleaseManifest } = require("../src/system/atomic-release");
const { parseOptions, printResult, requireOption } = require("./atomic-release-cli");

function run(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const result = createReleaseManifest({
    deployRoot: requireOption(options, "deploy-root"),
    releaseId: requireOption(options, "release-id"),
    backendCommitSha: requireOption(options, "backend-sha"),
    frontendCommitSha: requireOption(options, "frontend-sha"),
  });
  return {
    release_id: result.manifest.release_id,
    manifest_path: result.manifest_path,
    manifest_sha256: result.sha256,
    automatic_deployment: false,
  };
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
