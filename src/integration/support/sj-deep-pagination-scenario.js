// Business fixture creation only through the authenticated real bank API, after
// live disposable ownership proof. No SQL state updates, no message delivery.
const assert = require('node:assert/strict');
exports.run = async ({ proof, token, http, checks, origin }) => {
  await require('./sj-disposable-guard').assertLive(proof, process.env, token);
  const before = await http('maker', 'get', '/submissions?kind=CONTACT&limit=7');
  const created = new Set();
  for (let n = 0; n < 105; n++) {
    const contact = await http('maker', 'post', '/contacts', {
      label: `Pagination test ${proof.runId.slice(0, 8)} ${n}`,
      phone_e164: `+62800000${String(n).padStart(5, '0')}`,
    }, 201);
    const submitted = await http('maker', 'post', `/contacts/${contact.id}/submit`, { expected_version: contact.lock_version });
    assert.equal(submitted.state, 'IN_REVIEW');
    created.add(contact.id);
  }
  const first = await http('maker', 'get', '/submissions?kind=CONTACT&limit=7');
  // Immutable created_at/id cursor: an insertion between pages must not shift
  // the already-started traversal or duplicate rows, and all old rows are reachable.
  const contactStart=await http('maker','get','/contacts?paged=true&limit=7');
  const inserted=await http('maker','post','/contacts',{label:'Inserted between cursor pages',phone_e164:'+6289999999999'},201);
  const cursorIds=new Set(contactStart.items.map(i=>i.id));let cursor=contactStart.page_info.next_cursor;
  while(cursor){const next=await http('maker','get','/contacts?paged=true&limit=7&cursor='+cursor);
    for(const item of next.items){assert.ok(!cursorIds.has(item.id));cursorIds.add(item.id);}cursor=next.page_info.next_cursor;}
  assert.ok(!cursorIds.has(inserted.id));for(const id of created)assert.ok(cursorIds.has(id));
  checks.push({check:'contact keyset traversal reaches >100 contacts without duplicates despite insertion between pages',pass:true,url:origin});
  assert.equal(first.pagination.total, before.pagination.total + 105);
  const ids = new Set(), resources = new Set(), timings = [];
  for (let page = 1; page <= first.pagination.total_pages; page++) {
    const start = performance.now();
    const data = await http('maker', 'get', `/submissions?kind=CONTACT&limit=7&page=${page}`);
    timings.push(performance.now() - start);
    assert.equal(data.pagination.total, first.pagination.total);
    for (const row of data.items) {
      assert.equal(row.kind, 'CONTACT');
      assert.equal(row.public_state, 'NOT_APPLICABLE');
      assert.ok(!ids.has(row.id), 'duplicate across stable pages');
      ids.add(row.id); resources.add(row.resource_id);
    }
    assert.deepEqual((await http('maker', 'get', `/submissions?kind=CONTACT&limit=7&page=${page}`)).items, data.items);
  }
  assert.equal(ids.size, first.pagination.total);
  for (const id of created) assert.ok(resources.has(id), 'created submission missing on deep pages');
  assert.deepEqual((await http('maker', 'get', `/submissions?kind=CONTACT&limit=7&page=${first.pagination.total_pages + 1}`)).items, []);
  const mixed = await http('maker', 'get', '/submissions?limit=7');
  const mixedIds = new Set();
  for (let page = 1; page <= mixed.pagination.total_pages; page++) {
    for (const row of (await http('maker', 'get', `/submissions?limit=7&page=${page}`)).items) {
      assert.ok(!mixedIds.has(row.id)); mixedIds.add(row.id);
    }
  }
  assert.equal(mixedIds.size, mixed.pagination.total);
  // Traverse the actual merged three-table cursor endpoint, not only its codec.
  for(const filter of ['', '&kind=CONTACT&state=IN_REVIEW']){
    let next=null;const seen=new Set();let pages=0;
    do {
      const result=await http('maker','get','/submissions?paged=true&limit=7'+filter+(next?'&cursor='+next:''));
      assert.equal(result.pagination,undefined);
      assert.equal(result.page_info.order,'SUBMITTED_AT_DESC_CREATED_AT_DESC_ID_DESC_KIND_ASC');
      for(const row of result.items){
        const key=row.kind+':'+row.id;
        assert.ok(!seen.has(key),'duplicate serialized submission on cursor pages');seen.add(key);
        if(filter){assert.equal(row.kind,'CONTACT');assert.equal(row.review_state,'IN_REVIEW');}
      }
      next=result.page_info.next_cursor;
      assert.ok(++pages<200,'cursor did not terminate');
    }while(next);
    if(!filter)assert.equal(seen.size,mixed.pagination.total);
    else assert.ok(seen.size>=105);
  }
  checks.push({check:'real merged submission cursor traverses >100 records with filters and unique serialized rows',pass:true,url:origin});
  timings.sort((a, b) => a - b);
  checks.push({check: '105 official contact submissions; all filtered/mixed deep pages complete, repeatable, no duplicates', pass: true,
    url: origin, created: created.size, filteredTotal: ids.size, mixedTotal: mixedIds.size,
    timing: {unit: 'ms', scope: 'local real API + auth + runtime DB; not production SLA', p50: timings[Math.floor(timings.length / 2)], max: timings.at(-1)}});
};
