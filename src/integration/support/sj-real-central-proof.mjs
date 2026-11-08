// IPC-only disposable proof. Positive state transitions use the real SJ HTTP
// ingest or OpsService; SQL below is an expected-denial RLS probe, never a seed.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {assertContainer} = require('./sj-disposable-guard.js');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// PEM whitespace is presentation, not identity. Compare decoded SPKI bytes so
// normalization remains valid while a different or malformed key still fails.
export function assertPublicKeyIdentity(actual, expected) {
  const spki = value => crypto.createPublicKey(value).export({type:'spki', format:'der'});
  assert.deepEqual(spki(actual), spki(expected));
}

function target(settings, origin) {
  const proof = settings?.proof;
  assert.equal(proof?.kind, 'RA-SJ-02-disposable-v1');
  assert.match(proof.runId, /^[0-9a-f]{32}$/);
  assert.match(proof.tokenHash, /^[0-9a-f]{64}$/);
  assertContainer(proof, proof.pg);
  assertContainer(proof, proof.redis);
  assert.match(settings.institutionId, UUID);
  assert.match(settings.instanceId, UUID);
  // settings.origin is assigned only after this peer binds its own loopback
  // server. A local hostname or a familiar port is not ownership evidence.
  assert.equal(typeof settings.origin, 'string');
  if (origin !== undefined) assert.equal(origin, settings.origin);
  const endpoint = new URL(settings.origin);
  assert.equal(endpoint.protocol, 'http:');
  assert.equal(endpoint.hostname, '127.0.0.1');
  assert.ok(endpoint.port);
  assert.equal(endpoint.pathname, '/');
  assert.equal(endpoint.search, '');
  assert.equal(endpoint.hash, '');
  assert.equal(endpoint.username, '');
  assert.equal(endpoint.password, '');
  return endpoint.origin;
}

async function leastPrivilege(db, settings) {
  for (const client of [db.ingest, db.ops]) {
    const rows = await client.$queryRaw`
      SELECT r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole,
        shobj_description(d.oid,'pg_database') AS marker
      FROM pg_roles r CROSS JOIN pg_database d
      WHERE r.rolname=current_user AND d.datname=current_database()`;
    assert.equal(rows.length, 1);
    for (const field of ['rolsuper', 'rolbypassrls', 'rolcreatedb', 'rolcreaterole']) assert.equal(rows[0][field], false);
    assert.equal(rows[0].marker, 'RA-SJ:' + settings.proof.tokenHash);
  }
}

async function readEvent(db, withInstitution, institutionId, eventId) {
  return withInstitution(db.ingest, institutionId, async tx => {
    const events = await tx.ingestEvent.findMany({where: {eventId}});
    assert.equal(events.length, 1);
    const event = events[0];
    const cursor = await tx.aggregateCursor.findUniqueOrThrow({where: {
      institutionId_aggregateId: {institutionId, aggregateId: event.aggregateId},
    }});
    const contact = event.aggregateType === 'WHATSAPP_CONTACT'
      ? await tx.whatsappContact.findUniqueOrThrow({where: {
        institutionId_sourceContactId: {institutionId, sourceContactId: event.aggregateId},
      }}) : null;
    return {event, cursor, contact};
  });
}

export async function eventProof({db, load, centralPath, settings, eventId}) {
  assert.match(eventId, UUID);
  assertContainer(settings.proof, settings.proof.pg);
  await leastPrivilege(db, settings);
  const {withInstitution} = await load(centralPath('apps/api/src/database.ts'));
  const {event, cursor, contact} = await readEvent(db, withInstitution, settings.institutionId, eventId);
  assert.equal(event.state, 'APPLIED');
  assert.equal(event.installationId, settings.instanceId);
  assert.ok(event.processedAt);
  assert.ok(cursor.aggregateVersion >= event.aggregateVersion);
  assert.equal(cursor.aggregateType, event.aggregateType);
  if (cursor.aggregateVersion === event.aggregateVersion) {
    assert.equal(cursor.payloadChecksum, event.payloadChecksum);
    if (contact) {
      assert.equal(contact.sourceVersion, event.aggregateVersion);
      assert.equal(contact.payloadChecksum, event.payloadChecksum);
      assert.equal(contact.state, event.eventType === 'REVOKE_WHATSAPP_CONTACT' ? 'REVOKED' : 'VERIFIED');
    }
  }
  return {count: 1, state: 'APPLIED', version: event.aggregateVersion, activeVersion: cursor.aggregateVersion,
    effect: contact ? 'contact-version-and-checksum' : 'aggregate-cursor-version-and-checksum'};
}

