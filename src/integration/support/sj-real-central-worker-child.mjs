// Real SJ CentralWorker in a separately killable process. IPC is private test
// orchestration; no application endpoint or production fault switch is added.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require = createRequire(import.meta.url);
const {assertContainer, assertLocalDocker, docker} = require('./sj-disposable-guard.js');
const {assertScanner} = require('./sj-scanner-proof.js');
const load = value => import(pathToFileURL(value).href);
let worker, database, settings, resume;
const send = value => {if (process.connected) process.send(value);};
process.once('disconnect', () => process.exit(1));

function verifyFilesystem(proof, storageRoot) {
  assert.equal(proof.kind, 'RA-SJ-02-disposable-v1');
  assert.match(proof.runId, /^[a-f0-9]{32}$/);
  assert.match(proof.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(path.resolve(process.cwd()), path.resolve(proof.root));
  const marker = JSON.parse(fs.readFileSync(path.join(proof.root, 'owner.json'), 'utf8'));
  assert.equal(marker.runId, proof.runId); assert.equal(marker.tokenHash, proof.tokenHash);
  assert.equal(storageRoot, path.join(proof.root, 'storage', 'central'));
  for (const dir of [proof.root, path.join(proof.root, 'storage'), storageRoot]) {
    assert.equal(fs.lstatSync(dir).isSymbolicLink(), false);
    assert.equal(fs.realpathSync(dir), path.resolve(dir));
  }
  // The worker writes derivatives below this root; reject nested junctions too.
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      assert.equal(fs.lstatSync(full).isSymbolicLink(), false);
      assert.ok(fs.realpathSync(full).startsWith(storageRoot + path.sep));
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(storageRoot);
}

async function initialize(data) {
  assert.equal(worker, undefined);
  const {proof, centralRoot, databaseUrl, storageRoot} = data;
  verifyFilesystem(proof, storageRoot);
  assertLocalDocker();
  assertContainer(proof, proof.pg); assertContainer(proof, proof.redis);
  assertScanner(JSON.parse(docker(['inspect', proof.scanner.id]))[0], proof.scanner);
  const url = new URL(databaseUrl);
  assert.equal(url.protocol, 'postgresql:'); assert.equal(url.hostname, '127.0.0.1');
  assert.equal(Number(url.port), proof.pg.port);
  assert.equal(url.pathname, '/sj_central_' + proof.runId);
  assert.equal(url.username, 'sj_cross_worker'); assert.ok(url.password);
  assert.equal(url.search, ''); assert.equal(url.hash, '');
  assert.equal(fs.lstatSync(centralRoot).isSymbolicLink(), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(centralRoot, 'package.json'), 'utf8')).name, 'seputarjaminan');
  const sjRequire = createRequire(path.join(centralRoot, 'package.json'));
  const {Client} = sjRequire('pg'), client = new Client({connectionString: databaseUrl, connectionTimeoutMillis: 3000});
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const role = (await client.query(`SELECT r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,
      pg_has_role(current_user,'sj_worker','member') AS worker_member,
      EXISTS(SELECT 1 FROM pg_roles p WHERE (p.rolsuper OR p.rolbypassrls)
        AND p.rolname<>current_user AND pg_has_role(current_user,p.oid,'member')) AS privileged_member,
      EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owns_tables,
      shobj_description(d.oid,'pg_database') AS marker
      FROM pg_roles r CROSS JOIN pg_database d WHERE r.rolname=current_user AND d.datname=current_database()`)).rows[0];
    for (const field of ['rolsuper', 'rolbypassrls', 'rolcreatedb', 'rolcreaterole', 'privileged_member', 'owns_tables']) assert.equal(role[field], false);
    assert.equal(role.worker_member, true); assert.equal(role.marker, 'RA-SJ:' + proof.tokenHash);
    await client.query('ROLLBACK');
  } finally {await client.end();}
  // Application imports and scanner/storage use occur only after ownership and
  // the actual non-owner worker role have been verified above.
  const centralPath = relative => path.join(centralRoot, relative);
  database = (await load(centralPath('apps/worker/src/database.ts'))).createWorkerDatabase(databaseUrl);
  const storage = new (await load(centralPath('packages/storage/src/filesystem.mjs'))).FilesystemStorageAdapter({root: storageRoot});
  const scanner = (await load(centralPath('apps/worker/src/malware-scanner.ts'))).createMalwareScanner({
    mode: 'CLAMAV', command: 'clamdscan', dockerContainer: proof.scanner.id,
  });
  await scanner.verifyReady();
  const {CentralWorker} = await load(centralPath('apps/worker/src/worker.ts'));
  worker = new CentralWorker(database, storage, scanner, sjRequire('pino')({level: 'silent'}), 10485760,
    {leaseMs: 1000, renewMs: 200, idleMs: 1});
  settings = data;
  return {pid: process.pid, role: 'sj_cross_worker', scanner: 'CLAMAV', ready: true};
}

process.on('message', async message => {
  try {
    let value;
    if (message.method === 'init') value = await initialize(message.data);
    else if (message.method === 'claim') {
      assert.ok(worker); value = await worker.claimJob();
      if (value) assert.equal(value.id, settings.jobId);
    } else if (message.method === 'run') {
      assert.ok(worker); assert.equal(resume, undefined);
      const original = worker.claimJob.bind(worker);
      worker.claimJob = async () => {
        const job = await original(); assert.ok(job); assert.equal(job.id, settings.jobId);
        await new Promise(resolve => {resume = resolve; send({event: 'claimed', job});});
        return job;
      };
      try {value = {ran: await worker.runOnce(), scanner: 'CLAMAV'};}
      finally {worker.claimJob = original; resume = undefined;}
    } else if (message.method === 'continue') {
      assert.equal(typeof resume, 'function'); const resolve = resume; resume = undefined; resolve(); value = true;
    } else if (message.method === 'stop') {
      worker?.stop(); await database?.$disconnect();
      if (process.connected) process.send({id: message.id, pass: true, value: true}, () => process.exit(0));
      else process.exit(0);
      return;
    } else throw Error('UNKNOWN_OWNED_WORKER_COMMAND');
    send({id: message.id, pass: true, value});
  } catch (error) {
    // Never return connection strings, raw query data, keys or filesystem paths.
    send({id: message.id, pass: false, code: error?.code || error?.name || 'OWNED_WORKER_FAILURE'});
  }
});
