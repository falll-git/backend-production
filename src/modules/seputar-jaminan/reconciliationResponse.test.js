const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {validateReconciliationResponse:validate}=require('./reconciliationResponse');
const runId=crypto.randomUUID(),id=crypto.randomUUID(),manifest={items:[{aggregate_id:id}]};
const valid={request_id:'request',run_id:runId,status:'COMPLETED',count_checked:1,count_mismatch:0,mismatches:[]};
test('valid matching reconciliation confirms only the manifest check, not public observation',()=>{
  assert.equal(validate(valid,manifest,runId),valid);
  assert.equal('observed_at' in valid,false);assert.equal('public_visibility' in valid,false);
});
test('200/empty, missing counts, wrong run, incomplete coverage and foreign mismatch cannot become MATCHED',()=>{
  for(const bad of [{},null,[],{...valid,count_checked:undefined},{...valid,count_mismatch:undefined},{...valid,run_id:crypto.randomUUID()},
    {...valid,count_checked:0},{...valid,count_mismatch:1},{...valid,status:'HEALTHY'},
    {...valid,count_mismatch:1,mismatches:[{aggregate_id:crypto.randomUUID(),code:'MEDIA_NOT_READY',recommended_action:'CONTACT_OPERATIONS'}]}]){
    assert.throws(()=>validate(bad,manifest,runId),e=>e.code==='RECONCILIATION_RESPONSE_INVALID');
  }
});
test('actual eligibility/media/projection mismatches remain mismatches, without inferring a public page cause',()=>{
  for(const code of ['ACTUAL_STATE_MISMATCH','PUBLICATION_NOT_ELIGIBLE','PROFILE_NOT_ELIGIBLE','MEDIA_NOT_READY','PROJECTION_NOT_READY']){
    const value={...valid,count_mismatch:1,mismatches:[{aggregate_id:id,code,recommended_action:'CONTACT_OPERATIONS'}]};
    assert.equal(validate(value,manifest,runId).count_mismatch,1);
  }
});
