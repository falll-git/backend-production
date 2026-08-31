const { loadEnv } = require("./env");
const { createRlsAwarePrismaClient } = require("./prisma-client-factory");

loadEnv();

function isWorkerRuntime(role = process.env.RUNTIME_ROLE) {
  return ["slik-import-worker", "watermark-worker", "seputar-jaminan-worker"].includes(
    String(role || "").trim().toLowerCase(),
  );
}

function resolveRuntimeDatabase(env = process.env) {
  const applicationUrl = String(env.DATABASE_URL || "").trim();
  const systemUrl = String(env.DATABASE_SYSTEM_URL || "").trim();
  const seputarJaminanWorkerUrl = String(env.SJ_WORKER_DATABASE_URL || "").trim();
  const isSeputarJaminanWorker =
    String(env.RUNTIME_ROLE || "").trim().toLowerCase() ===
    "seputar-jaminan-worker";
  if (isSeputarJaminanWorker) {
    if (!seputarJaminanWorkerUrl) {
      throw new Error("SJ_WORKER_DATABASE_URL wajib untuk worker Seputar Jaminan.");
    }
    return {
      connectionString: seputarJaminanWorkerUrl,
      usesSystemDatabase: false,
    };
  }
  const useSystemDatabase = Boolean(
    isWorkerRuntime(env.RUNTIME_ROLE) &&
      systemUrl &&
      systemUrl !== applicationUrl,
  );

  return {
    connectionString: useSystemDatabase ? systemUrl : applicationUrl,
    usesSystemDatabase: useSystemDatabase,
  };
}

const runtimeDatabase = resolveRuntimeDatabase();
const runtimeClient = createRlsAwarePrismaClient({
  connectionString: runtimeDatabase.connectionString,
});

module.exports = {
  baseClient: runtimeClient.baseClient,
  client: runtimeClient.client,
  isWorkerRuntime,
  resolveRuntimeDatabase,
  usesSystemDatabase: runtimeDatabase.usesSystemDatabase,
};
