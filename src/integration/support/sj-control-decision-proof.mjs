// Invoked only by the already-owned real cross-app peer, never an application route.
// No SQL business-state writes: decisions use actual handlers/services. SQL here
// only verifies ownership, immutable records and transaction rollback.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

export async function decisionProof({load, controlPath, settings, actor, kind, sourceId,
  phase = 'pending', reviewId = null}) {
  assert.ok(['pending', 'superseded'].includes(phase), 'Unsupported decision proof phase');
  assert.ok(settings?.proof?.runId && settings?.proof?.tokenHash && settings?.cross?.controlUrl);
  assert.equal(process.env.CONTROL_DATABASE_URL, settings.cross.controlUrl);
  const target = new URL(settings.cross.controlUrl);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(Number(target.port), settings.proof.pg.port);
  assert.equal(target.pathname, '/' + settings.cross.controlDb);
  const {query} = await load(controlPath('src/server/database.ts'));
  const [ownership] = await query(`SELECT current_database() AS db, current_user AS role,
    r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole,
    shobj_description(d.oid,'pg_database') AS marker
    FROM pg_roles r CROSS JOIN pg_database d
    WHERE r.rolname=current_user AND d.datname=current_database()`);
  assert.equal(ownership.db, settings.cross.controlDb);
  assert.equal(ownership.role, settings.cross.controlRole);
  assert.equal(ownership.marker, 'RA-SJ:' + settings.proof.tokenHash);
  for (const flag of ['rolsuper', 'rolbypassrls', 'rolcreatedb', 'rolcreaterole']) assert.equal(ownership[flag], false);
  const [ownedTables] = await query(`SELECT count(*)::int AS n FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','control') AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)`);
  assert.equal(ownedTables.n, 0);

  const auth = await load(controlPath('src/server/auth/service.ts'));
  const config = (await load(controlPath('src/lib/env.ts'))).getRuntimeConfig();
  const adapter = await load(controlPath('src/server/review-adapter.ts'));
  const reviews = await load(controlPath('src/server/reviews.ts'));
  const route = await load(controlPath('app/api/instances/[instanceId]/reviews/[reviewId]/decisions/route.ts'));
  const {NextRequest} = await load(controlPath('node_modules/next/server.js'));
  assert.ok(actor?.sessionId, 'A real authenticated Control actor is required');
  const rows = await query(`SELECT id::text FROM control.review_snapshots
    WHERE instance_id=$1 AND resource_kind=$2 AND source_id=$3 AND ($4::uuid IS NULL OR id=$4)
    ORDER BY source_version DESC, submitted_at DESC, id LIMIT 1`, [settings.instanceId, kind, sourceId, reviewId]);
  assert.equal(rows.length, 1, 'Actual bank snapshot must have arrived');
  const review = await reviews.getReviewDetail(actor.principal, rows[0].id);
  assert.equal(review.kind, kind);
  const sessions = [];
  const originalFetch = globalThis.fetch;
  const commandPath = '/api/v1/internal/ruwang-control/sj-review/commands';
  let dispatches = 0;
  globalThis.fetch = async (...args) => {
    const input = args[0];
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.pathname === commandPath) dispatches += 1;
    return originalFetch(...args);
  };
  try {
    for (const suffix of ['a', 'b']) {
      const username = 'decision-' + suffix + '-' + crypto.randomUUID();
      const password = 'Owned-A1!' + crypto.randomBytes(24).toString('hex');
      await auth.createOperator({actor, username, displayName:'Owned decision ' + suffix,
        password, requestId:crypto.randomUUID()});
      const login = await auth.loginOperator({username, password},
        {requestId:crypto.randomUUID(), ipHash:null, userAgentHash:null}, config);
      sessions.push({...login, csrf:await auth.rotateCsrfToken(login.session)});
      assert.deepEqual(login.session.principal.grants.map(grant => grant.role), ['internal_operator']);
    }
    assert.notEqual(sessions[0].session.operator.id, sessions[1].session.operator.id);
    assert.notEqual(sessions[0].session.sessionId, sessions[1].session.sessionId);
    // Different account/session IDs are not proof of two different humans.
    const base = {decision:'approve', reason:'Owned decision note',
      expectedVersion:review.sourceVersion, expectedChecksum:review.checksum};
    const call = async (who, body = base, key = crypto.randomUUID(), overrides = {}) => {
      const instanceId = overrides.instanceId ?? settings.instanceId;
      const id = overrides.reviewId ?? review.id;
      const request = new NextRequest(config.CONTROL_PUBLIC_ORIGIN + `/api/instances/${instanceId}/reviews/${id}/decisions`, {
        method:'POST', headers:{origin:config.CONTROL_PUBLIC_ORIGIN, 'content-type':'application/json',
          cookie:who ? 'control_session=' + who.token : '', 'x-csrf-token':who?.csrf ?? '',
          'idempotency-key':key, ...overrides.headers}, body:JSON.stringify(body),
      });
      const response = await route.POST(request, {params:Promise.resolve({instanceId, reviewId:id})});
      return {status:response.status, body:await response.json()};
    };
    const expect = async (result, status, code) => {
      assert.equal(result.status, status);
      if (code) assert.equal(result.body.error?.code, code);
    };
    const counters = async () => {
      const [counts] = await query(`SELECT
        (SELECT count(*)::int FROM control.review_commands WHERE snapshot_id=$1) AS commands,
        (SELECT count(*)::int FROM control.review_reasons WHERE snapshot_id=$1) AS reasons,
        (SELECT count(*)::int FROM control.review_dispatch_attempts a
          JOIN control.review_commands c ON c.id=a.command_id WHERE c.snapshot_id=$1) AS attempts`, [review.id]);
      return counts;
    };
    if (phase === 'superseded') {
      const newer = await query(`SELECT id FROM control.review_snapshots
        WHERE instance_id=$1 AND resource_kind=$2 AND source_id=$3 AND source_version>$4`,
      [settings.instanceId, kind, sourceId, review.sourceVersion]);
      assert.ok(newer.length > 0, 'Superseded proof requires a genuine newer bank snapshot');
      const before = await counters();
      await expect(await call(sessions[0]), 409, 'SNAPSHOT_SUPERSEDED');
      assert.deepEqual(await counters(), before);
      assert.equal(dispatches, 0);
      assert.equal((await reviews.getReviewDetail(actor.principal, review.id)).sourceVersion, review.sourceVersion);
      return {check:'real Control rejects a decision on an older bank snapshot without changing commands or dispatching',
        pass:true, reviewId:review.id, sourceVersion:review.sourceVersion, phase};
    }
    assert.equal(review.state, 'IN_REVIEW');
    assert.deepEqual(await counters(), {commands:0, reasons:0, attempts:0});
    await expect(await call(null), 401, 'SESSION_EXPIRED');
    await expect(await call(sessions[0], base, crypto.randomUUID(), {headers:{'x-csrf-token':''}}), 403, 'CSRF_REJECTED');
    await expect(await call(sessions[0], base, crypto.randomUUID(), {headers:{origin:'https://foreign.example.invalid'}}), 403, 'CSRF_REJECTED');
    await expect(await call(sessions[0], base, crypto.randomUUID(), {instanceId:crypto.randomUUID()}), 403, 'FORBIDDEN');
    await expect(await call(sessions[0], base, crypto.randomUUID(), {reviewId:crypto.randomUUID()}), 400, 'VALIDATION_FAILED');
    await expect(await call(sessions[0], {...base, operator_id:crypto.randomUUID()}), 400, 'VALIDATION_FAILED');
    await expect(await call(sessions[0], {...base, expectedVersion:review.sourceVersion + 1}), 409, 'VERSION_CONFLICT');
    const wrongChecksum = review.checksum === '0'.repeat(64) ? 'f'.repeat(64) : '0'.repeat(64);
    await expect(await call(sessions[0], {...base, expectedChecksum:wrongChecksum}), 409, 'VERSION_CONFLICT');
    await expect(await call(sessions[0], {...base, decision:'request_revision', reason:''}), 400, 'VALIDATION_FAILED');
    assert.equal(dispatches, 0);

    // Only the already-proved owned runtime connection is instrumented. The
    // actual transaction INSERTs its intent/reason, then fails its audit write;
    // the real withTransaction implementation must roll all of them back.
    const pool = globalThis.__ruwangControlPool;
    assert.ok(pool?.connect);
    const originalConnect = pool.connect;
    const clients = [];
    const faultRequestId = crypto.randomUUID(), faultCommandId = crypto.randomUUID();
    let auditFaults = 0;
    pool.connect = async function (...args) {
      const client = await originalConnect.apply(this, args);
      const originalQuery = client.query;
      clients.push({client, originalQuery});
      client.query = function (...queryArgs) {
        if (typeof queryArgs[0] === 'string' && /INSERT\s+INTO\s+control\.audit_events/i.test(queryArgs[0]) &&
            queryArgs[1]?.[1] === faultRequestId) {
          auditFaults += 1;
          return Promise.reject(Object.assign(Error('Owned test audit dependency fault'), {code:'OWNED_AUDIT_FAULT'}));
        }
        return originalQuery.apply(this, queryArgs);
      };
      return client;
    };
    try {
      await assert.rejects(adapter.enqueueReviewDecision({commandId:faultCommandId,
        instanceId:settings.instanceId, reviewId:review.id, ...base,
        requestId:faultRequestId, actor:sessions[0].session}), error => error.code === 'OWNED_AUDIT_FAULT');
    } finally {
      pool.connect = originalConnect;
      for (const {client, originalQuery} of clients) client.query = originalQuery;
    }
    assert.equal(auditFaults, 1);
    assert.deepEqual(await counters(), {commands:0, reasons:0, attempts:0});
    assert.equal((await query('SELECT id FROM control.audit_events WHERE request_id=$1', [faultRequestId])).length, 0);
    assert.equal((await reviews.getReviewDetail(actor.principal, review.id)).state, 'IN_REVIEW');
    assert.equal(dispatches, 0);

    const intents = [base, {...base, decision:'request_revision', reason:'Perbaiki catatan kontak dalam tes owned.'}];
    const keys = [crypto.randomUUID(), crypto.randomUUID()];
    const competing = await Promise.all(sessions.map((who, index) => call(who, intents[index], keys[index])));
    assert.equal(competing.filter(result => [200,202].includes(result.status)).length, 1);
    assert.equal(competing.filter(result => result.status === 409 && result.body.error?.code === 'DECISION_ALREADY_RECORDED').length, 1);
    const winnerIndex = competing.findIndex(result => [200,202].includes(result.status));
    const winner = sessions[winnerIndex], loser = sessions[1 - winnerIndex], intent = intents[winnerIndex];
    const commandId = competing[winnerIndex].body.data.commandId;
    assert.equal(competing[winnerIndex].body.data.state, 'APPLIED');
    assert.equal(dispatches, 1, 'One winning decision must issue one real signed bank request');
    assert.deepEqual(await counters(), {commands:1, reasons:1, attempts:1});
    const command = await adapter.getReviewCommand(settings.instanceId, commandId);
    assert.equal(command.state, 'APPLIED');
    assert.equal(command.request_payload.decision, intent.decision);
    assert.equal(command.request_payload.expected_version, review.sourceVersion);
    assert.equal(command.request_payload.expected_checksum, review.checksum);
    assert.equal(command.acknowledgment_payload.command_id, commandId);
    const replayed = await Promise.all([call(winner, intent, commandId), call(winner, intent, commandId), call(winner, intent)]);
    for (const result of replayed) {
      assert.ok([200,202].includes(result.status));
      assert.equal(result.body.data.commandId, commandId);
      assert.equal(result.body.data.state, 'APPLIED');
    }
    await expect(await call(winner, {...intent, reason:'Different intent'}, commandId), 409, 'IDEMPOTENCY_KEY_REUSED');
    await expect(await call(loser, intent, commandId), 409, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(dispatches, 1);
    assert.deepEqual(await counters(), {commands:1, reasons:1, attempts:1});
    await auth.revokeOperatorSessions({actor, instanceId:settings.instanceId,
      targetOperatorId:winner.session.operator.id, requestId:crypto.randomUUID()});
    await expect(await call(winner, intent, commandId), 401, 'SESSION_EXPIRED');
    await assert.rejects(adapter.enqueueReviewDecision({commandId, instanceId:settings.instanceId,
      reviewId:review.id, ...intent, requestId:crypto.randomUUID(), actor:winner.session}), error => error.code === 'SESSION_EXPIRED');
    return {check:'real Control decision handlers: two accounts compete once; same-ID and fresh-ID tab replays preserve one signed bank dispatch; auth/CSRF/scope/stale/checksum/intent/session negatives and audit-fault transaction rollback',
      pass:true, phase, commandId, reviewId:review.id, decision:intent.decision, state:'APPLIED',
      sourceVersion:review.sourceVersion, dispatches, auditFaults,
      boundary:'Actual Control route handlers in-process and real signed bank HTTP; not browser tabs or proof of different humans. Bank ledger count is verified by the caller.'};
  } finally {
    globalThis.fetch = originalFetch;
    for (const login of sessions) await auth.logoutOperator(login.session, crypto.randomUUID());
  }
}
