// Business mutations only after the independent disposable target proof.
const assert=require('node:assert/strict');
exports.run=async({proof,token,actors,checks,double,cycle})=>{
  await require('./sj-disposable-guard').assertLive(proof,process.env,token);
  const express=require('express'),request=require('supertest');
  const {generateAccessToken}=require('../../utils/jwt');
  const app=express();app.use(express.json());app.use('/sj',require('../../modules/seputar-jaminan/seputarJaminan.route'));
  const tokens=Object.fromEntries(Object.entries(actors).filter(([,a])=>a.id).map(([k,a])=>[k,generateAccessToken({id:a.id,session_id:a.session_id})]));
  const http=async(actor,method,path,body,expected=200)=>{
    let req=request(app)[method]('/sj'+path).set('Authorization','Bearer '+tokens[actor]);if(body)req=req.send(body);
    const res=await req;assert.equal(res.status,expected,`${method} ${path}: ${res.body.message||''}`);return res.body.data;
  };
  const {validateSjResponse}=require(require('node:path').join(require('./sj-peer-paths').peerRoot('frontend'),'src/services/seputar-jaminan.response.ts'));
  const summaryKeys='acknowledged_at action_availability aggregate_id aggregate_type aggregate_version attempt_count available_at created_at event_id event_type id last_error_code state'.split(' ').sort();
  for(const path of ['/sync-events','/reconciliation/latest'])await http('denied','get',path,null,403);
  for(const path of ['/sync-events?limit=101','/sync-events?cursor=bad','/sync-events?state=PUBLIC','/sync-events?event_id=bad','/sync-events?search=ignored','/publications?confirmation=bad','/eligible-collaterals?confirmation=soon'])await http('checker','get',path,null,422);
  const page=await http('checker','get','/sync-events?state=ACKNOWLEDGED&limit=1');
  assert.equal(page.items.length,1);assert.ok(page.page_info.next_cursor);
  const next=await http('checker','get','/sync-events?state=ACKNOWLEDGED&limit=1&cursor='+page.page_info.next_cursor);
  assert.notEqual(next.items[0].id,page.items[0].id);
  await http('checker','get','/sync-events?state=FAILED&cursor='+page.page_info.next_cursor,null,422);
  for(const row of [...page.items,...next.items]){assert.deepEqual(Object.keys(row).sort(),summaryKeys);validateSjResponse('syncEvent',row);}
  await http('checker','post',`/sync-events/${page.items[0].id}/retry`,{},409);
  const deadline=await http('maker','get','/publications?paged=true&confirmation=soon');
  assert.ok(deadline.items.every(r=>r.state==='PUBLISHED'&&Date.parse(r.next_reconfirmation_at)<=Date.now()+7*86400000));
  // Create a genuine new delivery; explicit fault makes the real worker fail it.
  let contact=await http('maker','post','/contacts',{label:'Kontak uji pengelola',phone_e164:'+6281234567888'},201);
  contact=await http('maker','post',`/contacts/${contact.id}/submit`,{expected_version:contact.lock_version});
  await http('checker','post',`/contacts/${contact.id}/verify`,{expected_version:contact.lock_version});
  double.setIngestFault('permanent');await cycle();double.setIngestFault(null);
  const failed=await http('checker','get','/sync-events');
  const job=failed.items.find(r=>r.aggregate_id===contact.id);assert.ok(job,'failed official contact delivery discoverable');
  assert.equal(job.action_availability.actions.retry.available,true);
  const found=await http('checker','get','/sync-events?event_id='+job.event_id);assert.equal(found.items.length,1);
  await http('maker','post',`/sync-events/${job.id}/retry`,{},403);
  await http('denied','get',`/sync-events/${job.id}`,null,403);
  const retried=await http('checker','post',`/sync-events/${job.id}/retry`,{});
  assert.equal(retried.state,'QUEUED');assert.equal(retried.event_id,job.event_id);validateSjResponse('syncEvent',retried);
  await cycle();const completed=await http('checker','get',`/sync-events/${job.id}`);
  assert.equal(completed.state,'ACKNOWLEDGED');assert.equal(double.appliedCounts.get(job.event_id),1);
  await http('maker','post','/reconciliation',{},403);
  const runs=await Promise.all([0,1].map(()=>http('checker','post','/reconciliation',{},202)));
  const run=runs[0];assert.equal(runs[1].id,run.id,'two tabs reuse active reconciliation');validateSjResponse('reconciliation',run);
  assert.equal((await http('checker','get','/reconciliation/latest')).id,run.id);
  await cycle();await cycle();const result=await http('checker','get','/reconciliation/latest');
  validateSjResponse('reconciliation',result);assert.equal(result.state,'MATCHED');assert.ok(result.count_checked>0);
  assert.deepEqual(Object.keys(result).sort(),'id state count_checked count_mismatch started_at finished_at'.split(' ').sort());
  checks.push({check:'UX01 operator real role API: discovery, allowlist, cursor/filter rejection, denied retry, official failed delivery -> retry -> real worker ACK once, reconciliation result; Control/SJ contract double only',pass:true});
};
