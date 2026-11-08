const { UUID_PATTERN, payloadDigest } = require('./controlReview.contract');
const { outboxTargetBlock } = require('./outboxTarget');

const PATH = '/api/v1/internal/ruwang-control/sj-review/recovery';
const HASH = /^[a-f0-9]{64}$/;
const STATES = ['QUEUED','SENDING','ACKNOWLEDGED','RETRYING','FAILED','QUARANTINED'];
const RETRYABLE = ['FAILED','QUARANTINED','RETRYING'];
const uuid = value => typeof value === 'string' && UUID_PATTERN.test(value);
const hash = value => typeof value === 'string' && HASH.test(value);
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
}
function validateRequest(value) {
  const common = ['contract_version','instance_id','audience','operator_id','operation'];
  if (!value || !['list','detail','retry','receipt'].includes(value.operation)) return false;
  const extra = value.operation === 'list' ? ['cursor','state']
    : value.operation === 'detail' ? ['job_id']
    : value.operation === 'receipt' ? ['request_id','request_digest']
    : ['job_id','request_id','expected_revision','reason'];
  if (!exact(value,[...common,...extra]) || value.contract_version !== 1
      || !uuid(value.instance_id) || !uuid(value.operator_id)
      || typeof value.audience !== 'string' || !value.audience || value.audience.length > 200) return false;
  if (value.operation === 'list') return (value.cursor === null || uuid(value.cursor))
    && (value.state === null || STATES.includes(value.state));
  if (value.operation === 'detail') return uuid(value.job_id);
  if (!uuid(value.request_id)) return false;
  if (value.operation === 'receipt') return hash(value.request_digest);
  return uuid(value.job_id) && hash(value.expected_revision)
    && typeof value.reason === 'string' && value.reason.trim().length >= 5 && value.reason.length <= 500
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value.reason);
}
const iso = value => value ? new Date(value).toISOString() : null;
function revision(row) {
  return payloadDigest({ id:row.id, event_id:row.event_id, state:row.state, attempts:row.attempt_count,
    available_at:iso(row.available_at), locked_at:iso(row.locked_at), locked_by:row.locked_by,
    error:row.last_error_code, acknowledged_at:iso(row.acknowledged_at), target:row.target_binding_json });
}
function retryBlock(row, settings, env=process.env) {
  const target=outboxTargetBlock(row,settings,env);
  if (target) return target.code;
  if (!settings?.sync_enabled && row.event_type !== 'CONTROL_REVIEW_SNAPSHOT') return 'DELIVERY_DISABLED';
  if (!RETRYABLE.includes(row.state)) return 'JOB_NOT_RETRYABLE';
  if (row.locked_at || row.locked_by) return 'JOB_OWNED';
  return null;
}
function metadata(row,settings,env=process.env) {
  const block=retryBlock(row,settings,env);
  return { id:row.id,event_id:row.event_id,aggregate_type:row.aggregate_type,aggregate_id:row.aggregate_id,
    aggregate_version:row.aggregate_version,event_type:row.event_type,state:row.state,attempt_count:row.attempt_count,
    available_at:iso(row.available_at),created_at:iso(row.created_at),acknowledged_at:iso(row.acknowledged_at),
    revision:revision(row),retry:{allowed:block===null,reason:block} };
}
module.exports={PATH,STATES,validateRequest,revision,retryBlock,metadata};
