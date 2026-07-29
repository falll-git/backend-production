const { spawnSync } = require("child_process");

const result = spawnSync(
  process.execPath,
  [
    "--test",
    "--test-concurrency=1",
    "src/integration/api-database.workflow.test.js",
    "src/integration/collateral-monitoring.workflow.test.js",
    "src/integration/correspondence.workflow.test.js",
    "src/integration/debtor-operational-files.workflow.test.js",
    "src/integration/digital-archive-document.workflow.test.js",
    "src/integration/digital-archive-loan.workflow.test.js",
    "src/integration/import-upload.workflow.test.js",
    "src/integration/legal-deposit-ledger.workflow.test.js",
    "src/integration/legal-progress.workflow.test.js",
    "src/integration/pagination-abuse.workflow.test.js",
    "src/integration/rbac-boundary.workflow.test.js",
    "src/integration/report-delivery.workflow.test.js",
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RUN_API_DB_INTEGRATION: "true",
      RUN_CRITICAL_DB_INTEGRATION: "true",
      RUN_LAYER4_DB_INTEGRATION: "true",
    },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
