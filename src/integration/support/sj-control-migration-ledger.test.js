const test=require('node:test');
const assert=require('node:assert/strict');
const {verifyControlMigrationLedger}=require('./sj-cross-app-provision');
const files=[{name:'0001_test.sql',sha256:'a'.repeat(64)},{name:'0002_test.sql',sha256:'b'.repeat(64)}];
const rows=()=>files.map(file=>({name:file.name,checksum:file.sha256}));
test('Control migration proof requires exact applied source checksums, not only successful CLI exit',()=>{
  assert.deepEqual(verifyControlMigrationLedger(files,rows()),{count:2,checksums:files});
});
for(const [name,alter] of [
  ['missing',r=>r.pop()],['extra',r=>r.push({name:'0003_unknown.sql',checksum:'c'.repeat(64)})],
  ['changed',r=>r[1].checksum='c'.repeat(64)],['duplicate',r=>r[1]={...r[0]}],
  ['wrong identity',r=>r[1].name='0002_other.sql'],
])test('Control migration ledger refuses '+name+' entries',()=>{const ledger=rows();alter(ledger);assert.throws(()=>verifyControlMigrationLedger(files,ledger));});
