const crypto = require("crypto");
const Redis = require("ioredis");
const { attachEmitterErrorLogging } = require("./infrastructure-events");

const MAX_MEMORY_KEYS = 5000;
const DEFAULT_NAMESPACE = "ruwang-arsip:rate-limit";
const LOCAL_KEY_SECRET = crypto.randomBytes(32).toString("hex");

const INCREMENT_WITH_TTL_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if current == 1 or ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {current, ttl}
`;

function readPositiveIntEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function resolveRateLimitStoreMode(env = process.env) {
  const configured = String(env.RATE_LIMIT_STORE || "")
    .trim()
    .toLowerCase();
  if (configured) return configured;
  return env.NODE_ENV === "production" ? "redis" : "memory";
}

function pruneMemoryEntries(entries, now, maxKeys = MAX_MEMORY_KEYS) {
  if (entries.size <= maxKeys) return;

  for (const [key, entry] of entries.entries()) {
    if (entry.resetAt <= now) entries.delete(key);
  }

  while (entries.size > maxKeys) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey === undefined) break;
    entries.delete(oldestKey);
  }
}

function createMemoryRateLimitStore({
  now = () => Date.now(),
  maxKeys = MAX_MEMORY_KEYS,
} = {}) {
  const entries = new Map();

  return {
    mode: "memory",
    async consume({ key, windowMs }) {
      const currentTime = now();
      let entry = entries.get(key);
      if (!entry || entry.resetAt <= currentTime) {
        entry = { count: 0, resetAt: currentTime + windowMs };
      }

      entry.count += 1;
      entries.set(key, entry);
      pruneMemoryEntries(entries, currentTime, maxKeys);

      return { count: entry.count, resetAt: entry.resetAt };
    },
    async ping() {
      return true;
    },
    async close() {
      entries.clear();
    },
  };
}

function createRedisClient({ url } = {}) {
  const resolvedUrl =
    url || process.env.RATE_LIMIT_REDIS_URL || process.env.REDIS_URL;
  if (!resolvedUrl) {
    throw new Error("RATE_LIMIT_REDIS_URL atau REDIS_URL belum dikonfigurasi.");
  }

  const client = new Redis(resolvedUrl, {
    lazyConnect: true,
    connectTimeout: readPositiveIntEnv(
      "RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS",
      5000,
    ),
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy(attempt) {
      return Math.min(attempt * 250, 3000);
    },
  });
  attachEmitterErrorLogging(client, {
    component: "rate_limit_redis",
    event: "redis_connection_error",
  });
  return client;
}

async function ensureRedisConnected(client) {
  if (client.status === "wait") await client.connect();
  if (client.status === "end") {
    throw new Error("Koneksi Redis rate limit sudah ditutup.");
  }
}

function hashRateLimitKey(rawKey, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(String(rawKey))
    .digest("hex");
}

function createRedisRateLimitStore({
  client,
  keySecret = process.env.RATE_LIMIT_KEY_SECRET || LOCAL_KEY_SECRET,
  namespace = process.env.RATE_LIMIT_KEY_PREFIX || DEFAULT_NAMESPACE,
} = {}) {
  if (!client) throw new Error("Redis client wajib diberikan.");
  if (!keySecret) throw new Error("Rate limit key secret wajib diberikan.");

  const normalizedNamespace = String(namespace || DEFAULT_NAMESPACE)
    .trim()
    .replace(/:+$/, "");

  return {
    mode: "redis",
    async consume({ key, windowMs }) {
      await ensureRedisConnected(client);
      const digest = hashRateLimitKey(key, keySecret);
      const redisKey = `${normalizedNamespace}:${digest}`;
      const result = await client.eval(
        INCREMENT_WITH_TTL_SCRIPT,
        1,
        redisKey,
        String(windowMs),
      );
      const count = Number(result?.[0]);
      const ttlMs = Number(result?.[1]);
      if (!Number.isFinite(count) || !Number.isFinite(ttlMs) || ttlMs < 0) {
        throw new Error("Respons Redis rate limit tidak valid.");
      }

      return { count, resetAt: Date.now() + ttlMs };
    },
    async ping() {
      await ensureRedisConnected(client);
      const response = await client.ping();
      if (response !== "PONG") throw new Error("Redis tidak merespons PONG.");
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

let sharedStore;

function getRateLimitStore() {
  if (sharedStore) return sharedStore;

  const mode = resolveRateLimitStoreMode();
  if (mode === "memory") {
    sharedStore = createMemoryRateLimitStore();
    return sharedStore;
  }
  if (mode !== "redis") {
    throw new Error(`RATE_LIMIT_STORE tidak didukung: ${mode}`);
  }

  sharedStore = createRedisRateLimitStore({ client: createRedisClient() });
  return sharedStore;
}

function isRateLimitRedisEnabled() {
  return resolveRateLimitStoreMode() === "redis";
}

async function checkRateLimitStoreHealth() {
  const store = getRateLimitStore();
  await store.ping();
  return { mode: store.mode };
}

async function assertRateLimitStoreReady() {
  if (!isRateLimitRedisEnabled()) return { mode: "memory" };
  return checkRateLimitStoreHealth();
}

async function closeRateLimitStore() {
  if (!sharedStore) return;
  const store = sharedStore;
  sharedStore = undefined;
  await store.close();
}

module.exports = {
  INCREMENT_WITH_TTL_SCRIPT,
  assertRateLimitStoreReady,
  checkRateLimitStoreHealth,
  closeRateLimitStore,
  createMemoryRateLimitStore,
  createRedisRateLimitStore,
  getRateLimitStore,
  hashRateLimitKey,
  isRateLimitRedisEnabled,
  resolveRateLimitStoreMode,
};
