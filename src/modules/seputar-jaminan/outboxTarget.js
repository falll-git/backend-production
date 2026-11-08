const crypto = require('node:crypto');
const { canonicalJson } = require('./controlReview.contract');
const { controlSnapshotTargetBlock } = require('./controlSnapshotTarget');

function required(value) {
  if (typeof value !== 'string' || !value.trim()) throw Error('OUTBOX_TARGET_CONFIG_INVALID');
  return value.trim();
}
function baseUrl(value) {
  const url = new URL(required(value));
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw Error('OUTBOX_TARGET_CONFIG_INVALID');
  }
  return url.toString().replace(/\/+$/, '');
}
function fingerprint(value, privateKey = false) {
  const key = required(value).replace(/\\n/g, '\n');
  const publicKey = crypto.createPublicKey(privateKey ? crypto.createPrivateKey(key) : key);
  if (publicKey.asymmetricKeyType !== 'ed25519') throw Error('OUTBOX_TARGET_CONFIG_INVALID');
  return crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
}

// Capture when the event is created, never when a legacy job is retried.
// Only public-key fingerprints are persisted; key material stays in configuration.
function captureTarget(eventType, settings, env = process.env) {
  const control = eventType === 'CONTROL_REVIEW_SNAPSHOT';
  return {
    version: 1,
    destination: control ? 'CONTROL_REVIEW' : 'SJ_INGEST',
    institution_id: required(settings?.institution_id),
    installation_id: required(settings?.installation_id),
    base_url: baseUrl(control ? env.SJ_CONTROL_BASE_URL : settings.central_base_url),
    signing_key_id: required(control ? env.SJ_CONTROL_ACK_KEY_ID : settings.key_id),
    signing_key_fingerprint: fingerprint(control ? env.SJ_CONTROL_ACK_PRIVATE_KEY : env.SJ_INTEGRATION_PRIVATE_KEY, true),
    ...(control ? {
      response_key_id: required(env.SJ_CONTROL_KEY_ID),
      response_key_fingerprint: fingerprint(env.SJ_CONTROL_PUBLIC_KEY),
    } : {}),
  };
}

function outboxTargetBlock(row, settings, env = process.env) {
  const legacySnapshotBlock = controlSnapshotTargetBlock(row, settings);
  if (legacySnapshotBlock) return legacySnapshotBlock;
  if (!row.target_binding_json || typeof row.target_binding_json !== 'object' || Array.isArray(row.target_binding_json)) {
    return { code: 'OUTBOX_TARGET_UNBOUND', reason: 'Tujuan asal pengiriman belum tercatat. Kirim ulang tidak tersedia.' };
  }
  let current;
  try { current = captureTarget(row.event_type, settings, env); }
  catch { return { code: 'OUTBOX_TARGET_CONFIG_INVALID', reason: 'Konfigurasi tujuan pengiriman belum lengkap.' }; }
  if (canonicalJson(row.target_binding_json) !== canonicalJson(current)) {
    return { code: 'OUTBOX_TARGET_CHANGED', reason: 'Konfigurasi tujuan berbeda dari saat pengiriman dibuat. Kirim ulang diblokir.' };
  }
  if (row.event_type !== 'CONTROL_REVIEW_SNAPSHOT' && row.payload_json?.institution_id !== current.institution_id) {
    return { code: 'OUTBOX_INSTITUTION_MISMATCH', reason: 'Identitas instansi pada pengiriman tidak sesuai.' };
  }
  return null;
}

module.exports = { captureTarget, outboxTargetBlock };
