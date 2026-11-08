const crypto = require("node:crypto");
const { UUID_PATTERN, canonicalJson, payloadDigest, signingMessage, signTransport, verifyTransport, headerNames } = require("./controlReview.contract");

const PATH = "/api/v1/internal/ruwang-control/sj-monitoring/snapshot";
const EMPTY_DIGEST = crypto.createHash("sha256").update(Buffer.alloc(0)).digest("hex");
const STATUS = new Set(["healthy", "degraded", "unknown"]);
const SERVICE_KEYS = new Set(["frontend", "api", "readiness", "worker", "pipeline"]);
const QUEUE_KEYS = new Set(["review", "outbox", "media"]);
const CODE = /^[A-Z][A-Z0-9_]{1,79}$/;

function exact(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));
}
function itemValid(item, keys, queue = false) {
  if (!exact(item, queue ? ["key", "status", "depth", "detail_code"] : ["key", "status", "detail_code"])) return false;
  if (!keys.has(item.key) || !STATUS.has(item.status)) return false;
  if (item.detail_code !== undefined && !CODE.test(item.detail_code)) return false;
  return !queue || item.depth === undefined || Number.isSafeInteger(item.depth) && item.depth >= 0;
}
function validateSnapshot(value) {
  if (!exact(value, ["contract_version", "instance_id", "source_kind", "observed_at", "services", "queues"]) ||
      value.contract_version !== 1 || !UUID_PATTERN.test(value.instance_id || "") || value.source_kind !== "ruwang" ||
      !Number.isFinite(Date.parse(value.observed_at || "")) || !Array.isArray(value.services) || !Array.isArray(value.queues) ||
      value.services.length > 5 || value.queues.length > 3 || value.services.some(item => !itemValid(item, SERVICE_KEYS)) ||
      value.queues.some(item => !itemValid(item, QUEUE_KEYS, true)) ||
      new Set(value.services.map(item => item.key)).size !== value.services.length || new Set(value.queues.map(item => item.key)).size !== value.queues.length) return false;
  return true;
}

module.exports = { PATH, EMPTY_DIGEST, canonicalJson, payloadDigest, signingMessage, signTransport, verifyTransport, headerNames, validateSnapshot };
