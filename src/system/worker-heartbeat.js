const crypto = require("crypto");
const Redis = require("ioredis");
const { logger: systemLogger } = require("./logger");
const { attachEmitterErrorLogging } = require("./infrastructure-events");

const DEFAULT_PREFIX = "ruwang-arsip:worker-heartbeat";
const WATERMARK_WORKER_ROLE = "watermark-worker";
const RECORD_HEARTBEAT_SCRIPT = `
redis.call("ZADD", KEYS[1], ARGV[1], ARGV[2])
redis.call("PEXPIRE", KEYS[1], ARGV[3])
return 1
`;
const INSPECT_HEARTBEAT_SCRIPT = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
local count = redis.call("ZCARD", KEYS[1])
if count == 0 then
  return {0, 0}
end
local latest = redis.call("ZREVRANGE", KEYS[1], 0, 0, "WITHSCORES")
local ttl = tonumber(latest[2]) - tonumber(ARGV[1])
if ttl < 0 then
  ttl = 0
end
return {count, ttl}
`;
const RELEASE_HEARTBEAT_SCRIPT = `
local removed = redis.call("ZREM", KEYS[1], ARGV[1])
if redis.call("ZCARD", KEYS[1]) == 0 then
  redis.call("DEL", KEYS[1])
end
return removed
`;

function readPositiveIntEnv(key, fallback, env = process.env) {
  const value = Number(env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeRole(role) {
  const normalized = String(role || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw new Error("Role worker heartbeat tidak valid.");
  }
  return normalized;
}

function resolveWorkerHeartbeatRedisUrl(env = process.env) {
  const configured = env.JOB_QUEUE_REDIS_URL || env.REDIS_URL;
  if (configured) return configured;
  if (env.NODE_ENV === "production") {
    throw new Error(
      "JOB_QUEUE_REDIS_URL atau REDIS_URL wajib untuk worker heartbeat production.",
    );
  }
  return "redis://127.0.0.1:6379";
}

function resolveWatermarkProcessingMode(env = process.env) {
  const configured = String(env.WATERMARK_PROCESSING_MODE || "")
    .trim()
    .toLowerCase();
  if (configured) return configured;
  return env.NODE_ENV === "production" ? "worker" : "inline";
}

function isWatermarkWorkerHeartbeatEnabled(env = process.env) {
  return resolveWatermarkProcessingMode(env) === "worker";
}

function createRedisClient({ url, env = process.env } = {}) {
  const client = new Redis(url || resolveWorkerHeartbeatRedisUrl(env), {
    lazyConnect: true,
    connectTimeout: readPositiveIntEnv(
      "WORKER_HEARTBEAT_REDIS_CONNECT_TIMEOUT_MS",
      1000,
      env,
    ),
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy(attempt) {
      return Math.min(attempt * 100, 3000);
    },
  });
  attachEmitterErrorLogging(client, {
    component: "worker_heartbeat_redis",
    event: "redis_connection_error",
  });
  return client;
}

async function ensureRedisConnected(client) {
  if (client.status === "wait") await client.connect();
  if (client.status === "end") {
    throw new Error("Koneksi Redis worker heartbeat sudah ditutup.");
  }
}

function createRedisWorkerHeartbeatStore({
  client,
  prefix = process.env.WORKER_HEARTBEAT_KEY_PREFIX || DEFAULT_PREFIX,
} = {}) {
  if (!client) throw new Error("Redis client worker heartbeat wajib diberikan.");
  const normalizedPrefix = String(prefix || DEFAULT_PREFIX)
    .trim()
    .replace(/:+$/, "");

  function roleKey(role) {
    return `${normalizedPrefix}:${normalizeRole(role)}`;
  }

  return {
    mode: "redis",
    async beat({ role, token, ttlMs, nowMs = Date.now() }) {
      await ensureRedisConnected(client);
      const expiresAt = nowMs + ttlMs;
      await client.eval(
        RECORD_HEARTBEAT_SCRIPT,
        1,
        roleKey(role),
        String(expiresAt),
        token,
        String(ttlMs * 2),
      );
    },
    async inspect({ role, nowMs = Date.now() }) {
      await ensureRedisConnected(client);
      const result = await client.eval(
        INSPECT_HEARTBEAT_SCRIPT,
        1,
        roleKey(role),
        String(nowMs),
      );
      const workerCount = Number(result?.[0]);
      const ttlMs = Number(result?.[1]);
      if (
        !Number.isSafeInteger(workerCount) ||
        workerCount < 0 ||
        !Number.isSafeInteger(ttlMs) ||
        ttlMs < 0
      ) {
        throw new Error("Respons Redis worker heartbeat tidak valid.");
      }
      return {
        worker_count: workerCount,
        workers_available: workerCount > 0,
        ttl_ms: ttlMs,
      };
    },
    async release({ role, token }) {
      await ensureRedisConnected(client);
      await client.eval(
        RELEASE_HEARTBEAT_SCRIPT,
        1,
        roleKey(role),
        token,
      );
    },
    async close() {
      if (client.status === "end") return;
      if (client.status === "wait") {
        client.disconnect();
        return;
      }
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    },
  };
}

function createMemoryWorkerHeartbeatStore({ now = () => Date.now() } = {}) {
  const roles = new Map();

  function activeEntries(role, nowMs) {
    const normalizedRole = normalizeRole(role);
    const entries = roles.get(normalizedRole) || new Map();
    for (const [token, expiresAt] of entries.entries()) {
      if (expiresAt <= nowMs) entries.delete(token);
    }
    if (entries.size === 0) roles.delete(normalizedRole);
    return entries;
  }

  return {
    mode: "memory",
    async beat({ role, token, ttlMs, nowMs = now() }) {
      const normalizedRole = normalizeRole(role);
      const entries = activeEntries(normalizedRole, nowMs);
      entries.set(token, nowMs + ttlMs);
      roles.set(normalizedRole, entries);
    },
    async inspect({ role, nowMs = now() }) {
      const entries = activeEntries(role, nowMs);
      const expirations = [...entries.values()];
      return {
        worker_count: entries.size,
        workers_available: entries.size > 0,
        ttl_ms:
          expirations.length > 0
            ? Math.max(...expirations) - nowMs
            : 0,
      };
    },
    async release({ role, token }) {
      const normalizedRole = normalizeRole(role);
      const entries = roles.get(normalizedRole);
      if (!entries) return;
      entries.delete(token);
      if (entries.size === 0) roles.delete(normalizedRole);
    },
    async close() {
      roles.clear();
    },
  };
}

function createWorkerHeartbeat({
  role,
  store,
  token = crypto.randomUUID(),
  intervalMs = readPositiveIntEnv("WORKER_HEARTBEAT_INTERVAL_MS", 5000),
  ttlMs = readPositiveIntEnv("WORKER_HEARTBEAT_TTL_MS", 15000),
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  logger = systemLogger,
} = {}) {
  const normalizedRole = normalizeRole(role);
  if (!store) throw new Error("Store worker heartbeat wajib diberikan.");
  if (ttlMs <= intervalMs * 2) {
    throw new Error(
      "WORKER_HEARTBEAT_TTL_MS harus lebih besar dari dua kali WORKER_HEARTBEAT_INTERVAL_MS.",
    );
  }

  let started = false;
  let stopping = false;
  let intervalHandle = null;
  let pendingBeat = null;
  let lastFailureLogAt = 0;

  function logFailure(operation, error) {
    const currentTime = now();
    if (currentTime - lastFailureLogAt < 60_000 && lastFailureLogAt !== 0) {
      return;
    }
    lastFailureLogAt = currentTime;
    logger.warn?.(
      {
        event: "worker_heartbeat_failure",
        component: normalizedRole,
        operation,
        err: error,
      },
      "Worker heartbeat gagal; akan dicoba ulang",
    );
  }

  async function beat() {
    if (stopping) return false;
    if (pendingBeat) return pendingBeat;
    pendingBeat = store
      .beat({
        role: normalizedRole,
        token,
        ttlMs,
        nowMs: now(),
      })
      .then(() => true)
      .catch((error) => {
        logFailure("update", error);
        return false;
      })
      .finally(() => {
        pendingBeat = null;
      });
    return pendingBeat;
  }

  async function start() {
    if (started) return;
    started = true;
    stopping = false;
    await beat();
    intervalHandle = setIntervalFn(() => {
      void beat();
    }, intervalMs);
    intervalHandle?.unref?.();
  }

  async function stop() {
    if (!started) return;
    stopping = true;
    if (intervalHandle) {
      clearIntervalFn(intervalHandle);
      intervalHandle = null;
    }
    if (pendingBeat) await pendingBeat;
    try {
      await store.release({ role: normalizedRole, token });
    } catch (error) {
      logFailure("release", error);
    }
    started = false;
  }

  return {
    beat,
    start,
    stop,
  };
}

function createWatermarkWorkerHeartbeat({
  store = createRedisWorkerHeartbeatStore({
    client: createRedisClient(),
  }),
  ...options
} = {}) {
  const heartbeat = createWorkerHeartbeat({
    role: WATERMARK_WORKER_ROLE,
    store,
    ...options,
  });

  return {
    ...heartbeat,
    async stop() {
      await heartbeat.stop();
      await store.close();
    },
  };
}

let sharedHealthStore;

function getWorkerHeartbeatHealthStore() {
  if (!sharedHealthStore) {
    sharedHealthStore = createRedisWorkerHeartbeatStore({
      client: createRedisClient(),
    });
  }
  return sharedHealthStore;
}

async function checkWatermarkWorkerHealth() {
  if (!isWatermarkWorkerHeartbeatEnabled()) {
    return { enabled: false };
  }
  const details = await getWorkerHeartbeatHealthStore().inspect({
    role: WATERMARK_WORKER_ROLE,
  });
  return { enabled: true, ...details };
}

async function closeWorkerHeartbeatHealth() {
  if (!sharedHealthStore) return;
  const store = sharedHealthStore;
  sharedHealthStore = undefined;
  await store.close();
}

module.exports = {
  DEFAULT_PREFIX,
  INSPECT_HEARTBEAT_SCRIPT,
  RECORD_HEARTBEAT_SCRIPT,
  RELEASE_HEARTBEAT_SCRIPT,
  WATERMARK_WORKER_ROLE,
  checkWatermarkWorkerHealth,
  closeWorkerHeartbeatHealth,
  createMemoryWorkerHeartbeatStore,
  createRedisWorkerHeartbeatStore,
  createWatermarkWorkerHeartbeat,
  createWorkerHeartbeat,
  isWatermarkWorkerHeartbeatEnabled,
  resolveWorkerHeartbeatRedisUrl,
};
