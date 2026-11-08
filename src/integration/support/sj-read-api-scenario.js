// Read-only assertions against official bank API after disposable target proof.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
exports.run=async({proof,token,actors,checks})=>{
  await require('./sj-disposable-guard').assertLive(proof,process.env,token);
  // Node 24 strips this pure TS validator; use the actual sibling consumer, not
  // a copied expectation. A missing consumer is a test failure, never a skip.
  const fs=require('node:fs'),path=require('node:path');
  const consumerFile=path.join(require('./sj-peer-paths').peerRoot('frontend'),'src/services/seputar-jaminan.response.ts');
  const consumerHash=()=>crypto.createHash('sha256').update(fs.readFileSync(consumerFile)).digest('hex');
  const consumerBefore=consumerHash();
  const {validateSjResponse}=require(consumerFile);
  process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('hex');
  process.env.JWT_EXPIRES_IN ||= '30m';
  const express=require('express'),request=require('supertest'),{generateAccessToken}=require('../../utils/jwt');
  const app=express();app.use(express.json());app.use('/api/v1/seputar-jaminan',require('../../modules/seputar-jaminan/seputarJaminan.route'));
  const tokens=Object.fromEntries(Object.entries(actors).filter(([,a])=>a.id).map(([k,a])=>[k,generateAccessToken({id:a.id,session_id:a.session_id})]));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const url='http://127.0.0.1:'+server.address().port;
  const get=async(path,actor='maker',status=200)=>{const res=await request(server).get('/api/v1/seputar-jaminan'+path).set('Authorization','Bearer '+tokens[actor]);assert.equal(res.status,status,path);return res.body.data;};
  const allowed=(value,keys)=>assert.deepEqual(Object.keys(value).sort(),keys.split(' ').sort());
  const noSecrets=value=>{
    if(!value||typeof value!=='object')return;
    for(const [key,v] of Object.entries(value)){assert.ok(!['private_key','password','token_hash','payload_json','logical_object_key','upload_session_id','storage_backend','lease_owner','command_json'].includes(key),key);noSecrets(v);}
  };
  try{
    for(const path of ['/dashboard','/profile','/contacts','/publications','/submissions','/change-requests','/media'])await get(path,'denied',403);
    for(const path of ['/publications?cursor=bad','/publications?sort=price','/publications?page=0','/publications?limit=101','/publications?category=OTHER','/eligible-collaterals?state=DRAFT','/submissions?search=ignored','/change-requests?sort=ignored','/media?purpose=ORIGINAL','/publications/not-a-uuid'])await get(path,'maker',422);
    const page=await get('/publications?limit=2');assert.equal(page.items.length,2);assert.equal(page.pagination.total,4);assert.equal(page.pagination.total_scope,'ACCESSIBLE_FILTERED_RECORDS');
    const second=await get('/publications?limit=2&page=2');assert.equal(new Set([...page.items,...second.items].map(i=>i.id)).size,4);
    assert.deepEqual((await get('/publications?limit=2')).items,page.items);
    const zero=await get('/publications?search=not-found-'+proof.runId);assert.equal(zero.pagination.total,0);assert.deepEqual(zero.items,[]);
    const all=await get('/publications?limit=100');
    // Test before later lifecycle scenarios archive the published fixtures.
    // Clock injection is confined to the read service, not JWT/session auth,
    // business transitions or the worker. No database status/date rewrite.
    const live=all.items.find(row=>row.state==='PUBLISHED'&&row.next_reconfirmation_at);
    assert.ok(live,'real approved+worker-acknowledged publication required');
    const savedNow=Date.now;
    try{
      Date.now=()=>Date.parse(live.next_reconfirmation_at)-86400000;
      const {runWithDatabaseUserContext}=require('../../config/database-context');
      const service=require('../../modules/seputar-jaminan/seputarJaminan.service');
      const due=await runWithDatabaseUserContext(actors.maker.id,()=>service.listPublications({paged:true,limit:20,confirmation:'soon'}));
      assert.ok(due.items.some(row=>row.id===live.id));
      const conflicting=await runWithDatabaseUserContext(actors.maker.id,()=>service.listPublications({paged:true,limit:20,confirmation:'soon',state:'DRAFT'}));
      assert.equal(conflicting.items.length,0);
    }finally{Date.now=savedNow;}
    checks.push({check:'confirmation-soon real RLS read service with explicit read-clock injection; no lifecycle mutation',pass:true});
    for(const route of ['/contacts?paged=true&limit=1','/media?paged=true&limit=1','/reviews?paged=true&limit=1','/publications?paged=true&limit=1','/submissions?paged=true&limit=1','/change-requests?paged=true&limit=1']){
      const first=await get(route);assert.equal(first.page_info.count_scope,'CURRENT_PAGE');assert.ok(first.items.length<=1);
      if(first.page_info.next_cursor){const next=await get(route+'&cursor='+first.page_info.next_cursor);assert.ok(next.items.every(i=>i.id!==first.items[0].id));}
      await get(route+'&cursor=broken','maker',422);
    }
    await get('/contacts?ignored=true','maker',422);await get('/reviews?sort=ignored','maker',422);
    const contactsPage=await get('/contacts?paged=true&limit=1');
    await get('/eligible-collaterals?paged=true','maker',422);
    for(const route of ['/publications','/submissions','/change-requests'])await get(route+'?paged=true&page=2','maker',422);
    const publicationCursor=await get('/publications?paged=true&limit=1');
    assert.equal(publicationCursor.page_info.order,'CREATED_DESC_ID_DESC');
    assert.ok(publicationCursor.page_info.next_cursor);
    await get('/publications?paged=true&limit=1&category=VEHICLE&cursor='+publicationCursor.page_info.next_cursor,'maker',422);
    if(contactsPage.page_info.next_cursor)await get('/contacts?paged=true&limit=1&state=VERIFIED&cursor='+contactsPage.page_info.next_cursor,'maker',422);
    const observationPath='/publications/'+all.items[0].id+'/public-observation';
    const contactsForHistory=await get('/contacts');
    for(const contact of contactsForHistory){
      const detail=await get('/contacts/'+contact.id);
      assert.equal(detail.id,contact.id);validateSjResponse('contact',detail);noSecrets(detail);
      allowed(detail,'id label phone_e164 state is_default sync_state aggregate_version lock_version current_version_id approved_version pending_version draft_version_id rejection_reason last_verified_at revoked_at created_at updated_at action_availability');
      assert.deepEqual(detail,contact);
      await get('/contacts/'+contact.id,'denied',403);
    }
    await get('/contacts/not-a-uuid','maker',422);
    await get('/contacts/'+crypto.randomUUID(),'maker',404);
    checks.push({check:'contact by-ID exact identity, allowlist, actual request permission and missing/invalid input',pass:true});
    for(const historyPath of ['/publications/'+all.items[0].id+'/history','/profile/history','/contacts/'+contactsForHistory[0].id+'/history']){
      const first=await get(historyPath+'?limit=1');assert.equal(first.page_info.count_scope,'CURRENT_PAGE');assert.ok(first.items.length>0);
      for(const row of first.items){validateSjResponse('history',row);noSecrets(row);assert.equal(row.public_version_evidence,'UNAVAILABLE');assert.equal(Object.hasOwn(row,'phone_e164'),false);}
      if(first.page_info.next_cursor){const next=await get(historyPath+'?limit=1&cursor='+first.page_info.next_cursor);assert.ok(next.items.every(row=>row.id!==first.items[0].id));}
      await get(historyPath+'?cursor=broken','maker',422);await get(historyPath,'denied',403);
    }
    const reviewHistory=await get('/publications/'+all.items[0].id+'/history?stream=reviews&limit=1');reviewHistory.items.forEach(row=>validateSjResponse('history',row));
    await get('/publications/'+all.items[0].id+'/history','outsider',404);await get('/profile/history?stream=reviews','maker',422);
    validateSjResponse('observationEvidence',await get(observationPath));
    await get(observationPath,'outsider',404);await get(observationPath,'denied',403);
    const refused=await request(server).post('/api/v1/seputar-jaminan'+observationPath).set('Authorization','Bearer '+tokens.denied).send({});assert.equal(refused.status,403);
    const vehicle=all.items.find(i=>i.asset_category==='VEHICLE');assert.equal(vehicle.current_version.attributes.mileage_km,0);
    const filtered=await get('/publications?category=VEHICLE&state='+vehicle.state+'&search='+vehicle.reference_code);assert.equal(filtered.pagination.total,1);assert.equal(filtered.items[0].id,vehicle.id);
    assert.deepEqual((await get('/publications?page=99')).items,[]);
    const dto=await get('/publications/'+page.items[0].id);
    const pagedDetail=await get('/publications/'+page.items[0].id+'?history=paged');
    validateSjResponse('publication',pagedDetail);
    assert.deepEqual(pagedDetail.review_history,{mode:'PAGED',loaded:false});
    assert.equal(Object.hasOwn(pagedDetail,'reviews'),false,'paged consumer never receives an unbounded embedded review list');
    assert.deepEqual(pagedDetail.current_version,dto.current_version);
    await get('/publications/'+page.items[0].id+'?history=wrong','maker',422);
    await get('/publications/'+page.items[0].id+'?ignored=true','maker',422);
    validateSjResponse('publication',dto);
    all.items.forEach(item=>validateSjResponse('publication',item));
    for(const item of all.items){
      assert.ok(Object.hasOwn(item,'observation_summary'));
      if(item.observation_summary)allowed(item.observation_summary,'scope freshness last_success latest_attempt');
    }
    allowed(dto,'id reference_code source_type source_collateral_id owner_division asset_category state sync_state aggregate_version lock_version next_reconfirmation_at last_confirmed_at last_sync_error_code title city_regency province cover current_version published_version version_semantics public_observation workflow_eligibility action_availability media_actions created_at updated_at reviews');
    assert.equal(dto.action_availability.scope,'START_ACTION');
    assert.equal(dto.action_availability.expected_version,dto.lock_version);
    assert.equal(dto.action_availability.actions.approve.available,false);
    assert.equal(dto.action_availability.actions.approve.reason_code,'PERMISSION_DENIED');
    const reviewing=all.items.find(i=>i.current_version.state==='IN_REVIEW');
    assert.ok(reviewing);
    const checkerView=await get('/publications/'+reviewing.id,'checker');
    const settingsForAction=await get('/settings');
    assert.equal(settingsForAction.entry_actions.expected_version,null);
    assert.equal(settingsForAction.entry_actions.actions.create_publication.available,true);
    assert.equal(settingsForAction.entry_actions.actions.create_contact.available,true);
    assert.equal(settingsForAction.entry_actions.actions.create_profile.available,true);
    assert.equal(settingsForAction.entry_actions.actions.upload_media.available,true);
    assert.equal(settingsForAction.entry_actions.actions.reconcile.reason_code,'PERMISSION_DENIED');
    const checkerSettings=await get('/settings','checker');
    assert.equal(checkerSettings.entry_actions.actions.reconcile.available,checkerSettings.sync_enabled);
    await get('/settings','denied',403);
    for(const m of dto.current_version.media){
      assert.equal(m.action_availability,undefined,'actor-specific permissions must not alter version content');
      assert.equal(dto.media_actions[m.id].expected_version,null);
      assert.equal(dto.media_actions[m.id].actions.request_revoke.available,settingsForAction.review_authority==='central');
      const status=await get('/media/'+m.id+'/status');validateSjResponse('media',status);
      assert.deepEqual(status.action_availability,dto.media_actions[m.id]);
      await get('/media/'+m.id+'/status','denied',403);
    }
    assert.equal(checkerView.action_availability.actions.approve.available,settingsForAction.review_authority==='local');
    if(settingsForAction.review_authority==='central')assert.equal(checkerView.action_availability.actions.approve.reason_code,'AUTHORITY_MISMATCH');
    const reviewQueue=await get('/reviews?paged=true&limit=20','checker');
    const queuedReview=reviewQueue.items.find(item=>item.id===reviewing.id);
    assert.ok(queuedReview,'review action assessment uses the same accessible row');
    assert.deepEqual(queuedReview.action_availability,checkerView.action_availability);
    const sharedContacts=await get('/contacts',settingsForAction.review_authority==='local'?'checker':'maker');
    assert.ok(sharedContacts.some(c=>c.action_availability.actions.revoke.reason_code==='CONTACT_IN_USE'));
    if(settingsForAction.review_authority==='local'){
      const makerContacts=await get('/contacts');
      assert.ok(makerContacts.every(c=>c.action_availability.actions.revoke.reason_code==='PERMISSION_DENIED'));
    }
    assert.equal(dto.version_semantics.published_version,'BANK_APPROVED_VERSION');assert.equal(dto.public_observation.state,'NOT_LOADED');
    if(dto.cover){assert.equal(typeof dto.cover.file_name,'string');assert.equal(typeof dto.cover.purpose,'string');}
    await get('/publications/'+dto.id,'outsider',404);
    const submissions=await get('/submissions?limit=2'),more=await get('/submissions?limit=2&page=2');
    assert.equal(new Set([...submissions.items,...more.items].map(i=>i.id)).size,submissions.items.length+more.items.length);
    for(const item of submissions.items){assert.ok(['PUBLIC_UNKNOWN','NOT_APPLICABLE'].includes(item.public_state));}
    const byKind=await get('/submissions?kind=PUBLICATION&state=IN_REVIEW');assert.ok(byKind.items.every(i=>i.kind==='PUBLICATION'&&i.review_state==='IN_REVIEW'));
    for(const path of ['/dashboard','/settings','/profile','/contacts','/media','/reviews','/change-requests','/submissions','/publications'])noSecrets(await get(path));
    for(const [route,kind,list] of [['/dashboard','dashboard'],['/settings','settings'],['/taxonomy','taxonomy'],['/profile','profile'],['/contacts','contact',true],['/media','media',true],['/reviews','review',true]]){
      const data=await get(route);
      if(data!==null)(list?data:[data]).forEach(item=>validateSjResponse(kind,item));
    }
    for(const [route,kind] of [['/submissions','submission'],['/eligible-collaterals','collateral'],['/change-requests','change']]){
      (await get(route)).items.forEach(item=>validateSjResponse(kind,item));
    }
    assert.equal(consumerHash(),consumerBefore,'frontend response validator changed during contract test');
    checks.push({check:'Real API responses accepted by actual frontend wire validator; not a copied mock schema',pass:true,consumerFile,sha256:consumerBefore});
    checks.push({check:'RA06 read API: permission, allowlist, mixed pagination, invalid inputs, filter combination, partial/zero and explicit unknown observation',pass:true,url});
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
};