export async function centralProof({load, centralPath, db, settings, mode = 'startnegative', origin}) {
  assert.ok(['startnegative', 'before-clean'].includes(mode));
  assert.equal(settings.centralProofCompleted, undefined, 'Proof must execute only once per run');
  assert.equal(settings.ingestTransportFault ?? null, null, 'Clear the owned transport fault before this proof');
  const endpoint = target(settings, origin);
  await leastPrivilege(db, settings);
  const {withInstitution} = await load(centralPath('apps/api/src/database.ts'));
  const contract = await load(centralPath('packages/contracts/src/index.mjs'));
  const key = await db.ops.institutionKey.findFirstOrThrow({where: {
    institutionId: settings.institutionId, installationId: settings.instanceId, state: 'ACTIVE',
  }});
  assertPublicKeyIdentity(key.publicKey, settings.keys.bankPublicKey);
  const checks = [];
  const check = name => checks.push({check:name, pass:true, evidence:'REAL_SERVICE_API'});
  const send = async (event, identity = {}) => {
    contract.assertValidIntegrationEvent(event);
    const body = JSON.stringify(event), path = '/v1/ingest/events';
    const timestamp = new Date().toISOString(), nonce = crypto.randomBytes(24).toString('hex');
    const contentSha256 = contract.createContentSha256(body);
    const signature = contract.signIntegrationMessage(contract.createSigningMessage({
      method: 'POST', path, timestamp, nonce, contentSha256,
    }), identity.privateKey ?? settings.keys.bankPrivateKey);
    const headers = {'Content-Type': 'application/json'};
    for (const [field, value] of Object.entries({institutionId: identity.institutionId ?? settings.institutionId,
      keyId: identity.keyId ?? key.keyId, timestamp, nonce, contentSha256, signature})) {
      headers[contract.INTEGRATION_HEADERS[field]] = value;
    }
    const response = await fetch(endpoint + path, {method: 'POST', headers, body,
      redirect: 'error', signal: AbortSignal.timeout(15000)});
    return {status: response.status, body: await response.json()};
  };
  const contactEvent = (institutionId, aggregateId, version, templateVersion = version) => {
    const now = new Date().toISOString();
    const payload = {whatsapp_contact_id: aggregateId, institution_id: institutionId,
      phone_e164: '+6280000000000', status: 'VERIFIED', template_version: templateVersion, verified_at: now};
    return {event_id: crypto.randomUUID(), schema_version: 1, event_type: 'UPSERT_WHATSAPP_CONTACT',
      institution_id: institutionId, aggregate_id: aggregateId, aggregate_version: version,
      occurred_at: now, payload_checksum: contract.payloadChecksum(payload), payload};
  };
  const expectError = (response, status, code) => {
    assert.equal(response.status, status); assert.equal(response.body.code, code);
  };

  // A dedicated aggregate cannot replace the profile/contact used by the bank journey.
  const contactId = crypto.randomUUID(), first = contactEvent(settings.institutionId, contactId, 1);
  const concurrent = await Promise.all([send(first), send(first)]);
  assert.deepEqual(concurrent.map(r => r.status), [200, 200]);
  assert.deepEqual(concurrent.map(r => r.body.status).sort(), ['APPLIED', 'DUPLICATE']);
  const initial = await readEvent(db, withInstitution, settings.institutionId, first.event_id);
  assert.equal(initial.event.state, 'APPLIED'); assert.equal(initial.contact.sourceVersion, 1);
  const duplicate = await send(first);
  assert.equal(duplicate.status, 200); assert.equal(duplicate.body.status, 'DUPLICATE');
  assert.deepEqual(await readEvent(db, withInstitution, settings.institutionId, first.event_id), initial);
  check('real signed ingest: concurrent duplicate and retry preserve one ledger row and immutable contact effects');

  const conflicting = {...first, payload: {...first.payload, template_version: 9}};
  conflicting.payload_checksum = contract.payloadChecksum(conflicting.payload);
  expectError(await send(conflicting), 409, 'EVENT_ID_CONFLICT');
  const identityConflict = {...first, occurred_at: new Date(Date.parse(first.occurred_at) + 1).toISOString()};
  expectError(await send(identityConflict), 409, 'EVENT_ID_CONFLICT');
  assert.deepEqual(await readEvent(db, withInstitution, settings.institutionId, first.event_id), initial);
  check('real signed ingest: event-ID payload and occurred-at identity conflicts cannot change applied state');

  const latest = contactEvent(settings.institutionId, contactId, 3);
  assert.equal((await send(latest)).body.status, 'APPLIED');
  const latestState = await readEvent(db, withInstitution, settings.institutionId, latest.event_id);
  const stale = contactEvent(settings.institutionId, contactId, 2);
  expectError(await send(stale), 409, 'AGGREGATE_VERSION_CONFLICT');
  expectError(await send({...latest, event_id: crypto.randomUUID()}), 409, 'AGGREGATE_VERSION_CONFLICT');
  assert.equal(await withInstitution(db.ingest, settings.institutionId,
    tx => tx.ingestEvent.count({where: {eventId: stale.event_id}})), 0);
  assert.deepEqual(await readEvent(db, withInstitution, settings.institutionId, latest.event_id), latestState);
  const oldDuplicate = await send(first);
  assert.equal(oldDuplicate.body.status, 'DUPLICATE'); assert.equal(oldDuplicate.body.active_aggregate_version, 3);
  assert.deepEqual(await readEvent(db, withInstitution, settings.institutionId, latest.event_id), latestState);
  check('real signed ingest: out-of-order and fresh-ID same-version events are rejected; old duplicate cannot roll back v3');

  // The second tenant is registered by the official service, not by fixture SQL.
  const pair = crypto.generateKeyPairSync('ed25519'), otherKeyId = crypto.randomUUID();
  const other = await settings.ops.onboard({legal_name_internal: 'Owned negative tenant ' + settings.proof.runId,
    public_slug: 'proof-' + settings.proof.runId, installation_name: 'Owned negative installation',
    public_key: pair.publicKey.export({type: 'spki', format: 'pem'}).toString(), key_id: otherKeyId,
  }, settings.opsPrincipal, crypto.randomUUID());
  const otherId = other.subject_id, otherContactId = crypto.randomUUID();
  const otherEvent = contactEvent(otherId, otherContactId, 1);
  expectError(await send(otherEvent), 403, 'INSTITUTION_MISMATCH');
  expectError(await send(otherEvent, {institutionId: otherId}), 401, 'SIGNATURE_INVALID');
  const signedOther = {institutionId: otherId, keyId: otherKeyId, privateKey: pair.privateKey};
  const otherApplied = await send(otherEvent, signedOther);
  assert.equal(otherApplied.status, 200); assert.equal(otherApplied.body.status, 'APPLIED');
  assert.equal(await withInstitution(db.ingest, settings.institutionId,
    tx => tx.whatsappContact.count({where: {institutionId: otherId, sourceContactId: otherContactId}})), 0);
  assert.equal(await withInstitution(db.ingest, otherId,
    tx => tx.whatsappContact.count({where: {institutionId: otherId, sourceContactId: otherContactId}})), 1);
  assert.equal(await withInstitution(db.ingest, settings.institutionId,
    tx => tx.ingestEvent.count({where: {eventId: otherEvent.event_id}})), 0);
  check('real two-tenant signed HTTP: mismatched institution and foreign key rejected; ingest RLS hides the other tenant');

  const {Client} = createRequire(centralPath('package.json'))('pg');
  const url = new URL(settings.cross.urls.ingest);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(Number(url.port), settings.proof.pg.port);
  assert.equal(url.pathname, '/' + settings.cross.centralDb);
  const client = new Client({connectionString: url.href}), deniedCursor = crypto.randomUUID();
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_institution_id',$1,true)", [settings.institutionId]);
    // This is the sole write SQL probe and MUST fail with PostgreSQL RLS 42501.
    await assert.rejects(client.query(`INSERT INTO aggregate_cursors
      (id,institution_id,aggregate_type,aggregate_id,aggregate_version,expected_state,payload_checksum,updated_at)
      VALUES($1,$2,'WHATSAPP_CONTACT',$3,1,'VERIFIED',$4,now())`,
      [crypto.randomUUID(), otherId, deniedCursor, '0'.repeat(64)]), error => error.code === '42501');
  } finally { await client.query('ROLLBACK'); await client.end(); }
  assert.equal(await withInstitution(db.ingest, otherId,
    tx => tx.aggregateCursor.count({where: {aggregateId: deniedCursor}})), 0);
  check('actual non-superuser ingest role: cross-institution SQL write denied by RLS before any cursor is created');

  // Adapter-only fault inside the actual Prisma transaction; no app fault API,
  // no successful SQL state manipulation and no credentials/login bypass.
  const {OpsService} = await load(centralPath('apps/api/src/ops-service.ts'));
  const beforeInstitution = await db.ops.institution.findUniqueOrThrow({where: {id: otherId}});
  const requestId = crypto.randomUUID(); let auditFaults = 0;
  const ownedFault = Object.assign(Error('Owned SJ audit dependency fault'), {code: 'OWNED_SJ_AUDIT_FAULT'});
  const faultClient = new Proxy(db.ops, {get(object, property) {
    if (property === '$transaction') return (callback, options) => object.$transaction(tx => callback(new Proxy(tx, {
      get(transaction, field) {
        if (field === 'opsAuditLog') return new Proxy(transaction.opsAuditLog, {get(delegate, method) {
          if (method === 'create') return () => {auditFaults += 1; return Promise.reject(ownedFault);};
          const value = Reflect.get(delegate, method); return typeof value === 'function' ? value.bind(delegate) : value;
        }});
        const value = Reflect.get(transaction, field); return typeof value === 'function' ? value.bind(transaction) : value;
      },
    })), options);
    const value = Reflect.get(object, property); return typeof value === 'function' ? value.bind(object) : value;
  }});
  await assert.rejects(new OpsService({...db, ops: faultClient}).setInstitutionState(otherId, 'SUSPENDED',
    {reason_code: 'OWNED_PROOF_FAULT'}, settings.opsPrincipal, requestId), error => error === ownedFault);
  assert.equal(auditFaults, 1);
  assert.deepEqual(await db.ops.institution.findUniqueOrThrow({where: {id: otherId}}), beforeInstitution);
  assert.equal(await db.ops.opsAuditLog.count({where: {requestId}}), 0);
  assert.equal((await send(otherEvent, signedOther)).body.status, 'DUPLICATE');
  check('real OpsService transaction: audit adapter failure rolls back institution suspension and leaves signed ingest usable');

  settings.centralProofCompleted = true;
  return {mode, checks, count: checks.length, primaryEventId: first.event_id, latestEventId: latest.event_id,
    otherEventId: otherEvent.event_id, activeVersion: 3, auditFaults,
    boundary: 'real SJ signed HTTP, Prisma/PG runtime roles and OpsService; Ops service principal is not an Ops login test'};
}
