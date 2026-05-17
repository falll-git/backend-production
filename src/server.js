const { loadEnv, validateEnv } = require("./config/env");

loadEnv();
validateEnv();

const app = require("./app");
const { runStartupTasks } = require("./startup-tasks");

function resolvePort(value) {
  const port = Number.parseInt(value || "7111", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT harus berupa angka valid antara 1 dan 65535.");
  }

  return port;
}

function startServer() {
  const port = resolvePort(process.env.PORT);
  const host = process.env.HOST || "0.0.0.0";
  const server = app.listen(port, host, () => {
    console.log(`Server running on ${host}:${port}`);
    runStartupTasks().catch((error) => {
      console.error("[startup] task runner failed", error);
    });
  });

  const shutdown = (signal) => {
    console.log(`${signal} received. Closing HTTP server.`);
    server.close((error) => {
      if (error) {
        console.error("HTTP server close failed", error);
        process.exit(1);
      }

      process.exit(0);
    });
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer,
};
