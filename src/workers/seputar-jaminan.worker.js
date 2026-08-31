process.env.RUNTIME_ROLE ||= "seputar-jaminan-worker";

const { loadEnv, validateEnv } = require("../config/env");
loadEnv();
validateEnv();

const prisma = require("../config/prisma");
const { runSyncCycle } = require("../modules/seputar-jaminan/syncWorker.service");
const { logger } = require("../system/logger");

const workerLogger = logger.child({ component: "seputar_jaminan_worker" });

function positiveInt(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertDedicatedWorkerRole() {
  const [row] = await prisma.$queryRawUnsafe(`
    SELECT current_user AS role_name,
           current_setting('is_superuser') = 'on' AS is_superuser,
           COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS bypass_rls,
           pg_has_role(current_user, 'ruwang_sj_worker', 'member') AS is_worker_member
  `);
  if (!row || row.is_superuser || row.bypass_rls || !row.is_worker_member) {
    throw new Error("Worker Seputar Jaminan wajib memakai login khusus NOBYPASSRLS anggota ruwang_sj_worker.");
  }
}

async function startSeputarJaminanWorker({ registerSignals = true } = {}) {
  await prisma.$connect();
  await assertDedicatedWorkerRole();
  const pollMs = positiveInt("SJ_OUTBOX_POLL_INTERVAL_MS", 2000);
  const batchSize = positiveInt("SJ_OUTBOX_BATCH_SIZE", 10);
  let stopping = false;
  const loop = (async () => {
    workerLogger.info({ event: "sj_worker_ready", poll_ms: pollMs, batch_size: batchSize }, "Seputar Jaminan worker ready");
    while (!stopping) {
      const result = await runSyncCycle({ batchSize });
      if (!result.processed_count) await wait(pollMs);
      else await new Promise((resolve) => setImmediate(resolve));
    }
  })();
  const shutdown = async (signal = "SHUTDOWN") => {
    if (stopping) return;
    stopping = true;
    workerLogger.info({ event: "sj_worker_shutdown", signal }, "Seputar Jaminan worker shutting down");
    await loop;
    await prisma.$disconnect();
  };
  if (registerSignals) {
    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
  }
  return { shutdown };
}

if (require.main === module) {
  startSeputarJaminanWorker().catch(async (error) => {
    workerLogger.fatal({ event: "sj_worker_failed", err: error }, "Seputar Jaminan worker failed");
    await prisma.$disconnect().catch(() => {});
    process.exitCode = 1;
  });
}

module.exports = { assertDedicatedWorkerRole, startSeputarJaminanWorker };
