const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  installFatalProcessHandlers,
} = require("./process-errors");

test("uncaught exception dicatat fatal dan memicu shutdown exit code 1 satu kali", async () => {
  const processRef = new EventEmitter();
  const logs = [];
  const shutdowns = [];
  processRef.exit = (code) => shutdowns.push(["forced", code]);
  const remove = installFatalProcessHandlers({
    processRef,
    logger: {
      fatal(fields, message) {
        logs.push({ fields, message });
      },
      flush() {},
    },
    shutdown: async (signal, code) => {
      shutdowns.push([signal, code]);
    },
  });

  processRef.emit("uncaughtException", new Error("fatal failure"));
  processRef.emit("unhandledRejection", new Error("duplicate failure"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(logs.length, 1);
  assert.equal(logs[0].fields.event, "uncaught_exception");
  assert.deepEqual(shutdowns, [["uncaught_exception", 1]]);
  remove();
  assert.equal(processRef.listenerCount("uncaughtException"), 0);
  assert.equal(processRef.listenerCount("unhandledRejection"), 0);
});

test("reason rejection non-Error dinormalisasi menjadi Error", async () => {
  const processRef = new EventEmitter();
  processRef.exit = () => {};
  let loggedError;
  installFatalProcessHandlers({
    processRef,
    logger: {
      fatal(fields) {
        loggedError = fields.err;
      },
      flush() {},
    },
    shutdown: async () => {},
  });

  processRef.emit("unhandledRejection", "rejection text");
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(loggedError instanceof Error);
  assert.equal(loggedError.message, "rejection text");
});
