// No SQL business-state writes. The actual worker owns every claim, renewal,
// media transition and conditional completion; only its process is killed.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {fork} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const {assertContainer} = createRequire(import.meta.url)('./sj-disposable-guard.js');
const children = new Set();
process.once('disconnect', () => {for (const child of children) child.kill('SIGKILL');});

function launch(data, centralPath) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT',
      'USERPROFILE', 'DOCKER_HOST', 'DOCKER_CONTEXT'].includes(key)));
  const child = fork(fileURLToPath(new URL('./sj-real-central-worker-child.mjs', import.meta.url)), [], {
    cwd: data.proof.root, env, execArgv: ['--import', pathToFileURL(centralPath('node_modules/tsx/dist/loader.mjs')).href],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  });
  children.add(child); child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
  const pending = new Map(), events = new Map();
  const exited = new Promise(resolve => child.once('exit', (code, signal) => {
    children.delete(child);
    for (const item of pending.values()) {clearTimeout(item.timer); item.reject(Error('OWNED_SJ_WORKER_EXIT'));}
    pending.clear();
    for (const item of events.values()) {clearTimeout(item.timer); item.reject(Error('OWNED_SJ_WORKER_EXIT'));}
    events.clear(); resolve({pid: child.pid, code, signal});
  }));
  child.on('message', message => {
    if (message.event) {const item = events.get(message.event); if (item) {
      clearTimeout(item.timer); events.delete(message.event); item.resolve(message);
    } return;}
    const item = pending.get(message.id); if (!item) return;
    clearTimeout(item.timer); pending.delete(message.id);
    if (message.pass) item.resolve(message.value); else item.reject(Error('OWNED_SJ_WORKER_' + message.code));
  });
  const rpc = (method, data) => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {pending.delete(id); reject(Error('OWNED_SJ_WORKER_TIMEOUT')); child.kill('SIGKILL');}, 90000);
    pending.set(id, {resolve, reject, timer}); child.send({id, method, data}, error => {
      if (error) {clearTimeout(timer); pending.delete(id); reject(Error('OWNED_SJ_WORKER_IPC'));}
    });
  });
  const event = name => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {events.delete(name); reject(Error('OWNED_SJ_WORKER_EVENT_TIMEOUT'));}, 30000);
    events.set(name, {resolve, reject, timer});
  });
  return {child, exited, rpc, event, ready: rpc('init', data)};
}

