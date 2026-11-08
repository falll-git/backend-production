// Disposable service-integration proof. Not an application route or normal
// runtime fallback; exported proof does not run merely by importing this file.
// The caller must supply an actual submitted bank contact and subsequently
// verify the bank command ledger/outbox independently. All positive transitions
// below use the real Control adapter; no business/lease status is written by SQL.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fork} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const self = fileURLToPath(import.meta.url);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const commandPath = '/api/v1/internal/ruwang-control/sj-review/commands';
const systemKeys = new Set(['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','DOCKER_HOST']);
const controlKeys = ['CONTROL_APP_ENV','CONTROL_RELEASE','CONTROL_DATABASE_URL',
  'CONTROL_DATABASE_NAME','CONTROL_DATABASE_RUNTIME_ROLE','CONTROL_PUBLIC_ORIGIN',
  'CONTROL_AUTH_ENCRYPTION_KEY','CONTROL_ENABLE_BANK_INTEGRATION',
  'CONTROL_BANK_SIGNING_KEY_ID','CONTROL_BANK_SIGNING_PRIVATE_KEY_FILE'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function validateControlTarget(proof, cross) {
  assert.equal(proof.kind, 'RA-SJ-02-disposable-v1');
  assert.match(proof.runId, /^[a-f0-9]{32}$/);
  assert.match(proof.tokenHash, /^[a-f0-9]{64}$/);
  assert.ok(Number.isInteger(proof.pg.port) && proof.pg.port > 1024 && proof.pg.port <= 65535);
  assert.equal(cross.controlDb, 'ruwang_control_' + proof.runId);
  assert.equal(cross.controlRole, 'ruwang_control_runtime_test');
  const target = new URL(cross.controlUrl);
  assert.equal(target.protocol, 'postgresql:');
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.port, String(proof.pg.port));
  assert.equal(target.pathname, '/' + cross.controlDb);
  assert.equal(decodeURIComponent(target.username), cross.controlRole);
  assert.equal(target.search, '');
  assert.equal(target.hash, '');
  return target;
}

export function validateBankOrigin(value) {
  const bank = new URL(value);
  assert.equal(bank.protocol, 'http:');
  assert.equal(bank.hostname, '127.0.0.1');
  assert.ok(Number(bank.port) > 1024 && !['3111','7111','4320','4411'].includes(bank.port));
  assert.equal(bank.pathname, '/');
  for (const field of ['username','password','search','hash']) assert.equal(bank[field], '');
  return bank.origin;
}

async function ownership(query, {proof, cross, instanceId}) {
  validateControlTarget(proof, cross);
  assert.match(instanceId, uuid);
  const [row] = await query(`SELECT current_database() AS db,current_user AS role,
    r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,
    shobj_description(d.oid,'pg_database') AS marker
    FROM pg_roles r CROSS JOIN pg_database d
    WHERE r.rolname=current_user AND d.datname=current_database()`);
  assert.equal(row.db, cross.controlDb);
  assert.equal(row.role, cross.controlRole);
  assert.equal(row.marker, 'RA-SJ:' + proof.tokenHash);
  for (const flag of ['rolsuper','rolbypassrls','rolcreatedb','rolcreaterole']) assert.equal(row[flag], false);
  const [tables] = await query(`SELECT count(*)::int AS n FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','control')
    AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)`);
  assert.equal(tables.n, 0);
  const [instance] = await query(`SELECT id::text,adapter_base_url,enabled,review_authority
    FROM control.instances WHERE id=$1`, [instanceId]);
  assert.equal(instance.id, instanceId);
  assert.equal(instance.enabled, true);
  assert.equal(instance.review_authority, 'central');
  return validateBankOrigin(instance.adapter_base_url);
}

function send(message) {
  return new Promise((resolve, reject) => {
    if (!process.connected || !process.send) return reject(Error('OWNED_IPC_REQUIRED'));
    process.send(message, error => error ? reject(error) : resolve());
  });
}

