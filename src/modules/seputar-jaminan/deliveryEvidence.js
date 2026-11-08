const {UUID_PATTERN}=require('./controlReview.contract');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function validateEvidence(value,event,settings,nonce,now=Date.now()){
  if(!exact(value,['contract_version','request_nonce','checked_at','institution_id','installation_id','event_id','aggregate_id','aggregate_version','payload_checksum','projection','reason']))return false;
  if(value.contract_version!==1||value.request_nonce!==nonce||value.institution_id!==settings.institution_id||value.installation_id!==settings.installation_id||
    value.event_id!==event.event_id||value.aggregate_id!==event.aggregate_id||value.aggregate_version!==event.aggregate_version||value.payload_checksum!==event.payload_checksum||
    typeof value.checked_at!=='string'||!Number.isFinite(Date.parse(value.checked_at))||Math.abs(now-Date.parse(value.checked_at))>300000)return false;
  if(value.projection===null)return ['NOT_A_PUBLIC_PAGE','PROJECTION_NOT_FOUND','PROJECTION_LINEAGE_NOT_PROVEN'].includes(value.reason);
  const p=value.projection;
  return value.reason===null&&exact(p,['event_id','version','payload_checksum','visible','scope','reference_code'])&&UUID_PATTERN.test(p.event_id)&&
    Number.isSafeInteger(p.version)&&p.version>0&&hash(p.payload_checksum)&&typeof p.visible==='boolean'&&p.scope==='PUBLIC_READ_PREDICATE'&&
    (p.reference_code===null||typeof p.reference_code==='string'&&/^SJ-[A-Z0-9]{8}$/.test(p.reference_code))&&
    (p.event_id!==event.event_id||(p.version===event.aggregate_version&&p.payload_checksum===event.payload_checksum));
}
async function readEvidenceBody(response, limit=65536){
  if(response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')throw Error('EVIDENCE_CONTENT_TYPE');
  const reader=response.body?.getReader();
  if(!reader)throw Error('EVIDENCE_BODY_MISSING');
  const chunks=[];let size=0;
  try{
    for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit)throw Error('EVIDENCE_BODY_TOO_LARGE');chunks.push(part.value);}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  }finally{await reader.cancel().catch(()=>{});}
}
module.exports={validateEvidence,readEvidenceBody};
