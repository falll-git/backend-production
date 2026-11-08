// Called only after disposable target verification, uses real app role + service.
const assert=require('node:assert/strict');
exports.run=async({actors,prisma,checks,call,double,created})=>{
  const service=require('../../modules/seputar-jaminan/publicObservation.service');
  const invoke=()=>call(actors.maker,()=>service.check('PUBLICATION',created[0]));
  const list=async()=>{
    const page=await call(actors.maker,()=>require('../../modules/seputar-jaminan/seputarJaminan.service').listPublications({page:1,limit:100,paged:true}));
    return page.items.find(row=>row.id===created[0]).observation_summary;
  };
  assert.equal((await call(actors.maker,()=>service.read('PUBLICATION',created[0]))).last_success,null);
  const first=await invoke();assert.equal(first.last_success.state,'AVAILABLE');assert.equal(first.last_success.observed_version,null);
  assert.equal(first.last_success.source_origin,double.origin);assert.ok(first.last_success.checked_at);
  assert.deepEqual((await list()).last_success,{state:'AVAILABLE',started_at:first.last_success.started_at,checked_at:first.last_success.checked_at,observed_version:null});
  for(const fault of ['empty','wrong-identity','generic404','offline','timeout']){
    double.setPublicFault(fault);const result=await invoke();
    assert.equal(result.latest_attempt.state,'FAILED',fault);
    assert.deepEqual(result.last_success,first.last_success,`${fault} preserves previous successful observation`);
    const summary=await list();assert.equal(summary.latest_attempt.state,'FAILED');assert.equal(summary.last_success.checked_at.getTime(),first.last_success.checked_at.getTime());
    assert.deepEqual(Object.keys(summary.last_success).sort(),['checked_at','observed_version','started_at','state']);
    if(fault==='timeout')assert.equal(result.latest_attempt.failure_code,'TIMEOUT');
  }
  double.setPublicFault('not-found');const absent=await invoke();assert.equal(absent.last_success.state,'NOT_FOUND');
  assert.equal((await list()).last_success.state,'NOT_FOUND');
  const boundRows=await call(actors.maker,()=>prisma.sj_publications.findMany());
  const otherEnvironment=await call(actors.maker,()=>service.publicationSummaries(boundRows,{central_base_url:'https://different.invalid'}));
  assert.ok([...otherEnvironment.values()].every(value=>value===null||value.last_success===null));
  const wrongIdentity=await call(actors.maker,()=>service.publicationSummaries(boundRows.map(row=>({...row,public_reference_code:'SJ-NOTBOUND'})),{central_base_url:double.origin}));
  assert.ok([...wrongIdentity.values()].every(value=>value===null||value.last_success===null));
  double.setPublicFault(null);const restored=await invoke();assert.equal(restored.last_success.state,'AVAILABLE');
  assert.notEqual(restored.last_success.id,first.last_success.id);
  double.setPublicFault('not-found');
  const unboundProfile=await call(actors.maker,()=>service.check('PROFILE'));
  assert.equal(unboundProfile.last_success,null);assert.equal(unboundProfile.latest_attempt.failure_code,'IDENTITY_UNCONFIRMED');
  double.setPublicFault(null);
  const profileProof=await call(actors.maker,()=>service.check('PROFILE'));
  assert.equal(profileProof.last_success.state,'AVAILABLE');assert.equal(profileProof.version_evidence,'SOURCE_PROFILE_EVENT');
  assert.ok(profileProof.last_success.observed_version>0);assert.equal(profileProof.last_success.profile_snapshot.published_asset_count,0);
  for(const fault of ['wrong-website','wrong-identity','offline','timeout']){
    double.setPublicFault(fault);const failed=await call(actors.maker,()=>service.check('PROFILE'));
    assert.equal(failed.latest_attempt.state,'FAILED');assert.deepEqual(failed.last_success,profileProof.last_success);
  }
  double.setPublicFault('not-found');
  assert.equal((await call(actors.maker,()=>service.check('PROFILE'))).last_success.state,'NOT_FOUND');
  double.setPublicFault(null);
  await assert.rejects(call(actors.outsider,()=>service.check('PUBLICATION',created[0])));
  await assert.rejects(call(actors.denied,()=>service.check('PUBLICATION',created[0])));
  const denied=await call(actors.denied,()=>prisma.$queryRaw`SELECT id FROM public.sj_public_observations`);assert.equal(denied.length,0);
  // A completed record cannot be replaced, even via a direct negative SQL probe.
  await assert.rejects(call(actors.maker,()=>prisma.$executeRaw`UPDATE public.sj_public_observations SET source_origin='https://other.invalid' WHERE id=${first.last_success.id}::uuid`));
  const rewritten=await call(actors.maker,()=>prisma.$executeRaw`UPDATE public.sj_public_observations SET state='FAILED',failure_code='TEST' WHERE id=${first.last_success.id}::uuid`);assert.equal(rewritten,0);
  // Earlier slow request finishes after the newer check; newest START remains latest.
  double.setPublicFault('timeout');const slow=invoke();await new Promise(r=>setTimeout(r,250));double.setPublicFault(null);
  const fast=await invoke();await slow;const final=await call(actors.maker,()=>service.read('PUBLICATION',created[0]));
  assert.equal(final.latest_attempt.id,fast.latest_attempt.id);assert.equal(final.last_success.id,fast.last_success.id);
  checks.push({check:'public API observation: identity+owned logo, environment/time, no invented version, valid 404, wrong/empty/offline/timeout, retained success, late completion, RLS and immutable completed evidence',pass:true,integration:'SJ public contract double, not real peer'});
};
