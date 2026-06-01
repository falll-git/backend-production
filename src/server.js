const { loadEnv, validateEnv } = require("./config/env");

loadEnv();
validateEnv();

const app = require("./app");
const prisma = require("./config/prisma");
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
    const forceExitTimer = setTimeout(() => {
      console.error("Graceful shutdown timed out.");
      process.exit(1);
    }, 10000);

    server.close(async (error) => {
      if (error) {
        clearTimeout(forceExitTimer);
        console.error("HTTP server close failed", error);
        process.exit(1);
      }

      try {
        await prisma.$disconnect();
        clearTimeout(forceExitTimer);
        process.exit(0);
      } catch (disconnectError) {
        clearTimeout(forceExitTimer);
        console.error("Prisma disconnect failed", disconnectError);
        process.exit(1);
      }
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
