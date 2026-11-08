// Actual SJ reconciliation-service.ts response, not a public observation DTO.
const keys=['request_id','run_id','status','count_checked','count_mismatch','mismatches'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
exports.validateReconciliationResponse=(value,manifest,expectedRunId)=>{
  const reject=()=>{const error=new Error('Hasil pemeriksaan kesesuaian belum valid.');error.code='RECONCILIATION_RESPONSE_INVALID';throw error;};
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(k=>!keys.includes(k)))reject();
  if(!uuid.test(value.run_id||'')||(expectedRunId&&value.run_id!==expectedRunId)||typeof value.request_id!=='string'||!value.request_id
    ||!['PENDING','RUNNING','COMPLETED','FAILED'].includes(value.status)||!Array.isArray(manifest?.items)||!Array.isArray(value.mismatches))reject();
  if(!Number.isSafeInteger(value.count_checked)||value.count_checked<0||value.count_checked>manifest.items.length
    ||!Number.isSafeInteger(value.count_mismatch)||value.count_mismatch!==value.mismatches.length
    ||(value.status==='COMPLETED'&&value.count_checked!==manifest.items.length))reject();
  const ids=new Set(manifest.items.map(i=>i.aggregate_id)),seen=new Set();
  for(const item of value.mismatches){
    if(!item||typeof item!=='object'||Object.keys(item).some(k=>!['aggregate_id','code','recommended_action'].includes(k))
      ||!ids.has(item.aggregate_id)||seen.has(item.aggregate_id)||!/^([A-Z][A-Z0-9_]{0,99})$/.test(item.code||'')
      ||!['CONTACT_OPERATIONS','RESEND_SNAPSHOT','SEND_UNPUBLISH'].includes(item.recommended_action))reject();
    seen.add(item.aggregate_id);
  }
  return value;
};
