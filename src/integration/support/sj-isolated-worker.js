const {assertLive}=require('./sj-disposable-guard');
// A lost harness parent must not leave a worker using this run's resources.
process.once('disconnect',()=>{if(!finished)process.exit(1);});
let finished=false;
process.once('message',async message=>{
  let prisma;
  try {
    await assertLive(message.proof,process.env,message.token);
    // Allow requests only to this run's contract double, including upload URLs.
    const original=global.fetch;
    global.fetch=(input,options)=>{const u=new URL(typeof input==='string'?input:input.url);if(u.origin!==message.proof.integrationOrigin)throw Error('TEST_EGRESS_REJECTED');return original(input,{...options,redirect:'error'});};
    prisma=require('../../config/prisma');
    const {runSyncCycle}=require('../../modules/seputar-jaminan/syncWorker.service');
    const result=await runSyncCycle({workerId:'ra-sj-'+message.proof.runId,batchSize:30});
    await prisma.$disconnect();
    finished=true;process.send({pass:true,result},()=>process.disconnect());
  }catch(error){if(prisma)await prisma.$disconnect().catch(()=>{});finished=true;process.exitCode=1;if(process.connected)process.send({pass:false,code:error.code||error.name},()=>process.disconnect());}
});
