const test=require('node:test'),assert=require('node:assert/strict');
const prismaPath=require.resolve('../../config/prisma');
let calls=0,query='',bindings=[];
const prisma={sj_public_profiles:{findFirst:async()=>({current_version_id:'v',public_slug:'bank-uji'})},
  sj_media_assets:{findFirst:async()=>({id:'logo'})},
  $queryRaw:async(strings,...values)=>{calls++;query=strings.join('?');bindings=values;return [
    {id:'one',fact:'success',state:'AVAILABLE',started_at:'start',finished_at:'end',observed_version:2},
    {id:'one',fact:'latest',state:'FAILED',started_at:'later',finished_at:'last',observed_version:null},
    {id:'two',fact:null},
  ];}};
require.cache[prismaPath]={id:prismaPath,filename:prismaPath,loaded:true,exports:prisma};
const {publicationSummaries}=require('./publicObservation.service');
test('bounded summary query binds current IDs, identity, environment and slug; no snapshots leak',async()=>{
 const rows=[{id:'one',public_reference_code:'SJ-ONE'},{id:'two',public_reference_code:'SJ-TWO'}];
 const result=await publicationSummaries(rows,{central_base_url:'https://sj.example'});
 assert.equal(calls,1);assert.match(query,/LEFT JOIN LATERAL/);assert.match(query,/ORDER BY started_at DESC,id DESC/);
 assert.deepEqual(JSON.parse(bindings[0]),rows.map(r=>({id:r.id,identity:r.public_reference_code})));
 assert.ok(bindings.includes('https://sj.example'));assert.ok(bindings.includes('bank-uji'));
 assert.equal(result.get('one').last_success.state,'AVAILABLE');assert.equal(result.get('one').latest_attempt.state,'FAILED');
 assert.deepEqual(Object.keys(result.get('one').last_success).sort(),['checked_at','observed_version','started_at','state']);
 assert.equal(result.get('two').last_success,null);
});
test('empty page and unavailable origin return no invented evidence and no query',async()=>{
 const before=calls;assert.equal((await publicationSummaries([],{})).size,0);
 assert.equal((await publicationSummaries([{id:'one'}],{})).get('one'),null);assert.equal(calls,before);
});
test('database failures remain failures, not fake unknown or empty success',async()=>{
 prisma.$queryRaw=async()=>{throw Error('DB unavailable');};
 await assert.rejects(publicationSummaries([{id:'one',public_reference_code:'SJ-ONE'}],{central_base_url:'https://sj.example'}),/DB unavailable/);
});
