// Invoked only inside the ownership-verified disposable workflow harness.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

// Real router/RBAC transport for initial profile and all-category creation.
// Only called after the parent harness verifies ownership and provisions sessions.
exports.bootstrapSave = async (kind, draft, actor, resourceId) => {
  const express = require('express'), request = require('supertest');
  const {generateAccessToken} = require('../../utils/jwt');
  process.env.JWT_SECRET ||= require('node:crypto').randomBytes(48).toString('hex');
  process.env.JWT_EXPIRES_IN = '30m';
  const app = express();
  app.use(express.json());
  app.use('/sj', require('../../modules/seputar-jaminan/seputarJaminan.route'));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const token = generateAccessToken({id:actor.id,session_id:actor.session_id});
    const id = randomUUID(), body = {intent:'SAVE_AND_SUBMIT', draft, ...(resourceId ? {resource_id:resourceId} : {})};
    const send = () => request(server).post(`/sj/${kind}/save-operations/${id}`).set('Authorization','Bearer '+token).send(body);
    const first = await send();
    assert.equal(first.status, 200, first.body.message);
    assert.equal(first.body.data.state, kind === 'publications' && !resourceId ? 'DRAFT' : 'IN_REVIEW');
    if(kind === 'publications' && !resourceId)assert.ok(first.body.data.submission_error);
    const repeated = await send();
    assert.equal(repeated.status, 200);
    assert.deepEqual(repeated.body, first.body);
    return first.body.data;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
};

