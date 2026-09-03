const path = require("node:path");

const { renderNginxConfigFile } = require("../src/system/nginx-release-template");
const { parseOptions, printResult, requireOption } = require("./atomic-release-cli");

function run(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  return renderNginxConfigFile({
    templatePath: options.template ? path.resolve(options.template) : undefined,
    outputPath: requireOption(options, "output"),
    domain: requireOption(options, "domain"),
    apiPort: requireOption(options, "api-port"),
    frontendPort: requireOption(options, "frontend-port"),
    tlsCertificatePath: requireOption(options, "tls-certificate"),
    tlsCertificateKeyPath: requireOption(options, "tls-key"),
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
