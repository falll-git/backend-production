// Infrastructure only for a freshly owned run. Never consumes repository .env.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {Client}=require('pg');
const {assertContainer,digest}=require('./sj-disposable-guard');
const {controlPath,centralPath}=require('./sj-peer-paths');
function verifyControlMigrationLedger(files, ledger) {
  assert.equal(ledger.length,files.length,'Control migration ledger count');
  assert.equal(new Set(ledger.map(row=>row.name)).size,ledger.length,'Control migration ledger duplicates');
  for(const file of files)assert.equal(ledger.find(row=>row.name===file.name)?.checksum,file.sha256,'Control migration checksum: '+file.name);
  return {count:ledger.length,checksums:files};
}
exports.verifyControlMigrationLedger=verifyControlMigrationLedger;
exports.provision=async({proof,ownerUrl,baseEnv,browserRoot})=>{
  assertContainer(proof,proof.pg);
  const url=new URL(ownerUrl);assert.equal(url.hostname,'127.0.0.1');assert.equal(Number(url.port),proof.pg.port);assert.equal(url.pathname,'/'+proof.database);
  const admin=new Client({connectionString:ownerUrl});await admin.connect();
  const controlDb='ruwang_control_'+proof.runId,centralDb='sj_central_'+proof.runId;
  const result={controlDb,centralDb,controlRole:'ruwang_control_runtime_test',opsPrincipal:crypto.randomUUID(),urls:{},controlPassword:crypto.randomBytes(24).toString('hex'),bootstrapPassword:crypto.randomBytes(24).toString('base64url')+'Aa1!',browserPassword:crypto.randomBytes(24).toString('base64url')+'Aa1!',controlEncryptionKey:crypto.randomBytes(32).toString('base64')};
  const getUrl=(db,user,password)=>{const u=new URL(ownerUrl);u.pathname='/'+db;u.username=user;u.password=password;return u.href;};
  try{
    assert.equal((await admin.query('SELECT run_id FROM sj_test_guard.owner')).rows[0].run_id,proof.runId);
    for(const db of [controlDb,centralDb])await admin.query(`CREATE DATABASE "${db}"`);
    await admin.query(`CREATE ROLE ruwang_control_owner_test LOGIN PASSWORD '${crypto.randomBytes(24).toString('hex')}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; CREATE ROLE ruwang_control_runtime_test LOGIN PASSWORD '${result.controlPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
    const controlOwnerPassword=crypto.randomBytes(24).toString('hex');await admin.query(`ALTER ROLE ruwang_control_owner_test PASSWORD '${controlOwnerPassword}'; ALTER DATABASE "${controlDb}" OWNER TO ruwang_control_owner_test`);
    const control=new Client({connectionString:getUrl(controlDb,'postgres',url.password)});await control.connect();
    try{await control.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');}finally{await control.end();}
    const migrationRoot=path.join(proof.root,'control-migrations');fs.mkdirSync(migrationRoot);
    fs.cpSync(controlPath("migrations"),path.join(migrationRoot,'migrations'),{recursive:true});
    for(const command of [[],['--status']]){
      const label=command.length?'status':'deploy';
      const redact=value=>String(value).replaceAll(controlOwnerPassword,'[redacted]').replaceAll(result.controlPassword,'[redacted]').replace(/postgres(?:ql)?:\/\/[^\s"']+/g,'[database]');
      try{
        const output=execFileSync(process.execPath,[controlPath("scripts/migrate.mjs"),...command],{cwd:migrationRoot,env:{...baseEnv,CONTROL_DATABASE_NAME:controlDb,CONTROL_DATABASE_RUNTIME_ROLE:result.controlRole,CONTROL_DATABASE_MIGRATION_ROLE:'ruwang_control_owner_test',CONTROL_MIGRATION_DATABASE_URL:getUrl(controlDb,'ruwang_control_owner_test',controlOwnerPassword),CONTROL_DATABASE_URL:getUrl(controlDb,result.controlRole,result.controlPassword)},windowsHide:true,stdio:'pipe',timeout:120000});
        fs.writeFileSync(path.join(proof.root,`control-migrate-${label}.log`),redact(output));
      }catch(error){
        fs.writeFileSync(path.join(proof.root,`control-migrate-${label}.log`),redact(String(error.stdout||'')+String(error.stderr||'')));
        throw Error('CONTROL_MIGRATION_'+label.toUpperCase()+'_FAILED');
      }
    }
    result.controlUrl=getUrl(controlDb,result.controlRole,result.controlPassword);delete result.controlPassword;
    const controlAdmin=new Client({connectionString:getUrl(controlDb,'postgres',url.password)});await controlAdmin.connect();
    try{
      const files=fs.readdirSync(path.join(migrationRoot,'migrations')).filter(name=>/^\d+.*\.sql$/.test(name)).sort().map(name=>({name,sha256:digest(fs.readFileSync(path.join(migrationRoot,'migrations',name)))}));
      assert.ok(files.length>0,'Control migration source cannot be empty');
      result.controlMigrations=verifyControlMigrationLedger(files,(await controlAdmin.query('SELECT name,checksum FROM control.schema_migrations ORDER BY name')).rows);
      if(browserRoot){
        assert.ok(path.resolve(browserRoot).startsWith('D:\\ra-sj-local-evidence\\control-build-'));
        const candidate=JSON.parse(fs.readFileSync(path.join(browserRoot,'result.json')));assert.equal(candidate.pass,true);
        for(const f of JSON.parse(fs.readFileSync(path.join(browserRoot,'source.json'))))assert.equal(digest(fs.readFileSync(path.join(controlPath(),f.file))),f.sha256,'Control browser source must match build');
        result.browserRoot=browserRoot;
      }
      await controlAdmin.query(`COMMENT ON DATABASE "${controlDb}" IS 'RA-SJ:${proof.tokenHash}'`);
    }finally{await controlAdmin.end();}
    const central=new Client({connectionString:getUrl(centralDb,'postgres',url.password)});await central.connect();
    try{
      await central.query(fs.readFileSync(centralPath("infra/postgres/bootstrap-group-roles.sql"),'utf8'));
      for(const scope of ['registry','ingest','public','ops','worker']){
        const password=crypto.randomBytes(24).toString('hex'),role='sj_cross_'+scope;
        await central.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; GRANT sj_${scope} TO ${role}`);
        result.urls[scope]=getUrl(centralDb,role,password);
      }
      await central.query(`COMMENT ON DATABASE "${centralDb}" IS 'RA-SJ:${proof.tokenHash}'`);
    }finally{await central.end();}
    const config=path.join(proof.root,'sj-migration.config.cjs');fs.writeFileSync(config,`const {defineConfig}=require(${JSON.stringify(centralPath('node_modules/prisma/config.js'))});module.exports=defineConfig({schema:${JSON.stringify(centralPath('prisma/schema.prisma'))},migrations:{path:${JSON.stringify(centralPath('prisma/migrations'))}},datasource:{url:process.env.MIGRATION_DATABASE_URL}});`);
    for(const command of ['deploy','status'])execFileSync(process.execPath,[centralPath("node_modules/prisma/build/index.js"),'migrate',command,'--config',config],{cwd:proof.root,env:{...baseEnv,MIGRATION_DATABASE_URL:getUrl(centralDb,'postgres',url.password)},windowsHide:true,stdio:'pipe',timeout:120000});
    const centralAdmin=new Client({connectionString:getUrl(centralDb,'postgres',url.password)});await centralAdmin.connect();
    try{await centralAdmin.query("INSERT INTO ops_users(id,email_normalized,display_name,password_hash,state,created_at,updated_at) VALUES($1,$2,'No-login isolated principal','not-a-login-hash','REVOKED',now(),now())",[result.opsPrincipal,proof.runId+'@example.invalid']);
      const ledger=(await centralAdmin.query('SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows;
      const folders=fs.readdirSync(centralPath("prisma/migrations")).filter(n=>fs.existsSync(centralPath("prisma/migrations/")+n+'/migration.sql'));
      assert.equal(ledger.length,folders.length);for(const n of folders)assert.equal(ledger.find(l=>l.migration_name===n)?.checksum,digest(fs.readFileSync(centralPath("prisma/migrations/")+n+'/migration.sql')));
      result.migrationCount=ledger.length;
    }finally{await centralAdmin.end();}
    return result;
  }finally{await admin.end();}
};
exports.register=async({proof,ownerUrl,cross,registration})=>{
  assertContainer(proof,proof.pg);const u=new URL(ownerUrl);assert.equal(Number(u.port),proof.pg.port);assert.equal(u.pathname,'/'+proof.database);u.pathname='/'+cross.controlDb;
  assert.match(registration.instanceId,/^[a-f0-9-]{36}$/);const target=new URL(registration.bankOrigin);assert.equal(target.hostname,'127.0.0.1');assert.ok(Number(target.port)>1024&&!['3111','7111','4320','4411'].includes(target.port));
  const db=new Client({connectionString:u.href});await db.connect();try{
    assert.equal((await db.query("SELECT shobj_description(oid,'pg_database') marker FROM pg_database WHERE datname=current_database()")).rows[0].marker,'RA-SJ:'+proof.tokenHash);
    await db.query("INSERT INTO control.instances(id,instance_key,display_name,review_authority,enabled,adapter_base_url,adapter_audience,control_signing_key_id,bank_ack_key_id,bank_ack_public_key) VALUES($1,$2,'Owned cross-app bank','central',true,$3,'ruwang-bank:isolated','test-control','test-bank',$4)",[registration.instanceId,'cross-'+proof.runId,registration.bankOrigin,registration.bankPublicKey]);
    const recovery=registration.recoveryBinding;assert.equal(new URL(recovery.url).hostname,'127.0.0.1');assert.equal(recovery.installationId,registration.instanceId);
    await db.query('UPDATE control.instances SET sj_recovery_binding=$2::jsonb WHERE id=$1',[registration.instanceId,JSON.stringify(recovery)]);
    // Administrative bootstrap only after instance ownership has been proved.
    // Decisions use a separate reviewer created and logged in by the real service.
    const {bootstrapFirstOperator}=await import(require('node:url').pathToFileURL(controlPath('src/server/auth/bootstrap.ts')).href);
    await bootstrapFirstOperator(db,{username:'bootstrap-'+proof.runId,displayName:'Owned bootstrap',password:cross.bootstrapPassword,instanceKeys:['cross-'+proof.runId],encryptionKey:cross.controlEncryptionKey});
  }finally{await db.end();}
};
