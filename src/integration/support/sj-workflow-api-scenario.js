// Called only after the disposable harness proves container/DB/role/storage ownership.
// Genuine SJ router, JWT/session middleware, RBAC, validation, services and database.
// Sessions are isolated auth prerequisites, not a test of the login endpoint.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {assertLive} = require('./sj-disposable-guard');

exports.run = async ({proof,token,actors,prisma,checks,created,drafts,contact,p,logo,cycle}) => {
  await assertLive(proof,process.env,token);
  process.env.JWT_SECRET=crypto.randomBytes(48).toString('hex');
  process.env.JWT_EXPIRES_IN='30m';
  const express=require('express'),request=require('supertest');
  const {generateAccessToken}=require('../../utils/jwt');
  const app=express();app.use(express.json());
  // Test-only transport fault: application commits, but the caller loses the response.
  app.use((req,res,next)=>{
    if(['lost','timeout'].includes(req.headers['x-sj-test-response']) && req.path.includes('/save-operations/')){
      const json=res.json.bind(res);
      res.json=body=>{
        if(body.success!==true)return json(body);
        if(req.headers['x-sj-test-response']==='lost')return res.destroy();
        setTimeout(()=>{if(!res.destroyed)json(body);},1200);
        return res;
      };
    }
    next();
  });
  const prefix='/api/v1/seputar-jaminan';
  app.use(prefix,require('../../modules/seputar-jaminan/seputarJaminan.route'));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const tokens=Object.fromEntries(Object.entries(actors).filter(([,a])=>a.id).map(([key,a])=>[key,generateAccessToken({id:a.id,session_id:a.session_id})]));
  const http=async(actor,method,url,body,expected=200)=>{
    let req=request(server)[method](prefix+url);
    if(actor)req=req.set('Authorization','Bearer '+tokens[actor]);
    if(body)req=req.send(body);
    const res=await req;
    if(res.status!==expected)throw Error(`${method} ${url}: expected ${expected}, got ${res.status} (${res.body.message || res.body.error || 'no message'})`);
    return res.body.data;
  };
  const record=check=>checks.push({check,pass:true,url:origin});
  const race=async(method,url,bodies)=>{
    const responses=await Promise.all(bodies.map(body=>request(server)[method](prefix+url).set('Authorization','Bearer '+tokens.maker).send(body)));
    const statuses=responses.map(r=>r.status).sort();
    if(JSON.stringify(statuses)!=='[200,409]') {
      throw Error(`RACE_FAILED ${method} ${url} statuses=${statuses.join(',')}`);
    }
    return responses.find(r=>r.status===200).body.data;
  };
  try {
    await require('./sj-save-operation-scenario').run({http,checks,origin,server,prefix,tokens,actors});
    const {withRlsUserContext}=require('../../config/database-rls');
    for(const a of [actors.maker,actors.checker,actors.denied]) {
      const session=await withRlsUserContext(a.id,tx=>tx.refresh_tokens.findFirst({
        where:{id:a.session_id,user_id:a.id,revoked_at:null,expires_at:{gt:new Date()}},
        select:{user:{select:{id:true,is_active:true,password_set_at:true,role_id:true,division_id:true}}},
      }));
      assert.equal(session?.user.id,a.id,'isolated auth session visible to owner');
      assert.ok(session.user.password_set_at);
    }
    await http(null,'get','/publications',null,401);
    await http('denied','get','/publications',null,403);
    for(const [method,url,body] of [
      ['patch','/profile/draft',{}],['post','/contacts',{}],
      ['post','/publications',{}],['post',`/publications/${created[2]}/submit`,{expected_version:1}],
      ['post',`/publications/${created[2]}/approve-and-publish`,{expected_version:1}],
    ])await http('denied',method,url,body,403);
    await http('maker','post',`/publications/${created[2]}/approve-and-publish`,{expected_version:1},403);
    // validate.middleware.js defines missing/invalid fields as HTTP 422.
    await http('maker','patch',`/publications/${created[0]}/draft`,{title:'Tanpa versi'},422);
    await http('outsider','get',`/publications/${created[0]}`,null,404);
    await http('outsider','patch',`/publications/${created[0]}/draft`,{expected_version:1,title:'Tidak berhak'},404);
    assert.equal((await http('outsider','get','/publications')).items.length,0);
    record('API authentication, real denied role, feature permission and validation');

    await http(null,'get',`/media/${logo.id}/content?variant=thumbnail`,null,401);
    await http('denied','get',`/media/${logo.id}/content?variant=thumbnail`,null,403);
    await http('maker','get',`/media/${logo.id}/content?variant=invalid`,null,422);
    const thumbnail=await request(server).get(prefix+`/media/${logo.id}/content?variant=thumbnail`).set('Authorization','Bearer '+tokens.maker);
    assert.equal(thumbnail.status,200);assert.match(thumbnail.headers['content-type'],/image\/webp/);
    assert.match(thumbnail.headers['cache-control'],/private, no-store/);
    const image=await require('sharp')(thumbnail.body).metadata();
    assert.ok(image.width<=320&&image.height<=320);
    record('authenticated bounded thumbnail, denied roles, invalid variant and private no-store');

    const before=await http('maker','get','/publications?limit=100');
    await http('maker','post','/publications',drafts[0],409);
    const after=await http('maker','get','/publications?limit=100');
    assert.equal(after.items.length,before.items.length);
    record('duplicate active source returns 409, no extra publication/version');

    let asset=await http('maker','get',`/publications/${created[0]}`);
    const approved=structuredClone(asset.published_version);
    asset=await race('patch',`/publications/${asset.id}/draft`,['Sunting dari tab satu','Sunting dari tab dua'].map(title=>({expected_version:asset.lock_version,title})));
    assert.notEqual(asset.current_version.id,approved.id);
    assert.deepEqual(asset.published_version,approved);
    asset=await race('post',`/publications/${asset.id}/submit`,[0,1].map(()=>({expected_version:asset.lock_version})));
    const oldSubmissionLock=asset.lock_version;
    await http('checker','post',`/publications/${asset.id}/unpublish`,{expected_version:asset.lock_version,reason_code:'OWNER_REQUEST'},409);
    assert.equal((await http('maker','get',`/publications/${asset.id}`)).state,'IN_REVIEW');
    await http('maker','patch',`/publications/${asset.id}/draft`,{expected_version:asset.lock_version,title:'Tidak boleh saat diperiksa'},409);
    asset=await http('checker','post',`/publications/${asset.id}/request-revision`,{expected_version:asset.lock_version,reason:'Perbaiki keterangan sebelum diajukan lagi.'});
    assert.deepEqual(asset.published_version,approved);
    const publicationOperation=crypto.randomUUID();
    const publicationCommand={intent:'SAVE_AND_SUBMIT',resource_id:asset.id,draft:{expected_version:asset.lock_version,title:'Perubahan yang sudah diperbaiki'}};
    const publicationReceipt=await http('maker','post',`/publications/save-operations/${publicationOperation}`,publicationCommand);
    assert.equal(publicationReceipt.state,'IN_REVIEW');
    assert.deepEqual(await http('maker','post',`/publications/save-operations/${publicationOperation}`,publicationCommand),publicationReceipt);
    asset=await http('maker','get',`/publications/${asset.id}`);
    assert.equal(asset.lock_version,publicationReceipt.lock_version);
    assert.equal(asset.current_version.title,publicationCommand.draft.title);
    record('UX08 atomic publication revision + submission, exact receipt replay and approved version preserved');
    await http('checker','post',`/publications/${asset.id}/approve-and-publish`,{expected_version:oldSubmissionLock},409);
    assert.deepEqual((await http('maker','get',`/publications/${asset.id}`)).published_version,approved);
    const votes=await Promise.all([0,1].map(()=>request(server).post(prefix+`/publications/${asset.id}/approve-and-publish`).set('Authorization','Bearer '+tokens.checker).send({expected_version:asset.lock_version})));
    assert.deepEqual(votes.map(r=>r.status).sort(),[200,409]);
    asset=votes.find(r=>r.status===200).body.data;
    assert.equal(asset.published_version.id,asset.current_version.id);
    assert.notEqual(asset.published_version.id,approved.id);
    record('publication two-tab edit/submit/approval, revision/resubmit, stale decision, approved version preserved');

    const priorApproved=structuredClone(asset.published_version);
    asset=await http('maker','patch',`/publications/${asset.id}/draft`,{expected_version:asset.lock_version,title:'Draf tetap ada setelah versi lama ditarik'});
    const pendingDraft=structuredClone(asset.current_version);
    assert.equal(asset.workflow_eligibility.withdrawal.eligible,true);
    const withdrawBody={expected_version:asset.lock_version,reason_code:'OWNER_REQUEST'};
    await http('maker','post',`/publications/${asset.id}/unpublish`,withdrawBody,403);
    await http('outsideChecker','post',`/publications/${asset.id}/unpublish`,withdrawBody,404);
    const withdrawals=await Promise.all([0,1].map(()=>request(server).post(prefix+`/publications/${asset.id}/unpublish`).set('Authorization','Bearer '+tokens.checker).send(withdrawBody)));
    assert.deepEqual(withdrawals.map(r=>r.status).sort(),[200,409]);
    asset=withdrawals.find(r=>r.status===200).body.data;
    assert.equal(asset.state,'UNPUBLISHED');
    assert.deepEqual(asset.current_version,pendingDraft);
    assert.deepEqual(asset.published_version,priorApproved);
    assert.equal(asset.workflow_eligibility.withdrawal.eligible,false);
    await http('checker','post',`/publications/${asset.id}/unpublish`,{...withdrawBody,expected_version:asset.lock_version},409);
    const {withRlsUserContext:scope}=require('../../config/database-rls');
    assert.equal(await scope(actors.maker.id,tx=>tx.sj_sync_outbox.count({where:{aggregate_id:asset.id,event_type:'UNPUBLISH_PUBLICATION'}})),1);
    // A preserved draft remains editable, but editing alone must not enqueue publication.
    const withdrawnAggregate=asset.aggregate_version;
    asset=await http('maker','patch',`/publications/${asset.id}/draft`,{expected_version:asset.lock_version,title:'Draf dilanjutkan tanpa terbit otomatis'});
    assert.equal(asset.aggregate_version,withdrawnAggregate);
    assert.deepEqual(asset.published_version,priorApproved);
    asset=await http('maker','post',`/publications/${asset.id}/submit`,{expected_version:asset.lock_version});
    asset=await http('checker','post',`/publications/${asset.id}/approve-and-publish`,{expected_version:asset.lock_version});
    assert.equal(asset.aggregate_version,withdrawnAggregate+1);
    record('withdrawal during pending draft preserves both versions; permission, tenant, duplicate and in-review guards; explicit approval required to publish again');

    // Positive lifecycle through the real API. No SQL business-state fixture.
    let spare=await http('maker','post','/contacts',{label:'Kontak untuk uji pencabutan',phone_e164:'+6281234567812'},201);
    spare=await http('maker','post',`/contacts/${spare.id}/submit`,{expected_version:spare.lock_version});
    spare=await http('checker','post',`/contacts/${spare.id}/verify`,{expected_version:spare.lock_version});
    // A newly verified contact is not usable for publication until real worker ACK.
    await cycle();
    spare=(await http('maker','get','/contacts')).find(c=>c.id===spare.id);
    assert.equal(spare.sync_state,'ACKNOWLEDGED');
    let pending=await http('maker','get',`/publications/${created[1]}`);
    pending=await http('maker','patch',`/publications/${pending.id}/draft`,{expected_version:pending.lock_version,whatsapp_contact_version_id:spare.current_version_id});
    await http('outsideChecker','post',`/contacts/${spare.id}/revoke`,{expected_version:spare.lock_version,reason_code:'OWNER_REQUEST'},409);
    pending=await http('maker','post',`/publications/${pending.id}/submit`,{expected_version:pending.lock_version});
    const [approvedRace,revokeRace]=await Promise.all([
      request(server).post(prefix+`/publications/${pending.id}/approve-and-publish`).set('Authorization','Bearer '+tokens.checker).send({expected_version:pending.lock_version}),
      request(server).post(prefix+`/contacts/${spare.id}/revoke`).set('Authorization','Bearer '+tokens.outsideChecker).send({expected_version:spare.lock_version,reason_code:'OWNER_REQUEST'}),
    ]);
    assert.equal(approvedRace.status,200);assert.equal(revokeRace.status,409);
    pending=approvedRace.body.data;
    pending=await http('checker','post',`/publications/${pending.id}/unpublish`,{expected_version:pending.lock_version,reason_code:'OWNER_REQUEST'});
    pending=await http('checker','post',`/publications/${pending.id}/archive`,{expected_version:pending.lock_version});
    await http('outsideChecker','post',`/contacts/${spare.id}/revoke`,{expected_version:spare.lock_version,reason_code:'OWNER_REQUEST'},409);
    for(let i=0;i<8;i++) await cycle();
    spare=(await http('maker','get','/contacts')).find(c=>c.id===spare.id);
    const removed=await http('checker','post',`/contacts/${spare.id}/revoke`,{expected_version:spare.lock_version,reason_code:'OWNER_REQUEST'});
    const revokedDetail=await http('maker','get',`/contacts/${spare.id}`);
    assert.equal(revokedDetail.state,'REVOKED');assert.equal(revokedDetail.id,removed.id);
    assert.equal(revokedDetail.action_availability.actions.edit_draft.available,false);
    assert.equal((await http('maker','get','/contacts')).some(row=>row.id===spare.id),false);
    await http('denied','get',`/contacts/${spare.id}`,undefined,403);
    assert.equal(removed.state,'REVOKED');
    await assert.rejects(withRlsUserContext(actors.denied.id,tx=>tx.$queryRaw`SELECT public.ruwang_arsip_sj_contact_referenced(${contact.id}::text)`));
    record('cross-division contact reference guard, approval/revoke race, queued archive blocks revoke, acknowledged archive releases contact');

    // Editing verified dependencies happens after publication approval assertions.
    contact=(await http('maker','get','/contacts')).find(c=>c.id===contact.id);
    const verifiedContact=structuredClone(contact.approved_version);
    contact=await race('patch',`/contacts/${contact.id}/draft`,['Kontak tab satu','Kontak tab dua'].map(label=>({expected_version:contact.lock_version,label})));
    assert.deepEqual(contact.approved_version,verifiedContact);
    assert.notEqual(contact.pending_version.id,verifiedContact.id);
    contact=await race('post',`/contacts/${contact.id}/submit`,[0,1].map(()=>({expected_version:contact.lock_version})));
    const staleContact=contact.lock_version;
    contact=await http('checker','post',`/contacts/${contact.id}/request-revision`,{expected_version:contact.lock_version,reason:'Perbaiki nama kontak sebelum diajukan.'});
    assert.deepEqual(contact.approved_version,verifiedContact);
    contact=await http('maker','patch',`/contacts/${contact.id}/draft`,{expected_version:contact.lock_version,label:'Kontak revisi selesai'});
    contact=await http('maker','post',`/contacts/${contact.id}/submit`,{expected_version:contact.lock_version});
    await http('checker','post',`/contacts/${contact.id}/verify`,{expected_version:staleContact},409);
    contact=await http('checker','post',`/contacts/${contact.id}/verify`,{expected_version:contact.lock_version});
    assert.notEqual(contact.approved_version.id,verifiedContact.id);
    record('contact two-tab edit/submit, revision/resubmit, stale decision and immutable approved content');
    // Approved publications still reference V1 while contact's current version is V2.
    await http('outsideChecker','post',`/contacts/${contact.id}/revoke`,{expected_version:contact.lock_version,reason_code:'OWNER_REQUEST'},409);
    await assert.rejects(withRlsUserContext(actors.outsideChecker.id,tx=>tx.sj_whatsapp_contacts.update({where:{id:contact.id},data:{state:'REVOKED',revoked_at:new Date()}})));
    assert.equal((await http('maker','get','/contacts')).find(c=>c.id===contact.id).state,'VERIFIED');
    record('old contact-version references deny cross-division revoke; database trigger also rejects explicit negative SQL bypass');

    await require('./sj-media-reference-scenario').run({http,server,prefix,tokens,actors,created,cycle,scope,checks,origin});
    p=await http('maker','get','/profile');const approvedProfile=structuredClone(p.approved_version);
    const profileDraft={display_name:'Profil tes revisi',public_slug:'test-'+proof.runId,city_regency:'Bandung',province:'Jawa Barat',short_description:'Profil ini hanya untuk pengujian perubahan terisolasi.',logo_media_id:logo.id,website_url:null};
    p=await race('patch','/profile/draft',[0,1].map(n=>({...profileDraft,display_name:'Profil tab '+n,expected_version:p.lock_version})));
    assert.deepEqual(p.approved_version,approvedProfile);
    p=await race('post','/profile/submit',[0,1].map(()=>({expected_version:p.lock_version})));
    const staleProfile=p.lock_version;
    p=await http('checker','post','/profile/request-revision',{expected_version:p.lock_version,reason:'Perbaiki profil sebelum diajukan kembali.'});
    assert.deepEqual(p.approved_version,approvedProfile);
    const profileOperation=crypto.randomUUID();
    const profileCommand={intent:'SAVE_AND_SUBMIT',draft:{...profileDraft,expected_version:p.lock_version}};
    const profileReceipt=await http('maker','post',`/profile/save-operations/${profileOperation}`,profileCommand);
    assert.equal(profileReceipt.state,'IN_REVIEW');
    assert.deepEqual(await http('maker','post',`/profile/save-operations/${profileOperation}`,profileCommand),profileReceipt);
    p=await http('maker','get','/profile');
    assert.equal(p.lock_version,profileReceipt.lock_version);
    assert.deepEqual(p.approved_version,approvedProfile);
    record('UX08 atomic profile revision + submission and exact receipt replay; previous approved version unchanged');
    await http('checker','post','/profile/verify',{expected_version:staleProfile},409);
    p=await http('checker','post','/profile/verify',{expected_version:p.lock_version});
    assert.notEqual(p.approved_version.id,approvedProfile.id);
    record('profile two-tab edit/submit, revision/resubmit, stale decision and approved payload preserved');

    let ownSubmission=await http('maker','post','/contacts',{label:'Kontak uji pengaju berbeda',phone_e164:'+6281234567891'},201);
    ownSubmission=await http('checker','post',`/contacts/${ownSubmission.id}/submit`,{expected_version:ownSubmission.lock_version});
    await http('checker','post',`/contacts/${ownSubmission.id}/verify`,{expected_version:ownSubmission.lock_version},409);
    p=await http('maker','patch','/profile/draft',{...profileDraft,expected_version:p.lock_version});
    p=await http('checker','post','/profile/submit',{expected_version:p.lock_version});
    await http('checker','post','/profile/verify',{expected_version:p.lock_version},409);
    record('profile/contact submitter cannot approve even when different from draft creator');
    await require('./sj-deep-pagination-scenario').run({proof,token,http,checks,origin});
  }finally{
    await new Promise(resolve=>server.close(resolve));
  }
};