async function childMain(input) {
  assert.ok(process.send && process.connected, 'OWNED_IPC_REQUIRED');
  assert.equal(sha(fs.readFileSync(self)), input.sourceSha256);
  assert.ok(['before-send','after-response','cycle'].includes(input.mode));
  assert.equal(path.resolve(process.cwd()), path.resolve(input.proof.root));
  const bankRequire = createRequire(path.join(input.bankRoot, 'package.json'));
  assert.equal(bankRequire('./package.json').name, 'be-ruwang-arsip');
  const controlRequire = createRequire(path.join(input.controlRoot, 'package.json'));
  assert.equal(controlRequire('./package.json').name, 'ruwang-control');
  // This calls the current production test guard, including the parent-approved
  // Docker endpoint pin. The helper does not choose a Docker context itself.
  bankRequire('./src/integration/support/sj-disposable-guard').assertContainer(input.proof, input.proof.pg);
  assert.equal(fs.lstatSync(input.proof.root).isSymbolicLink(), false);
  assert.equal(fs.realpathSync(input.proof.root), path.resolve(input.proof.root));
  const owner = JSON.parse(fs.readFileSync(path.join(input.proof.root, 'owner.json'), 'utf8'));
  assert.equal(owner.runId, input.proof.runId);
  assert.equal(owner.tokenHash, input.proof.tokenHash);
  // Reject configuration before even a read-only connection is opened.
  validateControlTarget(input.proof, input.cross);
  const {Client} = bankRequire('pg');
  const client = new Client({connectionString:input.cross.controlUrl});
  await client.connect();
  let bankOrigin;
  try { bankOrigin = await ownership(async (sql, values) => (await client.query(sql, values)).rows, input); }
  finally { await client.end(); }
  assert.equal(bankOrigin, input.bankOrigin);
  for (const key of controlKeys) assert.ok(typeof input.env[key] === 'string' && input.env[key].length > 0, 'EXPLICIT_CONTROL_ENV_REQUIRED');
  assert.equal(input.env.CONTROL_DATABASE_URL, input.cross.controlUrl);
  assert.equal(input.env.CONTROL_DATABASE_NAME, input.cross.controlDb);
  assert.equal(input.env.CONTROL_DATABASE_RUNTIME_ROLE, input.cross.controlRole);
  assert.equal(input.env.CONTROL_APP_ENV, 'test');
  const privateFile = path.resolve(input.env.CONTROL_BANK_SIGNING_PRIVATE_KEY_FILE);
  assert.equal(privateFile, path.join(path.resolve(input.proof.root), 'tmp', 'control-key.pem'));
  assert.equal(fs.lstatSync(privateFile).isSymbolicLink(), false);
  Object.assign(process.env, input.env);
  await import(pathToFileURL(path.join(input.controlRoot, 'scripts/control-server-loader.mjs')).href);
  const actualFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async (request, options) => {
    const target = new URL(request instanceof Request ? request.url : request);
    assert.equal(target.origin, bankOrigin);
    assert.equal(target.pathname, commandPath);
    assert.equal(options?.method, 'POST');
    fetches += 1;
    assert.equal(fetches, 1, 'ONE_REAL_COMMAND_FETCH_ONLY');
    if (input.mode === 'before-send') {
      await send({phase:'claimed-before-send', commandId:input.commandId, fetches:0});
      await new Promise(() => {}); // Parent terminates this exact owned process.
    }
    const response = await actualFetch(request, options);
    if (input.mode === 'after-response') {
      assert.equal(response.status, 200);
      // Drain only a bounded cloned ACK. The actual adapter has not seen it yet.
      const reader = response.clone().body?.getReader();
      assert.ok(reader);
      let size = 0;
      const digest = crypto.createHash('sha256');
      try {
        for (;;) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength; assert.ok(size <= 65_536);
          digest.update(chunk.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      assert.ok(size > 0);
      await send({phase:'real-bank-response-before-local-ack', commandId:input.commandId,
        fetches, status:response.status, responseBytes:size, responseSha256:digest.digest('hex')});
      await new Promise(() => {});
    }
    return response;
  };
  const adapter = await import(pathToFileURL(path.join(input.controlRoot, 'src/server/review-adapter.ts')).href);
  await send({phase:'started', pid:process.pid, parentPid:process.ppid, sourceSha256:input.sourceSha256});
  if (input.mode === 'cycle') {
    const result = await adapter.runReviewDispatchCycle(input.instanceId);
    assert.equal(result.failed, 0);
    assert.equal(fetches, 0, 'UNKNOWN_MUST_NOT_BE_RESENT');
    await globalThis.__ruwangControlPool?.end();
    await send({phase:'cycle-complete', counts:result, fetches});
    process.__ownedDispatcherCompleted = true;
    process.disconnect();
  } else {
    await adapter.dispatchReviewCommand(input.commandId);
    throw Error('DISPATCH_CRASH_BARRIER_WAS_NOT_REACHED');
  }
}

function launch(input) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => systemKeys.has(key)));
  const spawnedAtUTC = new Date().toISOString();
  const child = fork(self, ['--owned-dispatcher-child'], {cwd:input.proof.root, env,
    execArgv:[], windowsHide:true, stdio:['ignore','pipe','pipe','ipc']});
  const stdout = crypto.createHash('sha256'), stderr = crypto.createHash('sha256');
  let stdoutBytes = 0, stderrBytes = 0, finished = false;
  const messages = [], waiters = new Set();
  child.stdout.on('data', value => {stdoutBytes += value.length; stdout.update(value);});
  child.stderr.on('data', value => {stderrBytes += value.length; stderr.update(value);});
  child.on('message', value => {
    assert.ok(value && typeof value.phase === 'string');
    messages.push(value);
    for (const waiter of waiters) waiter();
  });
  let closeResult;
  const closed = new Promise(resolve => {
    child.once('error', () => {});
    child.once('close', (code, signal) => {
      finished = true;
      closeResult = {pid:child.pid, spawnedAtUTC, closedAtUTC:new Date().toISOString(),
        code, signal, stdoutBytes, stderrBytes,
        stdoutSha256:stdout.digest('hex'), stderrSha256:stderr.digest('hex'), messages};
      for (const waiter of waiters) waiter();
      resolve(closeResult);
    });
  });
  const until = async (predicate, maximumMs) => {
    const deadline = Date.now() + maximumMs;
    for (;;) {
      const found = messages.find(predicate); if (found) return found;
      const failure = messages.find(message => message.phase === 'failed');
      if (failure) throw Error('OWNED_DISPATCHER_CHILD_' + failure.code);
      assert.equal(finished, false, 'OWNED_DISPATCHER_EXITED_BEFORE_BARRIER');
      const left = deadline - Date.now(); assert.ok(left > 0, 'OWNED_DISPATCHER_BARRIER_TIMEOUT');
      await new Promise(resolve => {
        const timer = setTimeout(done, Math.min(left, 250));
        function done() { clearTimeout(timer); waiters.delete(done); resolve(); }
        waiters.add(done);
      });
    }
  };
  child.send(input, error => { if (error && !finished) child.kill('SIGKILL'); });
  const waitClosed = async (maximumMs = 10_000) => {
    let timer;
    try {
      return await Promise.race([closed, new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Error('OWNED_CHILD_DID_NOT_CLOSE')), maximumMs);
      })]);
    } finally { clearTimeout(timer); }
  };
  return {child, closed, until, waitClosed, async stop() {
    if (!finished) assert.equal(child.kill('SIGKILL'), true, 'OWNED_CHILD_TERMINATION_FAILED');
    return waitClosed();
  }};
}

