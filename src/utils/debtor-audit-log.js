const prisma = require("../config/prisma");
const { logger } = require("../system/logger");

const OMITTED_KEYS = new Set([
  "password",
  "token",
  "refresh_token",
  "file",
  "files",
  "raw_data",
  "raw",
]);

function compactUndefined(data) {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  );
}

function normalizeJson(value, depth = 0) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return value;
  if (
    typeof value.toJSON === "function" &&
    value.constructor?.name !== "Object"
  ) {
    return value.toJSON();
  }
  if (depth >= 5) return "[MaxDepth]";
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeJson(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (OMITTED_KEYS.has(key)) continue;
    const normalized = normalizeJson(item, depth + 1);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function auditSnapshot(record, fields = []) {
  if (!record) return null;
  if (!fields.length) return normalizeJson(record);

  const snapshot = {};
  for (const field of fields) {
    if (record[field] !== undefined) {
      snapshot[field] = normalizeJson(record[field]);
    }
  }
  return snapshot;
}

function optionalJson(value) {
  if (value === undefined || value === null) return undefined;
  return normalizeJson(value);
}

function requestMetadata(req) {
  if (!req) return {};
  return compactUndefined({
    request_ip: req.ip || req.headers?.["x-forwarded-for"] || null,
    user_agent: req.headers?.["user-agent"] || null,
  });
}

async function recordDebtorActivity(db = prisma, payload = {}) {
  if (!payload.action || !payload.entity_type) return null;

  const created = await db.debtor_activity_logs.create({
    data: compactUndefined({
      actor_id: payload.actor_id || null,
      action: payload.action,
      source: payload.source || "MANUAL",
      entity_type: payload.entity_type,
      entity_id: payload.entity_id || null,
      debtor_id: payload.debtor_id || null,
      contract_id: payload.contract_id || null,
      import_job_id: payload.import_job_id || null,
      ideb_upload_id: payload.ideb_upload_id || null,
      document_id: payload.document_id || null,
      marketing_activity_id: payload.marketing_activity_id || null,
      warning_letter_id: payload.warning_letter_id || null,
      title: payload.title || null,
      before_data: optionalJson(payload.before_data),
      after_data: optionalJson(payload.after_data),
      metadata: optionalJson(payload.metadata),
      request_ip: payload.request_ip || null,
      user_agent: payload.user_agent || null,
    }),
  });

  return created;
}

async function safeRecordDebtorActivity(db = prisma, payload = {}) {
  try {
    return await recordDebtorActivity(db, payload);
  } catch (error) {
    logger.error(
      {
        event: "debtor_audit_record_failed",
        component: "debtor_audit",
        action: payload.action,
        entity_type: payload.entity_type,
        entity_id: payload.entity_id,
        err: error,
      },
      "Debtor audit record failed",
    );
    return null;
  }
}

module.exports = {
  auditSnapshot,
  requestMetadata,
  safeRecordDebtorActivity,
};
