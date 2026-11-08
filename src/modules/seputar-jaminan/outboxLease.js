const crypto=require('node:crypto');
const prisma=require('../../config/prisma');
const MAX_ATTEMPTS=8;
function leaseMs(){
  const value=Number(process.env.SJ_OUTBOX_LEASE_MS||300000);
  if(!Number.isInteger(value)||value<1000||value>3600000)throw Error('SJ_OUTBOX_LEASE_MS_INVALID');
  return value;
}
async function owns(client,row){
  const found=await client.$queryRaw`SELECT id FROM public.sj_sync_outbox
    WHERE id=${row.id}::text AND state='SENDING' AND locked_by=${row.locked_by}::text
    AND attempt_count=${row.attempt_count} AND locked_at > clock_timestamp()-(${leaseMs()} * interval '1 millisecond')
    FOR UPDATE`;
  return found.length===1;
}
async function renew(row){
  return (await prisma.$executeRaw`UPDATE public.sj_sync_outbox SET locked_at=clock_timestamp()
    WHERE id=${row.id}::text AND state='SENDING' AND locked_by=${row.locked_by}::text
    AND attempt_count=${row.attempt_count} AND locked_at > clock_timestamp()-(${leaseMs()} * interval '1 millisecond')`)===1;
}
async function updateAggregateFailure(client,row,state,code){
  // Only the delivery projection for this exact aggregate version may change.
  if(row.aggregate_type==='PUBLICATION'){
    await client.sj_publications.updateMany({where:{id:row.aggregate_id,aggregate_version:row.aggregate_version},data:{sync_state:state,last_sync_error_code:code}});
  }else if(row.aggregate_type==='WHATSAPP_CONTACT'){
    await client.sj_whatsapp_contacts.updateMany({where:{id:row.aggregate_id,aggregate_version:row.aggregate_version},data:{sync_state:state}});
  }else if(row.aggregate_type==='BPRS_PROFILE'){
    // Bank profile is a singleton; its event aggregate ID is the institution ID.
    await client.sj_public_profiles.updateMany({where:{singleton_key:'BPRS_PUBLIC_PROFILE',aggregate_version:row.aggregate_version},data:{sync_state:state}});
  }
}
async function recoverExpired(limit=100){
  return prisma.$transaction(async client=>{
    const rows=await client.$queryRaw`SELECT * FROM public.sj_sync_outbox WHERE state='SENDING'
      AND (locked_at IS NULL OR locked_at <= clock_timestamp()-(${leaseMs()} * interval '1 millisecond'))
      ORDER BY locked_at NULLS FIRST,id FOR UPDATE SKIP LOCKED LIMIT ${limit}`;
    for(const row of rows){
      const exhausted=row.attempt_count>=MAX_ATTEMPTS;
      if(row.attempt_count>0)await client.sj_sync_attempts.createMany({data:[{outbox_id:row.id,attempt_number:row.attempt_count,
        finished_at:new Date(),result:exhausted?'PERMANENT_ERROR':'RETRYABLE_ERROR',error_code:'WORKER_LEASE_EXPIRED'}],skipDuplicates:true});
      await client.sj_sync_outbox.update({where:{id:row.id},data:{state:exhausted?'FAILED':'RETRYING',locked_at:null,locked_by:null,
        available_at:new Date(),last_error_code:'WORKER_LEASE_EXPIRED'}});
      if(exhausted){
        await updateAggregateFailure(client,row,'FAILED','WORKER_LEASE_EXPIRED');
        await client.sj_control_change_requests.updateMany({where:{sync_event_id:row.event_id,state:'APPLIED'},data:{state:'FAILED',failure_code:'WORKER_LEASE_EXPIRED'}});
      }
    }
    return rows.length;
  });
}
async function claim(workerId,limit){
  const token=String(workerId).slice(0,80)+':'+crypto.randomUUID();
  return prisma.$queryRaw`WITH candidates AS (
    SELECT id FROM public.sj_sync_outbox current
    WHERE state IN ('QUEUED','RETRYING') AND available_at<=clock_timestamp() AND locked_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.sj_sync_outbox earlier
      WHERE earlier.aggregate_type=current.aggregate_type AND earlier.aggregate_id=current.aggregate_id
      AND earlier.aggregate_version<current.aggregate_version AND earlier.state<>'ACKNOWLEDGED')
    ORDER BY priority,available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT ${limit}
  ) UPDATE public.sj_sync_outbox target SET state='SENDING',locked_at=clock_timestamp(),locked_by=${token},attempt_count=target.attempt_count+1
    FROM candidates WHERE target.id=candidates.id RETURNING target.*`;
}
module.exports={MAX_ATTEMPTS,leaseMs,owns,renew,recoverExpired,claim,updateAggregateFailure};
