// Test-only guard. No dotenv, application imports, or writes before proof validation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = () => { throw new Error('SJ_TEST_TARGET_NOT_OWNED: target isolation proof rejected'); };
// Bound the CLI, not the Docker daemon. A timeout remains an error; it never
// proves ownership or completion and must not trigger an unverified retry.
// SIGKILL also prevents a CLI that handles SIGTERM from holding a sync call.
const docker = args => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore','pipe','pipe'], timeout: 30000, killSignal: 'SIGKILL' }).trim();

function assertLocalDocker(env = process.env, inspectContext = () => docker(['context','inspect','--format','{{.Endpoints.docker.Host}}'])) {
  const endpoint = env.DOCKER_CONTEXT ? inspectContext() : (env.DOCKER_HOST || inspectContext());
  if (!/^(?:npipe:\/\/\/\/\.\/pipe\/[^/]+|unix:\/\/\/[^\s]+)$/.test(endpoint)) fail();
  return endpoint;
}

// Resolve a context once, before provisioning. All later CLI calls and child
// processes inherit this literal local endpoint rather than re-resolving a
// mutable Docker context. This changes this runner's environment only.
function pinLocalDocker(env = process.env, inspectContext) {
  const endpoint = assertLocalDocker(env, inspectContext);
  env.DOCKER_HOST = endpoint;
  delete env.DOCKER_CONTEXT;
  return endpoint;
}

function assertContainer(proof, item, inspect = id => JSON.parse(docker(['inspect', id]))[0], allowPausedRecovery = false) {
  if (!item || !/^[a-f0-9]{64}$/.test(item.id || '')) fail();
  const actual = inspect(item.id);
  if (actual.Id !== item.id || actual.Config?.Labels?.['ra-sj.run'] !== proof.runId || actual.Config?.Labels?.['ra-sj.proof'] !== proof.tokenHash) fail();
  if ((actual.Mounts || []).some(m => m.Type === 'bind' || m.Type === 'volume')) fail();
  if (!actual.HostConfig?.Tmpfs?.[item.dataPath]) fail();
  const bindings = actual.HostConfig?.PortBindings?.[item.internalPort + '/tcp'];
  if (!bindings || bindings.length !== 1 || bindings[0].HostIp !== '127.0.0.1') fail();
  const live = actual.NetworkSettings?.Ports?.[item.internalPort + '/tcp'];
  // Docker Desktop may hide live port mappings while paused. Only recovery
  // accepts this, after immutable ID/labels/tmpfs/binding checks above. Normal
  // runtime proof still rejects a paused/unreachable target.
  if(allowPausedRecovery && actual.State?.Paused===true && !live)return actual;
  if (!live || live.length !== 1 || Number(live[0].HostPort) !== item.port || live[0].HostIp !== '127.0.0.1') fail();
  return actual;
}

function assertConfig(proof, env, token, inspect) {
  if (env.NODE_ENV !== 'test' || proof?.kind !== 'RA-SJ-02-disposable-v1' || !/^[a-f0-9]{32}$/.test(proof.runId || '') || digest(token || '') !== proof.tokenHash) fail();
  if (!proof.root || !path.isAbsolute(proof.root) || fs.lstatSync(proof.root).isSymbolicLink() || fs.realpathSync(proof.root) !== path.resolve(proof.root)) fail();
  const marker = JSON.parse(fs.readFileSync(path.join(proof.root, 'owner.json'), 'utf8'));
  if (marker.runId !== proof.runId || marker.tokenHash !== proof.tokenHash) fail();
  const expectedRoot = path.join(proof.root, 'storage');
  if (env.SJ_MEDIA_FILESYSTEM_ROOT !== expectedRoot || env.UPLOAD_DIR !== path.join(proof.root,'uploads') || env.UPLOAD_TEMP_DIR !== path.join(proof.root,'tmp')) fail();
  for (const dir of [expectedRoot, env.UPLOAD_DIR, env.UPLOAD_TEMP_DIR]) {
    if (fs.lstatSync(dir).isSymbolicLink() || fs.realpathSync(dir) !== path.resolve(dir)) fail();
  }
  if (fs.existsSync(path.join(proof.root, '.env'))) fail();
  if (env.SJ_MEDIA_STORAGE_PROVIDER !== 'FILESYSTEM') fail();
  for (const key of ['DATABASE_URL','DATABASE_SYSTEM_URL','SJ_WORKER_DATABASE_URL']) {
    let u; try { u = new URL(env[key]); } catch { fail(); }
    const user = key === 'SJ_WORKER_DATABASE_URL' ? 'sj_test_worker' : 'sj_test_app';
    if (u.protocol !== 'postgresql:' || u.hostname !== '127.0.0.1' || Number(u.port) !== proof.pg.port || u.pathname !== '/' + proof.database || u.username !== user || !u.password || u.search || u.hash) fail();
  }
  if (env.MIGRATION_DATABASE_URL || Object.keys(env).some(k => /(?:DATABASE|REDIS|PRIVATE_KEY|PUBLIC_KEY).*_FILE$/.test(k))) fail();
  if(env.SJ_REVIEW_DATABASE_URL){
    const u=new URL(env.SJ_REVIEW_DATABASE_URL);
    if(u.protocol!=='postgresql:' || u.hostname!=='127.0.0.1' || Number(u.port)!==proof.pg.port || u.pathname!=='/'+proof.database || u.username!=='sj_test_review' || !u.password || u.search || u.hash)fail();
  }
  for (const key of ['REDIS_URL','JOB_QUEUE_REDIS_URL','APP_CACHE_REDIS_URL','RATE_LIMIT_REDIS_URL']) {
    let u; try { u = new URL(env[key]); } catch { fail(); }
    if (u.protocol !== 'redis:' || u.hostname !== '127.0.0.1' || Number(u.port) !== proof.redis.port || u.pathname !== '/0' || u.username || u.password || u.search || u.hash) fail();
  }
  if (env.SJ_TEST_REDIS_PREFIX !== 'ra-sj:' + proof.runId + ':') fail();
  for (const key of ['SJ_CONTROL_BASE_URL','SJ_TEST_CENTRAL_BASE_URL']) {
    const u = new URL(env[key]);
    if (u.origin !== proof.integrationOrigin || u.pathname !== '/' || u.search || u.hash || u.username || u.password) fail();
  }
  const origin = new URL(proof.integrationOrigin);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || Number(origin.port) < 1024 || [3000,4320,4411,7111].includes(Number(origin.port))) fail();
  assertContainer(proof, proof.pg, inspect);
  assertContainer(proof, proof.redis, inspect);
  return true;
}