export async function dispatcherCrashProof({load, controlPath, bankPath, settings, actor,
  sourceId, mode}) {
  assert.ok(['before-send','after-response'].includes(mode));
  assert.match(sourceId, uuid);
  assert.ok(actor?.sessionId, 'REAL_AUTHENTICATED_CONTROL_ACTOR_REQUIRED');
  assert.equal(process.env.CONTROL_DATABASE_URL, settings.cross.controlUrl);
  createRequire(bankPath('package.json'))('./src/integration/support/sj-disposable-guard')
    .assertContainer(settings.proof, settings.proof.pg);
  const {query} = await load(controlPath('src/server/database.ts'));
  const bankOrigin = await ownership(query, settings);
  const adapter = await load(controlPath('src/server/review-adapter.ts'));
  const reviews = await load(controlPath('src/server/reviews.ts'));
  const rows = await query(`SELECT id::text FROM control.review_snapshots
    WHERE instance_id=$1 AND resource_kind='contact' AND source_id=$2
    ORDER BY source_version DESC,submitted_at DESC,id LIMIT 1`, [settings.instanceId, sourceId]);
  assert.equal(rows.length, 1, 'GENUINE_BANK_SUBMISSION_REQUIRED');
  const review = await reviews.getReviewDetail(actor.principal, rows[0].id);
  assert.equal(review.state, 'IN_REVIEW');
  assert.equal(review.kind, 'contact');
  assert.equal((await query(`SELECT id FROM control.review_commands WHERE snapshot_id=$1`, [review.id])).length, 0);
  const commandId = crypto.randomUUID();
  await adapter.enqueueReviewDecision({commandId, instanceId:settings.instanceId, reviewId:review.id,
    actor, decision:'approve', reason:'Owned real dispatcher crash proof',
    expectedVersion:review.sourceVersion, expectedChecksum:review.checksum, requestId:crypto.randomUUID()});
  assert.equal((await adapter.getReviewCommand(settings.instanceId, commandId)).state, 'PENDING');
  assert.equal((await query(`SELECT id FROM control.review_commands WHERE instance_id=$1 AND state='PENDING'`, [settings.instanceId])).length, 1);
  const env = Object.fromEntries(controlKeys.map(key => [key, process.env[key]]));
  const input = {proof:settings.proof, cross:{controlUrl:settings.cross.controlUrl,
    controlDb:settings.cross.controlDb, controlRole:settings.cross.controlRole},
  instanceId:settings.instanceId, commandId, bankOrigin, env, mode,
  bankRoot:bankPath(), controlRoot:controlPath(), sourceSha256:sha(fs.readFileSync(self))};
  const spawned = launch(input);
  let crash, restarted;
  try {
    const started = await spawned.until(message => message.phase === 'started', 20_000);
    assert.equal(started.pid, spawned.child.pid); assert.equal(started.parentPid, process.pid);
    assert.equal(started.sourceSha256, input.sourceSha256);
    const barrier = await spawned.until(message => message.phase === (mode === 'before-send'
      ? 'claimed-before-send' : 'real-bank-response-before-local-ack'), 20_000);
    assert.equal(barrier.commandId, commandId);
    const [claimed] = await query(`SELECT state,dispatch_count,dispatch_attempt_id::text,
      lease_expires_at,clock_timestamp() AS db_now FROM control.review_commands WHERE id=$1`, [commandId]);
    assert.equal(claimed.state, 'DISPATCHING'); assert.equal(claimed.dispatch_count, 1);
    assert.match(claimed.dispatch_attempt_id, uuid);
    assert.ok(Date.parse(claimed.lease_expires_at) > Date.parse(claimed.db_now));
    crash = await spawned.stop();
    assert.ok(crash.code !== 0 || crash.signal !== null, 'ACTUAL_NONZERO_OR_SIGNAL_REQUIRED');
    assert.equal((await adapter.getReviewCommand(settings.instanceId, commandId)).state, 'DISPATCHING');
    const deadline = Date.now() + 90_000;
    for (;;) {
      const [lease] = await query(`SELECT lease_expires_at <= clock_timestamp() AS expired
        FROM control.review_commands WHERE id=$1`, [commandId]);
      if (lease.expired === true) break;
      assert.ok(Date.now() < deadline, 'REAL_CONTROL_LEASE_EXPIRY_TIMEOUT');
      await pause(250);
    }
    // A fresh actual process resumes the dispatcher. No synthetic future clock.
    const recovery = launch({...input, mode:'cycle'});
    try {
      const start = await recovery.until(message => message.phase === 'started', 20_000);
      assert.equal(start.pid, recovery.child.pid); assert.equal(start.parentPid, process.pid);
      assert.equal(start.sourceSha256, input.sourceSha256);
      restarted = await recovery.until(message => message.phase === 'cycle-complete', 20_000);
      const close = await recovery.waitClosed();
      assert.equal(close.code, 0); assert.equal(close.signal, null);
      assert.equal(restarted.fetches, 0); assert.equal(restarted.counts.recovered, 1);
      restarted = {...restarted, close};
    } finally { await recovery.stop(); }
    assert.equal((await adapter.getReviewCommand(settings.instanceId, commandId)).state, 'UNKNOWN');
    const attempts = await query(`SELECT id::text,state FROM control.review_dispatch_attempts
      WHERE command_id=$1`, [commandId]);
    assert.deepEqual(attempts, [{id:claimed.dispatch_attempt_id, state:'UNKNOWN'}]);
    const reconciled = await adapter.reconcileReviewCommand({instanceId:settings.instanceId,
      commandId, actor, requestId:crypto.randomUUID()});
    assert.equal(reconciled.state, mode === 'before-send' ? 'UNKNOWN' : 'APPLIED');
    if (mode === 'before-send') assert.equal(reconciled.resultCode, 'COMMAND_NOT_RECORDED');
    assert.deepEqual(await query(`SELECT id::text,state FROM control.review_dispatch_attempts
      WHERE command_id=$1`, [commandId]), attempts);
    assert.equal((await query('SELECT dispatch_count FROM control.review_commands WHERE id=$1', [commandId]))[0].dispatch_count, 1);
    return {check:'actual Control dispatcher child termination, real lease expiry, fresh-process recovery and signed real-bank ledger reconciliation',
      pass:true, mode, sourceId, reviewId:review.id, sourceVersion:review.sourceVersion,
      commandId, state:reconciled.state, crash, restarted,
      boundary:'Actual Control adapter and bank HTTP, not a bank test double. Caller must separately assert the bank ledger/outbox and subsequent SJ outcome. No browser/login UI or two-human guarantee.'};
  } finally { await spawned.stop(); }
}

if (process.argv.includes('--owned-dispatcher-child')) {
  if (!process.send || !process.connected) throw Error('OWNED_IPC_REQUIRED');
  process.once('disconnect', () => { if (!process.__ownedDispatcherCompleted) process.exit(1); });
  process.once('message', input => {
    childMain(input).catch(async error => {
      await globalThis.__ruwangControlPool?.end().catch(() => {});
      const candidate = error?.code || error?.message;
      const code = typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(candidate)
        ? candidate : 'OWNED_DISPATCHER_PROOF_FAILED';
      await send({phase:'failed', code}).catch(() => {});
      process.exitCode = 1;
      process.disconnect();
    });
  });
}

