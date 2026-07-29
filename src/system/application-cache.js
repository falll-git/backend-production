const crypto = require("crypto");
const Redis = require("ioredis");
const { logger } = require("./logger");
const { attachEmitterErrorLogging } = require("./infrastructure-events");

const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_PREFIX = "ruwang-arsip:cache";
const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

function readPositiveIntEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readPercentEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : fallback;
}

function isApplicationCacheEnabled(env = process.env) {
  const value = env.APP_CACHE_ENABLED;
  if (value === undefined || value === null || value === "") return false;
  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase(),
  );
}

function stableSerialize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
    .join(",")}}`;
}

function normalizeNamespace(namespace) {
  const normalized = String(namespace || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9:_-]{0,79}$/.test(normalized)) {
    throw new Error("Namespace application cache tidak valid.");
  }
  return normalized;
}

function buildCacheKey({ prefix = DEFAULT_PREFIX, namespace, version, parts }) {
  const normalizedNamespace = normalizeNamespace(namespace);
  const digest = crypto
    .createHash("sha256")
    .update(stableSerialize(parts))
    .digest("hex");
  return `${String(prefix).replace(/:+$/, "")}:${normalizedNamespace}:v${version}:${digest}`;
}

function createRedisClient({ url } = {}) {
  const resolvedUrl =
    url || process.env.APP_CACHE_REDIS_URL || process.env.REDIS_URL;
  if (!resolvedUrl) {
    throw new Error("APP_CACHE_REDIS_URL atau REDIS_URL belum dikonfigurasi.");
  }

  const client = new Redis(resolvedUrl, {
    lazyConnect: true,
    connectTimeout: readPositiveIntEnv("APP_CACHE_CONNECT_TIMEOUT_MS", 1000),
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy(attempt) {
      return Math.min(attempt * 100, 3000);
    },
  });
  attachEmitterErrorLogging(client, {
    component: "application_cache_redis",
    event: "redis_connection_error",
  });
  return client;
}

async function ensureRedisConnected(client) {
  if (client.status === "wait") await client.connect();
  if (client.status === "end") {
    throw new Error("Koneksi Redis application cache sudah ditutup.");
  }
}

function createRedisCacheStore({
  client,
  prefix = process.env.APP_CACHE_KEY_PREFIX || DEFAULT_PREFIX,
} = {}) {
  if (!client) throw new Error("Redis client application cache wajib diberikan.");
  const normalizedPrefix = String(prefix || DEFAULT_PREFIX).replace(/:+$/, "");

  function versionKey(namespace) {
    return `${normalizedPrefix}:${normalizeNamespace(namespace)}:version`;
  }

  return {
    mode: "redis",
    prefix: normalizedPrefix,
    async get(key) {
      await ensureRedisConnected(client);
      return client.get(key);
    },
    async set(key, value, ttlMs) {
      await ensureRedisConnected(client);
      await client.set(key, value, "PX", ttlMs);
    },
    async delete(key) {
      await ensureRedisConnected(client);
      await client.del(key);
    },
    async getVersion(namespace) {
      await ensureRedisConnected(client);
      const version = Number((await client.get(versionKey(namespace))) || 0);
      if (!Number.isSafeInteger(version) || version < 0) {
        throw new Error("Versi namespace application cache tidak valid.");
      }
      return version;
    },
    async bumpVersion(namespace) {
      await ensureRedisConnected(client);
      const version = Number(await client.incr(versionKey(namespace)));
      if (!Number.isSafeInteger(version) || version < 1) {
        throw new Error("Versi namespace application cache tidak valid.");
      }
      return version;
    },
    async acquireLock(key, token, ttlMs) {
      await ensureRedisConnected(client);
      return (await client.set(`${key}:lock`, token, "PX", ttlMs, "NX")) === "OK";
    },
    async releaseLock(key, token) {
      await ensureRedisConnected(client);
      await client.eval(RELEASE_LOCK_SCRIPT, 1, `${key}:lock`, token);
    },
    async ping() {
      await ensureRedisConnected(client);
      const response = await client.ping();
      if (response !== "PONG") throw new Error("Redis cache tidak merespons PONG.");
      return true;
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

function createMemoryCacheStore({ now = () => Date.now() } = {}) {
  const entries = new Map();
  const versions = new Map();
  const locks = new Map();

  function readEntry(key) {
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return null;
    }
    return entry.value;
  }

  return {
    mode: "memory",
    prefix: "test:cache",
    async get(key) {
      return readEntry(key);
    },
    async set(key, value, ttlMs) {
      entries.set(key, { value, expiresAt: now() + ttlMs });
    },
    async delete(key) {
      entries.delete(key);
    },
    async getVersion(namespace) {
      return versions.get(namespace) || 0;
    },
    async bumpVersion(namespace) {
      const next = (versions.get(namespace) || 0) + 1;
      versions.set(namespace, next);
      return next;
    },
    async acquireLock(key, token, ttlMs) {
      const lockKey = `${key}:lock`;
      const existing = locks.get(lockKey);
      if (existing && existing.expiresAt > now()) return false;
      locks.set(lockKey, { token, expiresAt: now() + ttlMs });
      return true;
    },
    async releaseLock(key, token) {
      const lockKey = `${key}:lock`;
      if (locks.get(lockKey)?.token === token) locks.delete(lockKey);
    },
    async ping() {
      return true;
    },
    async close() {
      entries.clear();
      versions.clear();
      locks.clear();
    },
  };
}

function createApplicationCache({
  enabled = isApplicationCacheEnabled(),
  store,
  ttlMs = readPositiveIntEnv("APP_CACHE_TTL_MS", 60_000),
  jitterPercent = readPercentEnv("APP_CACHE_TTL_JITTER_PERCENT", 10),
  maxEntryBytes = readPositiveIntEnv("APP_CACHE_MAX_ENTRY_BYTES", 256 * 1024),
  lockTtlMs = readPositiveIntEnv("APP_CACHE_LOCK_TTL_MS", 5000),
  waitTimeoutMs = readPositiveIntEnv("APP_CACHE_WAIT_TIMEOUT_MS", 1000),
  waitIntervalMs = readPositiveIntEnv("APP_CACHE_WAIT_INTERVAL_MS", 50),
  random = Math.random,
  sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
  now = () => Date.now(),
} = {}) {
  const metrics = {
    bypass: 0,
    hit: 0,
    miss: 0,
    load: 0,
    error: 0,
    skipped_oversize: 0,
    invalidation: 0,
  };
  const inFlight = new Map();
  let lastErrorLogAt = 0;

  function logStoreFailure(operation, error) {
    metrics.error += 1;
    const currentTime = now();
    if (currentTime - lastErrorLogAt < 60_000) return;
    lastErrorLogAt = currentTime;
    logger.warn(
      {
        event: "application_cache_fallback",
        component: "application_cache",
        operation,
        err: error,
      },
      "Application cache unavailable; falling back to database",
    );
  }

  function effectiveTtl() {
    const reduction = Math.floor(ttlMs * (jitterPercent / 100) * random());
    return Math.max(1, ttlMs - reduction);
  }

  function decode(value) {
    const parsed = JSON.parse(value);
    if (parsed?.schema !== CACHE_SCHEMA_VERSION || !("value" in parsed)) {
      throw new Error("Cache envelope tidak valid.");
    }
    return parsed.value;
  }

  async function readCached(key) {
    const raw = await store.get(key);
    if (raw === null || raw === undefined) return { hit: false };
    try {
      return { hit: true, value: decode(raw) };
    } catch {
      await store.delete(key);
      return { hit: false };
    }
  }

  async function loadAndStore({ cacheKey, loader }) {
    metrics.load += 1;
    const value = await loader();
    const encoded = JSON.stringify({ schema: CACHE_SCHEMA_VERSION, value });
    if (Buffer.byteLength(encoded, "utf8") > maxEntryBytes) {
      metrics.skipped_oversize += 1;
      return value;
    }
    try {
      await store.set(cacheKey, encoded, effectiveTtl());
    } catch (error) {
      logStoreFailure("set", error);
    }
    return value;
  }

  async function getOrLoad({ namespace, parts, loader }) {
    if (typeof loader !== "function") throw new Error("Cache loader wajib fungsi.");
    if (!enabled || !store) {
      metrics.bypass += 1;
      return loader();
    }

    let version;
    let cacheKey;
    try {
      version = await store.getVersion(namespace);
      cacheKey = buildCacheKey({
        prefix: store.prefix,
        namespace,
        version,
        parts,
      });
      const cached = await readCached(cacheKey);
      if (cached.hit) {
        metrics.hit += 1;
        return cached.value;
      }
      metrics.miss += 1;
    } catch (error) {
      logStoreFailure("get", error);
      return loader();
    }

    if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

    const promise = (async () => {
      const token = crypto.randomUUID();
      let lockAcquired = false;
      try {
        lockAcquired = await store.acquireLock(cacheKey, token, lockTtlMs);
      } catch (error) {
        logStoreFailure("lock", error);
        return loader();
      }

      if (!lockAcquired) {
        const deadline = now() + waitTimeoutMs;
        while (now() < deadline) {
          await sleep(waitIntervalMs);
          try {
            const cached = await readCached(cacheKey);
            if (cached.hit) {
              metrics.hit += 1;
              return cached.value;
            }
          } catch (error) {
            logStoreFailure("wait", error);
            return loader();
          }
        }
        metrics.load += 1;
        return loader();
      }

      try {
        return await loadAndStore({ cacheKey, loader });
      } finally {
        try {
          await store.releaseLock(cacheKey, token);
        } catch (error) {
          logStoreFailure("unlock", error);
        }
      }
    })().finally(() => {
      inFlight.delete(cacheKey);
    });

    inFlight.set(cacheKey, promise);
    return promise;
  }

  async function invalidate(namespace) {
    if (!enabled || !store) return false;
    try {
      await store.bumpVersion(namespace);
      metrics.invalidation += 1;
      return true;
    } catch (error) {
      logStoreFailure("invalidate", error);
      return false;
    }
  }

  return {
    enabled,
    getOrLoad,
    invalidate,
    metrics() {
      return { ...metrics, in_flight: inFlight.size };
    },
    async ping() {
      if (!enabled || !store) return { enabled: false };
      await store.ping();
      return { enabled: true, mode: store.mode };
    },
    async close() {
      if (store) await store.close();
    },
  };
}

let sharedCache;

function getApplicationCache() {
  if (sharedCache) return sharedCache;
  const enabled = isApplicationCacheEnabled();
  sharedCache = createApplicationCache({
    enabled,
    store: enabled
      ? createRedisCacheStore({ client: createRedisClient() })
      : null,
  });
  return sharedCache;
}

async function checkApplicationCacheHealth() {
  return getApplicationCache().ping();
}

async function closeApplicationCache() {
  if (!sharedCache) return;
  const cache = sharedCache;
  sharedCache = undefined;
  await cache.close();
}

module.exports = {
  CACHE_SCHEMA_VERSION,
  RELEASE_LOCK_SCRIPT,
  buildCacheKey,
  checkApplicationCacheHealth,
  closeApplicationCache,
  createApplicationCache,
  createMemoryCacheStore,
  createRedisCacheStore,
  getApplicationCache,
  isApplicationCacheEnabled,
  stableSerialize,
};