async function assertLive(proof, env, token, { Client = require('pg').Client, inspect, cwd = process.cwd() } = {}) {
  assertConfig(proof, env, token, inspect); // Zero DB connections if config/ownership invalid.
  if (path.resolve(cwd) !== path.resolve(proof.root)) fail();
  const roles = [];
  for (const key of ['DATABASE_URL','SJ_WORKER_DATABASE_URL']) {
    const client = new Client({ connectionString: env[key], connectionTimeoutMillis: 3000 });
    await client.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const r = (await client.query(`SELECT current_database() db, current_user role, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
        pg_has_role(current_user, 'ruwang_arsip_app', 'member') app_member,
        pg_has_role(current_user, 'ruwang_sj_worker', 'member') worker_member,
        EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname<>current_user AND (p.rolsuper OR p.rolbypassrls) AND pg_has_role(current_user,p.oid,'member')) privileged_membership,
        EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) owns_application_tables
        FROM pg_roles WHERE rolname=current_user`)).rows[0];
      const m = (await client.query('SELECT run_id, token_hash FROM sj_test_guard.owner')).rows[0];
      const worker=key==='SJ_WORKER_DATABASE_URL';
      if (r.db !== proof.database || r.rolsuper || r.rolbypassrls || r.rolcreatedb || r.rolcreaterole || r.privileged_membership || r.owns_application_tables || (worker?!r.worker_member||r.app_member:!r.app_member||r.worker_member) || m.run_id !== proof.runId || m.token_hash !== proof.tokenHash) fail();
      roles.push(r);
      await client.query('ROLLBACK');
    } finally { await client.end(); }
  }
  if(env.SJ_REVIEW_DATABASE_URL){
    const client=new Client({connectionString:env.SJ_REVIEW_DATABASE_URL,connectionTimeoutMillis:3000});
    await client.connect();
    try{
      await client.query('BEGIN READ ONLY');
      const r=(await client.query(`SELECT current_database() db,current_user role,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,
        pg_has_role(current_user,'ruwang_sj_review','member') reviewer,
        EXISTS(SELECT 1 FROM pg_roles p WHERE p.rolname<>current_user AND (p.rolsuper OR p.rolbypassrls OR p.rolname IN ('ruwang_arsip_app','ruwang_sj_worker')) AND pg_has_role(current_user,p.oid,'member')) unsafe_membership,
        EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) owns_tables
        FROM pg_roles WHERE rolname=current_user`)).rows[0];
      const m=(await client.query('SELECT run_id,token_hash FROM sj_test_guard.owner')).rows[0];
      if(r.db!==proof.database || !r.reviewer || r.rolsuper || r.rolbypassrls || r.rolcreatedb || r.rolcreaterole || r.unsafe_membership || r.owns_tables || m.run_id!==proof.runId || m.token_hash!==proof.tokenHash)fail();
      roles.push(r);await client.query('ROLLBACK');
    }finally{await client.end();}
  }
  return roles;
}

function rejectLegacyRun(env = process.env) {
  if (['RUN_SEPUTAR_JAMINAN_INTEGRATION','RUN_CONTROL_REVIEW_ADAPTER_INTEGRATION'].some(k => String(env[k] || '').trim().toLowerCase() === 'true')) {
    throw new Error('SJ_LEGACY_HARNESS_UNSAFE: use scripts/run-sj-isolated-tests.js; legacy cleanup/SQL-status fixtures are not authorized');
  }
}
function cleanupStorage(proof) {
  if(proof?.kind!=='RA-SJ-02-disposable-v1' || !/^[a-f0-9]{32}$/.test(proof.runId||'') || !path.isAbsolute(proof.root||'')) fail();
  if(fs.lstatSync(proof.root).isSymbolicLink() || fs.realpathSync(proof.root)!==path.resolve(proof.root))fail();
  const marker=JSON.parse(fs.readFileSync(path.join(proof.root,'owner.json'),'utf8'));
  if(marker.runId!==proof.runId||marker.tokenHash!==proof.tokenHash)fail();
  // Resolve every target and reject junctions before any recursive operation.
  const targets=['storage','uploads','tmp'].map(name=>path.join(proof.root,name));
  const inspect=p=>{if(fs.lstatSync(p).isSymbolicLink()||!fs.realpathSync(p).startsWith(path.resolve(proof.root)+path.sep))fail();if(fs.statSync(p).isDirectory())for(const name of fs.readdirSync(p))inspect(path.join(p,name));};
  for(const target of targets)if(fs.existsSync(target))inspect(target);
  for(const target of targets)if(fs.existsSync(target))fs.rmSync(target,{recursive:true});
  return targets.every(p=>!fs.existsSync(p));
}
module.exports = { assertConfig, assertLive, assertContainer, assertLocalDocker, pinLocalDocker, rejectLegacyRun, cleanupStorage, digest, docker };
