const {getReviewDatabase}=require('./reviewDatabase');
const {AppError}=require('../../utils/errors');
const {payloadDigest}=require('./controlReview.contract');
const contract=require('./controlRecovery.contract');

// Only the signed Control transport may call this entry. The new capability is
// off by default; bank-user auth or an observer token never substitutes for it.
async function handle(request,now,transport) {
  if (process.env.SJ_CONTROL_RECOVERY_ENABLED !== 'true') throw new AppError('Pemulihan Control belum diaktifkan.',503);
  const {config,headers,lookup}=transport.verify(request,now,contract.PATH,contract.validateRequest);
  const database=await getReviewDatabase();
  const value=await database.$transaction(async client=>{
    const settings=await client.sj_integration_settings.findFirst();
    if(!settings||settings.review_authority!=='central'||!settings.review_enabled||settings.installation_id!==config.instanceId) {
      throw new AppError('Instansi tidak menerima pemulihan Control.',409);
    }
    await transport.recordNonce(client,{command:{instance_id:config.instanceId},config,headers},now);
    // Do not infer historical ownership from current configuration. Unbound and
    // other-installation rows are outside this endpoint's visible scope.
    const scope={target_binding_json:{path:['installation_id'],equals:config.instanceId}};
    if(lookup.operation==='list') {
      const rows=await client.sj_sync_outbox.findMany({where:{...scope,
        ...(lookup.state?{state:lookup.state}:{}),...(lookup.cursor?{id:{gt:lookup.cursor}}:{})},
        orderBy:{id:'asc'},take:26});
      return {kind:'list',items:rows.slice(0,25).map(row=>contract.metadata(row,settings)),
        next_cursor:rows.length>25?rows[24].id:null,scope:'BOUND_INSTALLATION',total:null};
    }
    if(lookup.operation==='receipt') {
      const rows=await client.$queryRaw`SELECT request_digest,result_json FROM public.sj_control_recovery_receipts
        WHERE request_id=${lookup.request_id}::uuid AND instance_id=${config.instanceId}::uuid
          AND operator_id=${lookup.operator_id}::uuid`;
      if(!rows.length)return {kind:'receipt',state:'NOT_RECORDED',result:null};
      if(rows[0].request_digest!==lookup.request_digest)throw new AppError('Identitas permintaan berbeda.',409);
      return {kind:'receipt',state:'RECORDED',result:rows[0].result_json};
    }
    if(lookup.operation==='detail') {
      const row=await client.sj_sync_outbox.findFirst({where:{...scope,id:lookup.job_id}});
      if(!row)throw new AppError('Pengiriman tidak ditemukan dalam cakupan akses.',404);
      return {kind:'detail',item:contract.metadata(row,settings)};
    }
    const digest=payloadDigest(lookup);
    // Lock receipt before job: concurrent retransmissions with a fresh transport
    // nonce replay the same committed result instead of scheduling twice.
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sj:recovery:${lookup.request_id}`},0))`;
    const receipts=await client.$queryRaw`SELECT instance_id::text,operator_id::text,request_digest,result_json
      FROM public.sj_control_recovery_receipts WHERE request_id=${lookup.request_id}::uuid`;
    if(receipts.length) {
      const receipt=receipts[0];
      if(receipt.instance_id!==config.instanceId||receipt.operator_id!==lookup.operator_id||receipt.request_digest!==digest) {
        throw new AppError('Permintaan pemulihan sudah dipakai untuk tindakan berbeda.',409);
      }
      return {kind:'receipt',state:'RECORDED',result:receipt.result_json};
    }
    const rows=await client.$queryRaw`SELECT * FROM public.sj_sync_outbox WHERE id=${lookup.job_id}
      AND target_binding_json->>'installation_id'=${config.instanceId} FOR UPDATE`;
    const row=rows[0];
    if(!row)throw new AppError('Pengiriman sudah berubah atau tidak dapat diulangi.',409);
    if(contract.revision(row)!==lookup.expected_revision)throw new AppError('Pengiriman sudah berubah. Muat ulang sebelum mencoba lagi.',409);
    const block=contract.retryBlock(row,settings);
    if(block)throw new AppError('Pengiriman belum dapat diulangi. Periksa kembali tujuan dan statusnya.',409);
    const scheduledAt=new Date();
    const changed=await client.sj_sync_outbox.updateMany({where:{id:row.id,state:row.state,
      attempt_count:row.attempt_count,available_at:row.available_at,locked_at:null,locked_by:null},
      data:{state:'QUEUED',available_at:scheduledAt,last_error_code:null,locked_at:null,locked_by:null}});
    if(changed.count!==1)throw new AppError('Pengiriman sudah berubah. Muat ulang sebelum mencoba lagi.',409);
    // Existing lifecycle state describes delivery failure, not an undone bank
    // decision. Scheduling never changes the content decision or public state.
    await client.sj_control_change_requests.updateMany({where:{sync_event_id:row.event_id,state:'FAILED'},data:{state:'APPLIED',failure_code:null}});
    const result={request_id:lookup.request_id,request_digest:digest,job_id:row.id,
      state:'SCHEDULED',scheduled_at:scheduledAt.toISOString(),previous_revision:lookup.expected_revision};
    await client.$executeRaw`INSERT INTO public.sj_control_recovery_receipts
      (request_id,instance_id,operator_id,job_id,request_digest,reason,result_json)
      VALUES(${lookup.request_id}::uuid,${config.instanceId}::uuid,${lookup.operator_id}::uuid,
        ${row.id},${digest},${lookup.reason.trim()},${JSON.stringify(result)}::jsonb)`;
    return {kind:'receipt',state:'RECORDED',result};
  });
  return transport.sign({contract_version:1,instance_id:config.instanceId,operator_id:lookup.operator_id,
    request_nonce:headers.nonce,request_digest:payloadDigest(lookup),checked_at:new Date().toISOString(),value},config,new Date(),contract.PATH);
}
module.exports={handle};
