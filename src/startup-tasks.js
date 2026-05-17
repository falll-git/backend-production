const STARTUP_TASKS = [
  {
    name: "watermark-job-recovery",
    run: async () => {
      const {
        recoverPendingWatermarkJobs,
      } = require("./modules/watermark-settings/watermarkProcessor.service");

      await recoverPendingWatermarkJobs();
    },
  },
];

async function runStartupTasks({ logger = console } = {}) {
  const result = {
    total: STARTUP_TASKS.length,
    completed: [],
    failed: [],
  };

  for (const task of STARTUP_TASKS) {
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
  runStartupTasks,
};