export async function centralWorkerProof({load, centralPath, db, workerDb, worker, settings, sourceMediaId}) {
  assertContainer(settings.proof, settings.proof.pg); assertContainer(settings.proof, settings.proof.redis);
  assert.ok(settings.proof.scanner?.id);
  const {withInstitution} = await load(centralPath('apps/api/src/database.ts'));
  const read = callback => withInstitution(db.ingest, settings.institutionId, callback);
  const media = await read(tx => tx.mediaObject.findFirstOrThrow({where: {sourceMediaId, institutionId: settings.institutionId}}));
  assert.equal(media.state, 'PROCESSING'); assert.equal(media.originInstallationId, settings.instanceId);
  const job = await read(tx => tx.centralJob.findFirstOrThrow({where: {institutionId: settings.institutionId,
    jobType: 'PROCESS_MEDIA', payload: {path: ['media_id'], equals: media.id}}}));
  assert.equal(job.state, 'PENDING'); assert.equal(job.attemptCount, 0);
  const eligible = await workerDb.$queryRaw`
    SELECT id FROM central_jobs WHERE available_at<=clock_timestamp() AND
      (state IN ('PENDING','RETRY_WAIT') OR (state='PROCESSING' AND (lease_until IS NULL OR lease_until<clock_timestamp())))`;
  assert.deepEqual(eligible.map(row => row.id), [job.id], 'Create this probe only after draining other jobs');
  const data = {proof: settings.proof, centralRoot: centralPath(), databaseUrl: settings.cross.urls.worker,
    storageRoot: path.join(settings.proof.root, 'storage', 'central'), jobId: job.id};
  assert.equal(settings.storage.root, data.storageRoot);
  assert.equal(fs.lstatSync(data.storageRoot).isSymbolicLink(), false);
  const launched = [], cleanup = [], checks = [];
  const check = name => checks.push({check: name, pass: true, evidence: 'REAL_SERVICE_PROCESS'});
  try {
    const a = launch(data, centralPath), b = launch(data, centralPath); launched.push(a, b);
    const ready = await Promise.all([a.ready, b.ready]); assert.notEqual(ready[0].pid, ready[1].pid);
    const claims = await Promise.all([a.rpc('claim'), b.rpc('claim')]);
    assert.equal(claims.filter(Boolean).length, 1);
    const oldClaim = claims.find(Boolean), owner = claims[0] ? a : b;
    assert.equal(oldClaim.id, job.id); assert.equal(oldClaim.attempt_count, 1);
    const first = await read(tx => tx.centralJob.findUniqueOrThrow({where: {id: job.id}}));
    assert.equal(first.state, 'PROCESSING'); assert.equal(first.leaseToken, oldClaim.lease_token);
    assert.deepEqual(first.payload, job.payload);
    check('two actual SJ worker processes compete: one atomic claim, one lease and one attempt');
    owner.child.kill('SIGKILL'); cleanup.push(await owner.exited);
    for (const item of [a, b]) if (item !== owner) {await item.rpc('stop'); cleanup.push(await item.exited);}
    assert.equal((await read(tx => tx.mediaObject.findUniqueOrThrow({where: {id: media.id}}))).state, 'PROCESSING');
    let expired = false;
    for (let i = 0; i < 60; i++) {
      const rows = await workerDb.$queryRaw`SELECT lease_until<clock_timestamp() AS expired FROM central_jobs WHERE id=${job.id}::uuid`;
      if (rows[0]?.expired) {expired = true; break;} await delay(100);
    }
    assert.equal(expired, true); check('hard-killed owner leaves PROCESSING media; PostgreSQL clock proves actual lease expiry');
    const restarted = launch(data, centralPath); launched.push(restarted); const restartReady = await restarted.ready;
    assert.ok(ready.every(item => item.pid !== restartReady.pid));
    const claimed = restarted.event('claimed'), running = restarted.rpc('run');
    // Attach a handler immediately: an early child failure must not become an
    // unhandled rejection while waiting for its claim barrier.
    running.catch(() => {});
    const recovered = (await claimed).job;
    assert.equal(recovered.id, job.id); assert.equal(recovered.attempt_count, 2);
    assert.notEqual(recovered.lease_token, oldClaim.lease_token);
    assert.deepEqual(recovered.payload, oldClaim.payload);
    await restarted.rpc('continue'); const result = await running;
    assert.equal(result.ran, true); assert.equal(result.scanner, 'CLAMAV');
    await restarted.rpc('stop'); cleanup.push(await restarted.exited);
    const completed = await read(tx => tx.centralJob.findUniqueOrThrow({where: {id: job.id}}));
    const readyMedia = await read(tx => tx.mediaObject.findUniqueOrThrow({where: {id: media.id}}));
    assert.equal(completed.state, 'COMPLETED'); assert.equal(completed.attemptCount, 2); assert.equal(completed.leaseToken, null);
    assert.deepEqual(completed.payload, job.payload); assert.equal(completed.originInstallationId, settings.instanceId);
    assert.equal(readyMedia.state, 'READY'); assert.equal(readyMedia.scanResult, 'CLEAN');
    assert.ok(readyMedia.deliveryObjectKey && readyMedia.deliverySha256 && readyMedia.derivativeMetadata);
    assert.equal(await settings.storage.objectExists(readyMedia.deliveryObjectKey), true);
    check('restarted actual CentralWorker.runOnce reclaims with a new token and real ClamAV finishes READY exactly once');
    await assert.rejects(worker.complete(oldClaim), error => error.name === 'LeaseLostError');
    assert.deepEqual(await read(tx => tx.centralJob.findUniqueOrThrow({where: {id: job.id}})), completed);
    assert.deepEqual(await read(tx => tx.mediaObject.findUniqueOrThrow({where: {id: media.id}})), readyMedia);
    check('real conditional completion rejects the former owner and preserves completed job and READY media');
    return {checks, count: checks.length, jobId: job.id, attempts: 2, scanner: 'CLAMAV', cleanup,
      boundary: 'actual separately killed and restarted SJ CentralWorker processes; no SQL business-state fixture'};
  } finally {
    for (const item of launched) if (children.has(item.child)) {item.child.kill('SIGKILL'); await item.exited;}
  }
}
