import { sign, verify } from "node:crypto";
import { sha256Hex } from "./canonical-json.mjs";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function requireText(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(label + " wajib berupa teks.");
  }
  if (/[\r\n]/.test(value)) {
    throw new TypeError(label + " tidak boleh memuat baris baru.");
  }
  return value;
}

export function createContentSha256(body) {
  return sha256Hex(body);
}

export function createSigningMessage({
  method,
  path,
  timestamp,
  nonce,
  contentSha256,
}) {
  const normalizedMethod = requireText(method, "method").toUpperCase();
  const normalizedPath = requireText(path, "path");
  const normalizedTimestamp = requireText(timestamp, "timestamp");
  const normalizedNonce = requireText(nonce, "nonce");
  const normalizedDigest = requireText(contentSha256, "contentSha256").toLowerCase();

  if (!normalizedPath.startsWith("/") || normalizedPath.includes("?") || normalizedPath.includes("#")) {
    throw new TypeError("path signing V1 harus absolute-path tanpa query atau fragment.");
  }
  if (!SHA256_PATTERN.test(normalizedDigest)) {
    throw new TypeError("contentSha256 harus SHA-256 hex lowercase.");
  }

  return [
    "SJ-V1",
    normalizedMethod,
    normalizedPath,
    normalizedTimestamp,
    normalizedNonce,
    normalizedDigest,
  ].join("\n");
}

export function signIntegrationMessage(message, privateKey) {
  return sign(null, Buffer.from(message, "utf8"), privateKey).toString("base64url");
}

export function verifyIntegrationMessage(message, signature, publicKey) {
  if (typeof signature !== "string" || signature.length === 0) {
    return false;
  }
  try {
    return verify(
      null,
      Buffer.from(message, "utf8"),
      publicKey,
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}
