// Only called after the cross-app owned target guard. Positive transitions use
// real upload/worker/recovery APIs; the scanner outage is a test-only dependency fault.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {controlRecoveryProof} from './sj-control-recovery-peer.mjs';
export async function processingRecoveryProof({load,centralPath,controlPath,db,workerDb,worker,settings,actor,sourceMediaId}) {
  const {withInstitution}=await load(centralPath('apps/api/src/database.ts'));
  const read=fn=>withInstitution(db.ingest,settings.institutionId,fn);
  const media=await read(tx=>tx.mediaObject.findFirstOrThrow({where:{sourceMediaId,institutionId:settings.institutionId}}));
  assert.equal(media.state,'PROCESSING');assert.equal(media.originInstallationId,settings.instanceId);
  const job=await read(tx=>tx.centralJob.findFirstOrThrow({where:{institutionId:settings.institutionId,jobType:'PROCESS_MEDIA',payload:{path:['media_id'],equals:media.id}}}));
  const {CentralWorker}=await load(centralPath('apps/worker/src/worker.ts'));
  const faultWorker=new CentralWorker(workerDb,settings.storage,{verifyReady:async()=>{},scan:async()=>{throw Error('OWNED_SCANNER_OUTAGE');}},settings.logger,10485760,
    {leaseMs:10000,renewMs:1000,idleMs:1,retryBaseMs:1});
  let failed;
  for(let i=0;i<100;i++){await faultWorker.runOnce();failed=await read(tx=>tx.centralJob.findUniqueOrThrow({where:{id:job.id}}));if(failed.state==='DEAD_LETTER')break;await new Promise(r=>setTimeout(r,20));}
  faultWorker.stop();assert.equal(failed.state,'DEAD_LETTER');assert.equal(failed.attemptCount,5);
  const beforeMedia=await read(tx=>tx.mediaObject.findUniqueOrThrow({where:{id:media.id}}));assert.equal(beforeMedia.state,'PROCESSING');
  const proof=await controlRecoveryProof({load,controlPath,settings,actor,jobId:job.id,provider:'SJ'});
  const queued=await read(tx=>tx.centralJob.findUniqueOrThrow({where:{id:job.id}}));assert.equal(queued.state,'PENDING');assert.equal(queued.attemptCount,0);
  assert.deepEqual(queued.payload,failed.payload);assert.equal(queued.originInstallationId,failed.originInstallationId);
  const audit=await read(tx=>tx.$queryRaw`SELECT previous_attempt_count,reason,result_json FROM control_recovery_receipts WHERE job_id=${job.id}::uuid`);
  assert.equal(audit.length,1);assert.equal(audit[0].previous_attempt_count,5);assert.equal(audit[0].result_json.state,'SCHEDULED');
  assert.deepEqual(await read(tx=>tx.mediaObject.findUniqueOrThrow({where:{id:media.id}})),beforeMedia);
  await worker.runOnce();assert.equal((await read(tx=>tx.centralJob.findUniqueOrThrow({where:{id:job.id}}))).state,'COMPLETED');
  assert.equal((await read(tx=>tx.mediaObject.findUniqueOrThrow({where:{id:media.id}}))).state,'READY');
  const permissions=await read(tx=>tx.$queryRaw`SELECT has_table_privilege('control_recovery_receipts','UPDATE') can_edit,has_table_privilege('control_recovery_receipts','DELETE') can_delete`);
  assert.deepEqual(permissions,[{can_edit:false,can_delete:false}]);
  const empty=await withInstitution(db.ingest,crypto.randomUUID(),tx=>tx.$queryRaw`SELECT request_id FROM control_recovery_receipts`);assert.equal(empty.length,0);
  return {...proof,check:proof.check+'; genuine SJ worker exhausts five attempts, immutable receipt keeps prior count, restored scanner completes without changing payload or media eligibility; RLS/append-only audit'};
}
