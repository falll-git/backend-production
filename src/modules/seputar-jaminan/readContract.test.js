const test=require('node:test'),assert=require('node:assert/strict');
const read=require('./readContract'),schemas=require('./seputarJaminan.validation'),validate=require('../../middlewares/validate.middleware');
test('withdrawal keeps bank approval separate from pending work and public evidence',()=>{
  const {withdrawalEligibility:check}=require('./publicationLifecycle');
  for(const state of ['DRAFT','REVISION_REQUIRED','APPROVED','PUBLISHED']) {
    assert.deepEqual(check({state,published_version_id:'approved'}),{eligible:true,reason:null});
    assert.equal(check({state,published_version_id:null}).eligible,false);
  }
  for(const state of ['IN_REVIEW','UNPUBLISHED','ARCHIVED','UNKNOWN']) {
    const result=check({state,published_version_id:'approved'});
    assert.equal(result.eligible,false);assert.ok(result.reason);
  }
});
test('query middleware rejects unknown cursor/sort, arrays, invalid filters and numbers instead of silently removing them',()=>{
  for(const [schema,input] of [
    [schemas.listQuerySchema,{cursor:'foreign'}],[schemas.listQuerySchema,{sort:'price'}],
    [schemas.listQuerySchema,{page:0}],[schemas.listQuerySchema,{limit:101}],
    [schemas.listQuerySchema,{state:['DRAFT','PUBLISHED']}],[schemas.listQuerySchema,{category:'OTHER'}],
    [schemas.eligibleListQuerySchema,{state:'DRAFT'}],[schemas.mediaListQuerySchema,{purpose:'ORIGINAL'}],
    [schemas.submissionListQuerySchema,{kind:'INTERNAL'}],
  ]){let code;validate(schema,{source:'query',stripUnknown:false})({query:input},{status:n=>{code=n;return{json:()=>{}};}},()=>assert.fail('unexpected next'));assert.equal(code,422);}
  const result=schemas.listQuerySchema.validate({page:'2',limit:'5',state:'DRAFT',category:'VEHICLE',search:' nol '});
  assert.equal(result.error,undefined);assert.equal(result.value.page,2);assert.equal(result.value.search,'nol');
});
test('read allowlists remove nested unknown objects but preserve valid zero and false',()=>{
  const dto=read.publicationPayload({title:'Aset',private_key:'secret',attributes:{mileage_km:0,password:'secret',brand:{secret:1}},location:{province:'Jawa Barat',internal:'secret'},media:[{media_id:'id',position:0,is_cover:false,token:'secret'}]});
  assert.deepEqual(dto,{title:'Aset',attributes:{mileage_km:0},location:{province:'Jawa Barat'},media:[{media_id:'id',position:0,is_cover:false}]});
  assert.deepEqual(read.profilePayload({public_name:'Bank',website_url:null,secret:'x'}),{public_name:'Bank',website_url:null});
  assert.equal(read.impact({affected_publications:0,central_synced:false,secret:1}).affected_publications,0);
  assert.deepEqual(read.publicationPayload(null),{});
});
test('pagination total scope and deterministic mixed submission ordering',()=>{
  assert.deepEqual(read.pagination(1,20,0),{page:1,limit:20,total:0,total_pages:0,total_scope:'ACCESSIBLE_FILTERED_RECORDS'});
  const row=(kind,id)=>({kind,version:{id,submitted_at:'2026-09-19T00:00:00Z',created_at:'2026-09-19T00:00:00Z'}});
  const rows=[row('PUBLICATION','a'),row('PROFILE','b'),row('CONTACT','b')];
  assert.deepEqual(rows.sort(read.compareSubmissions).map(r=>r.kind),['CONTACT','PROFILE','PUBLICATION']);
  assert.equal(read.publicObservation.state,'NOT_LOADED');assert.equal(read.publicObservation.reason,'OBSERVATION_AVAILABLE_IN_DETAIL');assert.equal(read.versionSemantics.published_version,'BANK_APPROVED_VERSION');
});
