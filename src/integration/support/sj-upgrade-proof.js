// Infrastructure-only helper. Never receives an operational target.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {Client}=require('pg');
const {assertContainer,digest}=require('./sj-disposable-guard');
// A real chronological prefix, never a schema with prerequisite holes.
// Current services may save contacts on 145, but cannot deliver before the
// destination/lineage columns exist. Populate drafts, upgrade, then run delivery.
// The reviewed debtor RETURNING correction is the fourth additive migration;
// it does not move the contact-draft baseline or authorize unknown migrations.
const additions=['20260930150000_bind_sj_outbox_destination','20260930160000_link_sj_decision_delivery','20260930230000_scoped_sj_recovery_receipts','20261020090000_fix_debtor_create_returning_rls'];

exports.planBaseline=migrations=>{
  assert.deepEqual(migrations,[...new Set(migrations)].sort(),'migration list must be unique and ordered');
  assert.deepEqual(migrations.slice(-additions.length),additions,'review upgrade baseline when a newer migration is added');
  const baseline=migrations.slice(0,-additions.length);
  assert.equal(baseline.length,145,'review chronological baseline when migration history changes');
  assert.ok(baseline.includes('20260919110000_scope_sj_review_runtime'),'review role prerequisite must be in baseline');
  return baseline;
};

exports.prepareBaseline=(repo,root,migrations)=>{
  const baseline=exports.planBaseline(migrations);
  const dir=path.join(root,'baseline-migrations');fs.mkdirSync(dir);
  fs.copyFileSync(path.join(repo,'prisma/migrations/migration_lock.toml'),path.join(dir,'migration_lock.toml'));
  for(const name of baseline){fs.mkdirSync(path.join(dir,name));fs.copyFileSync(path.join(repo,'prisma/migrations',name,'migration.sql'),path.join(dir,name,'migration.sql'));}
  const config=path.join(root,'baseline.config.cjs');
  fs.writeFileSync(config,`const {defineConfig}=require(${JSON.stringify(path.join(repo,'node_modules/prisma/config.js'))});module.exports=defineConfig({schema:${JSON.stringify(path.join(repo,'prisma/schema.prisma'))},migrations:{path:${JSON.stringify(dir)}},datasource:{url:process.env.MIGRATION_DATABASE_URL}});`);
  return {config,baseline};
};

exports.apply=async({repo,proof,env,checksums})=>{
  assertContainer(proof,proof.pg);assertContainer(proof,proof.redis);
  const marker=JSON.parse(fs.readFileSync(path.join(proof.root,'owner.json'),'utf8'));
  assert.equal(marker.runId,proof.runId);assert.equal(marker.tokenHash,proof.tokenHash);
  const url=new URL(env.MIGRATION_DATABASE_URL);
  assert.equal(url.hostname,'127.0.0.1');assert.equal(Number(url.port),proof.pg.port);
  assert.equal(url.pathname,'/'+proof.database);assert.equal(url.username,'postgres');assert.equal(url.search,'');
  const db=new Client({connectionString:url.href});await db.connect();
  try{
    const owner=(await db.query('SELECT current_database() db,run_id,token_hash FROM sj_test_guard.owner')).rows[0];
    assert.equal(owner.db,proof.database);assert.equal(owner.run_id,proof.runId);assert.equal(owner.token_hash,proof.tokenHash);
    const fingerprint=async()=>{
      await db.query('BEGIN READ ONLY');
      try{
        const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'sj\\_%' ESCAPE '\\' ORDER BY tablename")).rows;
        const result=[];
        for(const {tablename} of tables){
          assert.match(tablename,/^sj_[a-z_]+$/);
          const row=(await db.query(`SELECT count(*)::int count,md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) digest FROM public."${tablename}" t`)).rows[0];
          result.push({table:tablename,...row});
        }
        return result;
      }finally{await db.query('ROLLBACK');}
    };
    const before=await fingerprint();
    assert.ok(before.find(r=>r.table==='sj_whatsapp_contacts')?.count>=2,'official baseline draft contacts required');
    assert.ok(before.find(r=>r.table==='sj_whatsapp_contact_versions')?.count>=2,'immutable baseline draft versions required');
    assert.equal(before.find(r=>r.table==='sj_sync_outbox')?.count,0,'current delivery must not run against pre-binding schema');
    for(const command of ['deploy','status']){
      const output=execFileSync(process.execPath,[path.join(repo,'node_modules/prisma/build/index.js'),'migrate',command,'--config',path.join(repo,'prisma.config.ts')],{cwd:proof.root,env,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:180000});
      fs.writeFileSync(path.join(proof.root,`upgrade-${command}.log`),output.replaceAll(decodeURIComponent(url.password),'[redacted]'));
    }
    const after=await fingerprint();assert.deepEqual(after.filter(t=>before.some(b=>b.table===t.table)),before,'additive upgrade must not change existing SJ data');
    assert.ok(after.filter(t=>!before.some(b=>b.table===t.table)).every(t=>t.count===0),'new evidence tables start empty');
    const ledger=(await db.query('SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows;
    assert.equal(ledger.length,checksums.length);
    for(const m of checksums)assert.ok(ledger.some(l=>l.migration_name===m.name&&l.checksum===m.sha256));
    return {check:'chronological 145 baseline with official contact drafts preserves every existing SJ table fingerprint; final migration status/checksums',pass:true,count:ledger.length,tables:before,combinedDigest:digest(JSON.stringify(before)),coverage:'145->149; contact drafts before upgrade, full publication/worker workflow after upgrade; not a pre-upgrade published-media dataset'};
  }finally{await db.end();}
};
