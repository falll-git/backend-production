import { createHash } from "node:crypto";

function normalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON menolak angka non-finite.");
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }

  if (typeof value === "object") {
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined || typeof item === "function" || typeof item === "symbol") {
        throw new TypeError("Canonical JSON menolak nilai yang tidak dapat diserialisasi.");
      }
      normalized[key] = normalize(item);
    }
    return normalized;
  }

  throw new TypeError("Canonical JSON hanya menerima nilai JSON.");
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function sha256Hex(value) {
  const bytes =
    typeof value === "string" || Buffer.isBuffer(value)
      ? value
      : canonicalJson(value);
  return createHash("sha256").update(bytes).digest("hex");
}

export function payloadChecksum(payload) {
  return sha256Hex(canonicalJson(payload));
}
