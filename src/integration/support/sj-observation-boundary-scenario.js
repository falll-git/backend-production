// Run only inside the proved disposable harness. No SQL lifecycle changes.
const assert=require('node:assert/strict');
exports.run=async({actors,prisma,checks,call,publication,double,cycle,created})=>{
  const maker=actors.maker;
  const read=id=>call(maker,()=>prisma.sj_reconciliation_runs.findUnique({where:{id}}));
  const original=await call(maker,()=>publication.getPublication(created[0]));
  let successful;
  for(const [fault,expected] of [[null,'MATCHED'],['mismatch','MISMATCH'],['empty-create','FAILED'],['empty','FAILED'],['wrong-run','FAILED'],['incomplete','FAILED'],['offline','RUNNING']]){
    double.setReconciliationFault(fault);
    const run=await call(maker,()=>publication.createReconciliation(maker));
    await cycle();if(fault!=='empty-create')await cycle();
    const row=await read(run.id);assert.equal(row.state,expected,`reconciliation ${fault||'valid'}`);
    if(!fault){assert.ok(row.count_checked>0);successful=row;}
    if(fault==='offline'){
      assert.deepEqual(await read(successful.id),successful,'network failure preserves previous completed run');
      double.setReconciliationFault(null);await cycle();assert.equal((await read(run.id)).state,'MATCHED');
    }
    // Reconciliation does not rewrite bank application/delivery or approved content.
    const after=await call(maker,()=>publication.getPublication(created[0]));
    assert.equal(after.state,original.state);assert.equal(after.sync_state,original.sync_state);
    assert.deepEqual(after.published_version,original.published_version);
    checks.push({check:`reconciliation ${fault||'valid'}: ${expected}; not a public observation`,pass:true});
  }
  double.setReconciliationFault(null);
};
