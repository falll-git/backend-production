const STARTUP_TASKS_BY_ROLE = Object.freeze({
  api: [],
  "slik-import-worker": [
    {
      name: "debtor-import-job-recovery",
      run: async () => {
        const {
          recoverPendingDebtorImportJobs,
        } = require("./modules/debtor-imports/debtorImports.service");

        await recoverPendingDebtorImportJobs();
      },
    },
  ],
  "watermark-worker": [
    {
      name: "watermark-job-recovery",
      run: async () => {
        const {
          recoverPendingWatermarkJobs,
        } = require("./modules/watermark-settings/watermarkProcessor.service");

        await recoverPendingWatermarkJobs();
      },
    },
  ],
});

function getStartupTasks(role) {
  const tasks = STARTUP_TASKS_BY_ROLE[role];
  if (!tasks) {
    throw new Error(`Runtime role tidak dikenal: ${role || "(kosong)"}.`);
  }
  return tasks;
}

async function runStartupTasks({ role, logger = console } = {}) {
  const tasks = getStartupTasks(role);
  const result = {
    role,
    total: tasks.length,
    completed: [],
    failed: [],
  };

  for (const task of tasks) {
    try {
      await task.run();
      result.completed.push(task.name);
    } catch (error) {
      result.failed.push(task.name);
      logger.error(`[startup] ${task.name} failed`, error);
    }
  }

  return result;
}

module.exports = {
  getStartupTasks,
  runStartupTasks,
};
