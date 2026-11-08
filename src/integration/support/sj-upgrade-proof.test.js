const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {planBaseline}=require('./sj-upgrade-proof');
const root=path.join(__dirname,'../../../prisma/migrations');
const migrations=fs.readdirSync(root).filter(n=>fs.existsSync(path.join(root,n,'migration.sql'))).sort();
test('upgrade baseline is an actual chronological prefix and retains the review-role prerequisite',()=>{
  const baseline=planBaseline(migrations);
  assert.equal(baseline.length,145);assert.deepEqual(baseline,migrations.slice(0,145));
  assert.ok(baseline.includes('20260919110000_scope_sj_review_runtime'));
  assert.equal(migrations.length,149);
  assert.deepEqual(migrations.slice(baseline.length),['20260930150000_bind_sj_outbox_destination','20260930160000_link_sj_decision_delivery','20260930230000_scoped_sj_recovery_receipts','20261020090000_fix_debtor_create_returning_rls']);
});

test('reviewed debtor correction keeps the145 baseline and rejects a missing or renamed addition',()=>{
  const correction='20261020090000_fix_debtor_create_returning_rls';
  assert.ok(!planBaseline(migrations).includes(correction));
  assert.throws(()=>planBaseline(migrations.filter(n=>n!==correction)),/review upgrade baseline/);
  assert.throws(()=>planBaseline(migrations.map(n=>n===correction?'20261020090001_unreviewed_correction':n)),/review upgrade baseline/);
});

test('removing or injecting an earlier baseline migration is refused even with the reviewed tail intact',()=>{
  assert.throws(()=>planBaseline(migrations.slice(1)),/review chronological baseline/);
  assert.throws(()=>planBaseline([...migrations,'20200101000000_unreviewed_baseline'].sort()),/review chronological baseline/);
});

test('upgrade coverage label names149 and retains the published-media limitation',()=>{
  const source=fs.readFileSync(path.join(__dirname,'sj-upgrade-proof.js'),'utf8');
  assert.match(source,/coverage:'145->149; contact drafts before upgrade, full publication\/worker workflow after upgrade; not a pre-upgrade published-media dataset'/);
  assert.doesNotMatch(source,/coverage:'145->148;/);
});
test('unreviewed future migration, duplicate, unordered and missing prerequisite fail before provisioning',()=>{
  for(const values of [[...migrations,'20990101000000_unreviewed'],[...migrations,migrations.at(-1)],[...migrations].reverse(),migrations.filter(n=>n!=='20260919110000_scope_sj_review_runtime')])assert.throws(()=>planBaseline(values));
});

test('default owned service scenario provisions read-time account eligibility without credential or write grants',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../../../scripts/run-sj-isolated-tests.js'),'utf8');
  const grant='GRANT SELECT (id,name,is_active,password_set_at,role_id,division_id,can_access_restricted_documents) ON public.users TO sj_test_app';
  const at=source.indexOf(grant);
  assert.ok(at>source.indexOf('assertContainer(proof,proof[kind])'));
  assert.ok(at<source.indexOf('if(workflow) {'),'the default media/action-read scenario needs this read prerequisite too');
  const statement=source.slice(source.lastIndexOf('await admin.query(',at),source.indexOf('\n',at));
  assert.doesNotMatch(statement,/GRANT\s+(?:UPDATE|INSERT|DELETE|ALL)|\bpassword\s*[,)]|BYPASSRLS|SUPERUSER/i);
  assert.match(source,/core\.longpaths=true/);
});

test('scenario timeout remains bounded without truncating full bank or cross-app coverage',()=>{
  const {scenarioTimeout}=require('../../../scripts/run-sj-isolated-tests');
  assert.equal(scenarioTimeout(false),120000);
  for(const workflow of [true,'upgrade','central','worker','auth'])assert.equal(scenarioTimeout(workflow),900000);
  assert.equal(scenarioTimeout('cross-app'),1200000);
  // Expanded Step6 actual UI creation/lifecycle and bounded visual handoff.
  // Application/session TTLs and every business assertion remain unchanged.
  assert.equal(scenarioTimeout('cross-app',true),3600000);
  assert.equal(scenarioTimeout('cross-app',true,true),3600000);
  assert.equal(scenarioTimeout('auth',false,true),900000);
});