exports.run = async ({http,checks,origin,server,prefix,tokens,actors}) => {
  const request = require('supertest');
  const {withRlsUserContext} = require('../../config/database-rls');
  const operation = randomUUID();
  const url = `/contacts/save-operations/${operation}`;
  const body = {intent:'SAVE_AND_SUBMIT',draft:{label:'Kontak operasi atomik',phone_e164:'+6281234567801'}};
  await http('denied','post',url,body,403);
  await http(null,'post',url,body,401);
  const invalidId=randomUUID();
  await http('maker','post',`/contacts/save-operations/${invalidId}`,{...body,draft:{label:'Tidak valid',phone_e164:'invalid'}},422);
  assert.deepEqual(await http('maker','get',`/save-operations/${invalidId}`),{status:'NOT_RECORDED',receipt:null});
  const results = await Promise.all([0,1].map(()=>http('maker','post',url,body)));
  assert.deepEqual(results[0],results[1]);
  const receipt = results[0];
  assert.equal(receipt.state,'IN_REVIEW');
  assert.equal(receipt.intent,'SAVE_AND_SUBMIT');
  assert.equal(receipt.operation_id,operation);
  assert.deepEqual(Object.keys(receipt).sort(),['operation_id','kind','intent','resource_id','lock_version','state','completed_at','submission_error'].sort());
  const row = await http('maker','get',`/contacts/${receipt.resource_id}`);
  assert.equal(row.lock_version,receipt.lock_version);
  assert.equal(row.pending_version.version_number,1);
  assert.deepEqual(await http('maker','get',`/save-operations/${operation}`),{status:'COMPLETED',receipt});
  assert.deepEqual(await http('checker','get',`/save-operations/${operation}`),{status:'NOT_RECORDED',receipt:null});
  await http('denied','get',`/save-operations/${operation}`,undefined,403);
  await http('maker','post',url,{...body,draft:{...body.draft,label:'Payload berbeda'}},409);

  // A post-save failure must roll back both the draft and its receipt.
  const saveId = randomUUID();
  const saved = await http('maker','post',`/contacts/save-operations/${saveId}`,{...body,intent:'SAVE_DRAFT',draft:{...body.draft,phone_e164:'+6281234567802'}});
  assert.equal(saved.state,'DRAFT');
  assert.equal((await http('maker','get',`/contacts/${saved.resource_id}`)).state,'DRAFT');
  const edits = [0,1].map(n=>({intent:'SAVE_AND_SUBMIT',resource_id:saved.resource_id,
    draft:{expected_version:saved.lock_version,label:`Dua tab ${n}`}}));
  const responses = await Promise.all(edits.map(draft=>request(server).post(prefix+`/contacts/save-operations/${randomUUID()}`)
    .set('Authorization','Bearer '+tokens.maker).send(draft)));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const updated = responses.find(r=>r.status===200).body.data;
  await http('checker','post',`/contacts/${saved.resource_id}/request-revision`,{expected_version:updated.lock_version,reason:'Perbaiki nama kontak untuk tes.'});
  const revision = await http('maker','get',`/contacts/${saved.resource_id}`);
  const resubmitted = await http('maker','post',`/contacts/save-operations/${randomUUID()}`,{intent:'SAVE_AND_SUBMIT',resource_id:saved.resource_id,
    draft:{expected_version:revision.lock_version,label:'Revisi selesai'}});
  assert.equal(resubmitted.state,'IN_REVIEW');
  assert.equal((await http('maker','get',`/contacts/${saved.resource_id}`)).pending_version.version_number,2);
  assert.equal(await withRlsUserContext(actors.maker.id,tx=>tx.sj_whatsapp_contacts.count({where:{id:receipt.resource_id}})),1);
  await http('maker','post',`/contacts/save-operations/${randomUUID()}`,body,409);
  const faultId=randomUUID(),faultBody={...body,draft:{...body.draft,phone_e164:'+6281234567803'}};
  const contacts=require('../../modules/seputar-jaminan/profileContact.service'),submit=contacts.submitContact;
  contacts.submitContact=async()=>{throw Error('EXPLICIT_TEST_FAULT_AFTER_SAVE');};
  try {await http('maker','post',`/contacts/save-operations/${faultId}`,faultBody,500);}
  finally {contacts.submitContact=submit;}
  assert.equal(await withRlsUserContext(actors.maker.id,tx=>tx.sj_whatsapp_contacts.count({where:{phone_e164:faultBody.draft.phone_e164}})),0);
  assert.deepEqual(await http('maker','get',`/save-operations/${faultId}`),{status:'NOT_RECORDED',receipt:null});
  const recovered=await http('maker','post',`/contacts/save-operations/${faultId}`,faultBody);
  assert.equal(recovered.state,'IN_REVIEW');
  const lostId=randomUUID(),lostBody={...body,draft:{...body.draft,phone_e164:'+6281234567804'}};
  await assert.rejects(request(server).post(prefix+`/contacts/save-operations/${lostId}`).set('Authorization','Bearer '+tokens.maker).set('x-sj-test-response','lost').send(lostBody));
  const observed=await http('maker','get',`/save-operations/${lostId}`);
  assert.equal(observed.status,'COMPLETED');
  assert.deepEqual(await http('maker','post',`/contacts/save-operations/${lostId}`,lostBody),observed.receipt);
  const timeoutId=randomUUID(),timeoutBody={...body,draft:{...body.draft,phone_e164:'+6281234567805'}};
  await assert.rejects(request(server).post(prefix+`/contacts/save-operations/${timeoutId}`).set('Authorization','Bearer '+tokens.maker).set('x-sj-test-response','timeout').send(timeoutBody).timeout({response:500,deadline:1000}),error=>Boolean(error.timeout));
  // The delayed request may still be committing. Serialize a same-key retry,
  // then verify the official receipt instead of treating timeout as failure.
  const timeoutRecovered=await http('maker','post',`/contacts/save-operations/${timeoutId}`,timeoutBody);
  assert.equal(timeoutRecovered.state,'IN_REVIEW');
  assert.deepEqual(await http('maker','get',`/save-operations/${timeoutId}`),{status:'COMPLETED',receipt:timeoutRecovered});
  assert.equal(await withRlsUserContext(actors.maker.id,tx=>tx.sj_whatsapp_contacts.count({where:{phone_e164:timeoutBody.draft.phone_e164}})),1);
  checks.push({check:'UX08 real HTTP timeout and same-key retry/receipt; invalid draft rejected with no receipt',pass:true,url:origin});
  checks.push({check:'UX08 rollback after save fault, same-key recovery, lost response after commit and no duplicate; real API/RLS, explicit test-only faults',pass:true,url:origin});
  checks.push({check:'UX08 atomic contact save/submit, draft-only, concurrent duplicate, actor-bound receipt, allowlist, changed request conflict, two tabs, stale and revision',pass:true,url:origin});
};
