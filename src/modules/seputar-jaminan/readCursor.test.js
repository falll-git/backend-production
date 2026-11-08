const test=require('node:test'),assert=require('node:assert/strict'),cursor=require('./readCursor');
test('cursor binds filter and immutable created/id, does not claim global total',()=>{
  const rows=[{id:'00000000-0000-4000-8000-000000000002',created_at:new Date('2026-09-20T00:00:00Z')},{id:'00000000-0000-4000-8000-000000000001',created_at:new Date('2026-09-20T00:00:00Z')}];
  const page=cursor.page(rows,1,['contacts'],r=>({id:r.id}));assert.equal(page.items.length,1);assert.equal(page.page_info.has_more,true);assert.equal(page.total,undefined);
  assert.deepEqual(cursor.decode(page.page_info.next_cursor,['contacts']).OR[1].id,{lt:rows[0].id});
  assert.throws(()=>cursor.decode(page.page_info.next_cursor,['media']));
  for(const value of ['?',Buffer.from('{}').toString('base64url'),page.page_info.next_cursor+'='])assert.throws(()=>cursor.decode(value,['contacts']));
  assert.equal(cursor.page(rows,2,['contacts'],r=>r).page_info.next_cursor,null);
});
test('updated-at cursor binds field and filter without changing legacy cursor format',()=>{
  const rows=[{id:'00000000-0000-4000-8000-000000000002',updated_at:new Date('2026-09-20T00:00:00Z')}];
  const page=cursor.pageBy([...rows,{id:'00000000-0000-4000-8000-000000000001',updated_at:new Date('2026-09-19T00:00:00Z')}],1,['publications'],r=>r,'updated_at');
  assert.equal(page.page_info.order,'UPDATED_AT_DESC_ID_DESC');
  assert.deepEqual(cursor.decodeBy(page.page_info.next_cursor,['publications'],'updated_at').OR[1].id,{lt:rows[0].id});
  assert.throws(()=>cursor.decodeBy(page.page_info.next_cursor,['other'],'updated_at'));
  assert.throws(()=>cursor.decodeBy(page.page_info.next_cursor,['publications'],'created_at'));
});
test('submission cursor binds kind/state and all deterministic sort keys',()=>{
  const rows=[{kind:'CONTACT',version:{id:'00000000-0000-4000-8000-000000000002',submitted_at:new Date('2026-09-20T00:00:00Z'),created_at:new Date('2026-09-20T00:00:00Z')}} ,{kind:'PROFILE',version:{id:'00000000-0000-4000-8000-000000000001',submitted_at:new Date('2026-09-19T00:00:00Z'),created_at:new Date('2026-09-19T00:00:00Z')}}];
  const page=cursor.pageSubmission(rows,1,{kind:null,state:null},r=>r.version.id);
  assert.equal(page.page_info.order,'SUBMITTED_AT_DESC_CREATED_AT_DESC_ID_DESC_KIND_ASC');
  assert.deepEqual(cursor.decodeSubmission(page.page_info.next_cursor,{kind:null,state:null},'CONTACT').OR[2].id,{lt:rows[0].version.id});
  assert.equal(cursor.decodeSubmission(page.page_info.next_cursor,{kind:null,state:null},'PROFILE').OR[3].id,rows[0].version.id);
  assert.throws(()=>cursor.decodeSubmission(page.page_info.next_cursor,{kind:'PROFILE',state:null},'PROFILE'));
  assert.throws(()=>cursor.decodeSubmission(page.page_info.next_cursor,{kind:null,state:null},'UNKNOWN'));
});
