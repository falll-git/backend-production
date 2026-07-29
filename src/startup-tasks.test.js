const assert = require("node:assert/strict");
const test = require("node:test");
const { getStartupTasks, runStartupTasks } = require("./startup-tasks");

test("proses API tidak menjalankan background recovery", async () => {
  assert.deepEqual(getStartupTasks("api"), []);
  const result = await runStartupTasks({ role: "api" });
  assert.deepEqual(result, {
    role: "api",
    total: 0,
    completed: [],
    failed: [],
  });
});

test("recovery berat hanya terdaftar pada worker yang sesuai", () => {
  assert.deepEqual(
    getStartupTasks("slik-import-worker").map((task) => task.name),
    ["debtor-import-job-recovery"],
  );
  assert.deepEqual(
    getStartupTasks("watermark-worker").map((task) => task.name),
    ["watermark-job-recovery"],
  );
  assert.throws(() => getStartupTasks("unknown"), /tidak dikenal/);
});
