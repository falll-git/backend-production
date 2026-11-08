const crypto = require("node:crypto");

const PROTOCOL = "RUWANG-CONTROL-V1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBJECT_PATTERN = /^[a-z0-9][a-z0-9_-]{1,39}:[^\r\n]{1,180}$/;
const OPERATOR_PATTERN = /^ruwang-control:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RESULT_PATTERN = /^[A-Z][A-Z0-9_]{1,79}$/;
const RESOURCE_KINDS = new Set(["publication", "profile", "contact", "change_request"]);
const DECISIONS = new Set(["approve", "request_revision", "reject"]);

function normalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON menolak angka non-finite.");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined || typeof item === "function" || typeof item === "symbol") throw new TypeError("Canonical JSON menolak nilai yang tidak dapat diserialisasi.");
      result[key] = normalize(item);
    }
    return result;
  }
  throw new TypeError("Canonical JSON hanya menerima nilai JSON.");
}

function canonicalJson(value) { return JSON.stringify(normalize(value)); }
function payloadDigest(value) { return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function signingMessage({ method, path, timestamp, nonce, contentSha256 }) {
  const fields = [method, path, timestamp, nonce, contentSha256];
  if (fields.some(value => !value || /[\r\n]/.test(String(value)))) throw new TypeError("Field signature tidak valid.");
  const normalizedPath = String(path);
  const digest = String(contentSha256).toLowerCase();
  if (!normalizedPath.startsWith("/") || normalizedPath.includes("?") || normalizedPath.includes("#") || !SHA256_PATTERN.test(digest)) throw new TypeError("Signature transport tidak valid.");
  return [PROTOCOL, String(method).toUpperCase(), normalizedPath, String(timestamp), String(nonce), digest].join("\n");
}
function signTransport(message, privateKey) { return crypto.sign(null, Buffer.from(message, "utf8"), privateKey).toString("base64url"); }
function verifyTransport(message, signature, publicKey) {
  try { return crypto.verify(null, Buffer.from(message, "utf8"), publicKey, Buffer.from(signature, "base64url")); } catch { return false; }
}
function isExactKeys(value, allowed) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
}
function validateCommand(value) {
  const errors = [];
  const keys = ["contract_version", "command_id", "instance_id", "actor_subject", "audience", "resource", "decision", "contributor_subjects", "reason", "expected_version", "expected_checksum", "issued_at", "expires_at"];
  if (!isExactKeys(value, keys)) errors.push("COMMAND_SHAPE_INVALID");
  if (value?.contract_version !== 1 || !UUID_PATTERN.test(value?.command_id || "") || !UUID_PATTERN.test(value?.instance_id || "")) errors.push("COMMAND_ID_INVALID");
  if (!OPERATOR_PATTERN.test(value?.actor_subject || "") || typeof value?.audience !== "string" || value.audience.length < 1 || value.audience.length > 150) errors.push("COMMAND_IDENTITY_INVALID");
  if (!isExactKeys(value?.resource, ["kind", "id"]) || !RESOURCE_KINDS.has(value?.resource?.kind) || !UUID_PATTERN.test(value?.resource?.id || "")) errors.push("COMMAND_RESOURCE_INVALID");
  if (!DECISIONS.has(value?.decision)) errors.push("COMMAND_DECISION_INVALID");
  if (!Array.isArray(value?.contributor_subjects) || value.contributor_subjects.length < 1 || value.contributor_subjects.length > 20 || value.contributor_subjects.some(item => typeof item !== "string" || !SUBJECT_PATTERN.test(item)) || new Set(value.contributor_subjects).size !== value.contributor_subjects.length) errors.push("COMMAND_CONTRIBUTORS_INVALID");
  if (!Number.isInteger(value?.expected_version) || value.expected_version < 0 || !SHA256_PATTERN.test(value?.expected_checksum || "")) errors.push("COMMAND_VERSION_INVALID");
  if (!Number.isFinite(Date.parse(value?.issued_at || "")) || !Number.isFinite(Date.parse(value?.expires_at || ""))) errors.push("COMMAND_TIME_INVALID");
  const lifecycleDecision = value?.resource?.kind === "change_request";
  if ((value?.decision === "request_revision" || value?.decision === "reject" || lifecycleDecision) &&
      (typeof value?.reason !== "string" || !value.reason.trim() || value.reason.length > 2000)) errors.push("COMMAND_REASON_REQUIRED");
  if (value?.decision === "approve" && !lifecycleDecision && Object.hasOwn(value || {}, "reason")) errors.push("COMMAND_REASON_FORBIDDEN");
  if (value?.decision === "reject" && !lifecycleDecision) errors.push("COMMAND_DECISION_INVALID");
  return { valid: errors.length === 0, errors };
}
function validateAcknowledgment(value) {
  const keys = ["contract_version", "acknowledgment_id", "command_id", "command_digest", "instance_id", "resource", "status", "result_code", "observed_version", "observed_checksum", "processed_at"];
  return Boolean(isExactKeys(value, keys) && value.contract_version === 1 && UUID_PATTERN.test(value.acknowledgment_id || "") && UUID_PATTERN.test(value.command_id || "") && SHA256_PATTERN.test(value.command_digest || "") && UUID_PATTERN.test(value.instance_id || "") && isExactKeys(value.resource, ["kind", "id"]) && RESOURCE_KINDS.has(value.resource?.kind) && UUID_PATTERN.test(value.resource?.id || "") && ["APPLIED", "REJECTED"].includes(value.status) && RESULT_PATTERN.test(value.result_code || "") && Number.isInteger(value.observed_version) && value.observed_version >= 0 && SHA256_PATTERN.test(value.observed_checksum || "") && Number.isFinite(Date.parse(value.processed_at || "")));
}
function validateResultLookup(value) {
  return Boolean(isExactKeys(value, ["contract_version", "command_id", "command_digest", "instance_id", "audience", "resource"]) &&
    value.contract_version === 1 && UUID_PATTERN.test(value.command_id || "") && SHA256_PATTERN.test(value.command_digest || "") &&
    UUID_PATTERN.test(value.instance_id || "") && typeof value.audience === "string" && value.audience.length > 0 && value.audience.length <= 150 &&
    isExactKeys(value.resource, ["kind", "id"]) && RESOURCE_KINDS.has(value.resource?.kind) && UUID_PATTERN.test(value.resource?.id || ""));
}
const headerNames = Object.freeze({ instanceId: "x-rc-instance-id", keyId: "x-rc-key-id", timestamp: "x-rc-timestamp", nonce: "x-rc-nonce", contentSha256: "x-rc-content-sha256", signature: "x-rc-signature", acknowledgmentKeyId: "x-rc-ack-key-id", acknowledgmentTimestamp: "x-rc-ack-timestamp", acknowledgmentNonce: "x-rc-ack-nonce", acknowledgmentContentSha256: "x-rc-ack-content-sha256", acknowledgmentSignature: "x-rc-ack-signature" });

module.exports = { PROTOCOL, UUID_PATTERN, canonicalJson, payloadDigest, signingMessage, signTransport, verifyTransport, validateCommand, validateAcknowledgment, validateResultLookup, headerNames };
