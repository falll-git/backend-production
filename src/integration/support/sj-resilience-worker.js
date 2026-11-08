// Persistent child used only by the ownership-guarded RA-SJ-04 harness.
const {assertLive}=require('./sj-disposable-guard');
let prisma,service,proof,heldRelease;
process.once('disconnect',()=>process.exit());
process.on('message',async m=>{
  try{
    if(m.type==='init'){
      proof=m.proof;await assertLive(proof,process.env,m.token);
      const original=global.fetch;
      global.fetch=async(input,options)=>{
        const url=new URL(typeof input==='string'?input:input.url);
        if(url.origin!==proof.integrationOrigin)throw Error('TEST_EGRESS_REJECTED');
        const response=await original(input,{...options,redirect:'error'});
        const heldPath = m.holdResponse === 'media' ? /\/upload-sessions\/[^/]+\/complete$/.test(url.pathname) : url.pathname==='/v1/ingest/events';
        if(heldPath&&m.holdResponse){
          process.send({type:'remote-response'});
          await new Promise(r=>{heldRelease=r;});
        }
        return response;
      };
      prisma=require('../../config/prisma');service=require('../../modules/seputar-jaminan/syncWorker.service');
      process.send({type:'ready'});return;
    }
    if(m.type==='release'){heldRelease?.();heldRelease=null;return;}
    let result;
    if(m.type==='claim')result=await service.claimOutbox('isolated-'+process.pid,m.limit||1);
    else if(m.type==='deliver'){
      const row={...m.row,created_at:new Date(m.row.created_at)};
      const settings=await prisma.sj_integration_settings.findFirst();
      try{await service.deliverOutbox(row,settings);result={delivered:true};}
      catch(error){await service.failOutbox(row,error);result={failed:true,code:service.safeLocalErrorCode(error)};}
      if(m.holdAfterCommit){process.send({type:'local-commit'});await new Promise(()=>{});}
    }else if(m.type==='fail'){
      await service.failOutbox(m.row,new TypeError('isolated explicit local failure'));result=true;
    }else if(m.type==='batch')result=await service.processOutboxBatch(await prisma.sj_integration_settings.findFirst(),'batch-'+process.pid,m.limit||1);
    else if(m.type==='media-batch')result=await service.processMediaBatch(await prisma.sj_integration_settings.findFirst(),20);
    else if(m.type==='recover')result=await require('../../modules/seputar-jaminan/outboxLease').recoverExpired();
    else if(m.type==='clock-fault'){
      // Explicit negative-test clock fault; never changes business/ACK states.
      result=await prisma.sj_sync_outbox.updateMany({where:{id:m.id},data:m.field==='available_at'?{available_at:new Date(0)}:{locked_at:new Date(0)}});
    }else if(m.type==='close'){await prisma.$disconnect();process.send({type:'closed'});process.disconnect();return;}
    else throw Error('UNKNOWN_TEST_OPERATION');
    process.send({type:'result',requestId:m.requestId,result});
  }catch(error){process.send({type:'result',requestId:m.requestId,error: error.code||error.name});}
});
