const {test}=require('node:test'),assert=require('node:assert/strict');
const {seedActors}=require('./sj-isolated-fixtures');
test('four UI source prerequisites belong to the actual browser actor, without SJ business SQL',async()=>{
 const calls=[],client={query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};}};
 const actors=await seedActors(client,'a'.repeat(32),'synthetic-test-password-Aa1!',{step6PublicationSources:true});
 const debtor=calls.find(c=>c.sql.startsWith('INSERT INTO digital_debtors')&&c.args[2]==='SJ-UI-'+'a'.repeat(32));
 assert.ok(debtor);assert.equal(debtor.args[3],actors.browserMaker.id);assert.notEqual(debtor.args[3],actors.maker.id);
 const rows=calls.filter(c=>c.sql.startsWith('INSERT INTO debtor_collaterals')&&c.args[1]===debtor.args[0]);assert.equal(rows.length,4);
 assert.deepEqual(new Set(rows.map(c=>c.args[0])),new Set(Object.values(actors.step6CollateralIds)));
 assert.equal(calls.some(c=>/\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+sj_(?:bprs|profiles|publications|contacts|media|sync)/i.test(c.sql)),false);
});
