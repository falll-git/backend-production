const prisma = require("../config/prisma");
const { ensureStorageReady } = require("./storage-runtime");
const { inspectDatabaseHealth } = require("./database-maintenance");
const {
  checkSlikImportQueueHealth,
  isSlikImportQueueEnabled,
} = require("../queues/slik-import.queue");
const {
  checkRateLimitStoreHealth,
  isRateLimitRedisEnabled,
} = require("./rate-limit-store");
const {
  checkApplicationCacheHealth,
  isApplicationCacheEnabled,
} = require("./application-cache");
const {
  checkWatermarkWorkerHealth,
  isWatermarkWorkerHeartbeatEnabled,
} = require("./worker-heartbeat");
const {
  checkObservabilityHealth,
  isObservabilityEnabled,
} = require("./observability");
const runtimeState = require("./runtime-state");

function readPositiveIntEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function withTimeout(promise, timeoutMs, label) {
  let timeout;
  const timeoutPromise = new Promise((resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} health check timed out.`)),
      timeoutMs,
    );
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeout);
  });
}

async function inspectDependency(check, { required }) {
  const startedAt = Date.now();

  try {
    const details = await check();
    return {
      status: "up",
      required,
      latency_ms: Date.now() - startedAt,
      ...(details && typeof details === "object" ? { details } : {}),
    };
  } catch {
    return {
      status: "down",
      required,
      latency_ms: Date.now() - startedAt,
    };
  }
}

function createReadinessService({
  databaseCheck,
  storageCheck,
  redisCheck,
  queueEnabled,
  rateLimitRedisEnabled,
  rateLimitStoreCheck,
  applicationCacheEnabled,
  applicationCacheCheck,
  watermarkWorkerEnabled,
  watermarkWorkerCheck,
  observabilityEnabled,
  observabilityCheck,
  isDraining = runtimeState.isDraining,
  timeoutMs = readPositiveIntEnv("HEALTH_CHECK_TIMEOUT_MS", 1500),
  cacheMs = readPositiveIntEnv("HEALTH_CHECK_CACHE_MS", 3000),
  now = () => Date.now(),
} = {}) {
  const resolvedDatabaseCheck =
    databaseCheck ||
    (() =>
      withTimeout(
        inspectDatabaseHealth(prisma),
        timeoutMs,
        "Database",
      ));
  const resolvedStorageCheck =
    storageCheck ||
    (() =>
      withTimeout(
        ensureStorageReady(),
        timeoutMs,
        "Storage",
      ));
  const resolvedQueueEnabled = queueEnabled ?? isSlikImportQueueEnabled();
  const queueHealthCheck =
    redisCheck || (() => checkSlikImportQueueHealth(timeoutMs));
  const resolvedRedisCheck = async () => {
    const result = await queueHealthCheck();
    if (result?.enabled && !result.reachable) {
      throw new Error("Redis is not reachable.");
    }
    return result;
  };
  const resolvedRateLimitRedisEnabled =
    rateLimitRedisEnabled ?? isRateLimitRedisEnabled();
  const resolvedRateLimitStoreCheck =
    rateLimitStoreCheck ||
    (() =>
      withTimeout(
        checkRateLimitStoreHealth(),
        timeoutMs,
        "Rate limit Redis",
      ));
  const resolvedApplicationCacheEnabled =
    applicationCacheEnabled ?? isApplicationCacheEnabled();
  const resolvedApplicationCacheCheck =
    applicationCacheCheck ||
    (() =>
      withTimeout(
        checkApplicationCacheHealth(),
        timeoutMs,
        "Application cache",
      ));
  const resolvedWatermarkWorkerEnabled =
    watermarkWorkerEnabled ?? isWatermarkWorkerHeartbeatEnabled();
  const resolvedWatermarkWorkerCheck =
    watermarkWorkerCheck ||
    (() =>
      withTimeout(
        checkWatermarkWorkerHealth(),
        timeoutMs,
        "Watermark worker",
      ));
  const resolvedObservabilityEnabled =
    observabilityEnabled ?? isObservabilityEnabled();
  const resolvedObservabilityCheck =
    observabilityCheck ||
    (() =>
      withTimeout(
        checkObservabilityHealth(),
        timeoutMs,
        "Observability",
      ));

  let cachedResult = null;
  let cacheExpiresAt = 0;
  let pendingCheck = null;

  async function executeChecks() {
    const databasePromise = inspectDependency(resolvedDatabaseCheck, {
      required: true,
    });
    const storagePromise = inspectDependency(resolvedStorageCheck, {
      required: true,
    });
    const redisPromise = resolvedQueueEnabled
      ? inspectDependency(resolvedRedisCheck, { required: false })
      : Promise.resolve({ status: "disabled", required: false });
    const rateLimitStorePromise = resolvedRateLimitRedisEnabled
      ? inspectDependency(resolvedRateLimitStoreCheck, { required: true })
      : Promise.resolve({
          status: "local",
          required: false,
          details: { mode: "memory" },
        });
    const applicationCachePromise = resolvedApplicationCacheEnabled
      ? inspectDependency(resolvedApplicationCacheCheck, { required: false })
      : Promise.resolve({ status: "disabled", required: false });
    const watermarkWorkerPromise = resolvedWatermarkWorkerEnabled
      ? inspectDependency(resolvedWatermarkWorkerCheck, { required: false })
      : Promise.resolve({ status: "disabled", required: false });
    const observabilityPromise = resolvedObservabilityEnabled
      ? inspectDependency(resolvedObservabilityCheck, { required: false })
      : Promise.resolve({ status: "disabled", required: false });

    const [
      database,
      storage,
      redis,
      rateLimitStore,
      applicationCache,
      watermarkWorker,
      observability,
    ] = await Promise.all([
        databasePromise,
        storagePromise,
        redisPromise,
        rateLimitStorePromise,
        applicationCachePromise,
        watermarkWorkerPromise,
        observabilityPromise,
      ]);
    const slikImportQueue =
      redis.status === "up" &&
      redis.details?.worker_required &&
      !redis.details?.workers_available
        ? { ...redis, status: "degraded" }
        : redis;
    const watermarkWorkerHealth =
      watermarkWorker.status === "up" &&
      !watermarkWorker.details?.workers_available
        ? { ...watermarkWorker, status: "degraded" }
        : watermarkWorker;
    const checks = {
      database,
      storage,
      redis: slikImportQueue,
      rate_limit_store: rateLimitStore,
      application_cache: applicationCache,
      watermark_worker: watermarkWorkerHealth,
      observability,
    };
    const ready = Object.values(checks).every(
      (check) => !check.required || check.status === "up",
    );
    const degraded = Object.values(checks).some(
      (check) =>
        !check.required && ["down", "degraded"].includes(check.status),
    );

    return {
      ready,
      state: ready ? (degraded ? "degraded" : "ready") : "not_ready",
      checks,
      checked_at: new Date(now()).toISOString(),
    };
  }

  async function checkReadiness({ force = false } = {}) {
    const currentTime = now();
    if (isDraining()) {
      return {
        ready: false,
        state: "draining",
        checks: {},
        checked_at: new Date(currentTime).toISOString(),
      };
    }
    if (!force && cachedResult && currentTime < cacheExpiresAt) {
      return cachedResult;
    }

    if (!force && pendingCheck) return pendingCheck;

    pendingCheck = executeChecks()
      .then((result) => {
        cachedResult = result;
        cacheExpiresAt = now() + cacheMs;
        return result;
      })
      .finally(() => {
        pendingCheck = null;
      });

    return pendingCheck;
  }

  return { checkReadiness };
}

const readinessService = createReadinessService();

module.exports = {
  checkReadiness: readinessService.checkReadiness,
  createReadinessService,
};
