// Read-only assertions after legitimate bank -> Control -> SJ lifecycle actions.
// No SQL state writes, fixture transitions, normal runtime imports or fault API.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertPublicKeyIdentity} from './sj-real-central-proof.mjs';

const {assertContainer} = createRequire(import.meta.url)('./sj-disposable-guard.js');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const FIELDS = ['kind', 'sourceId', 'changeRequestId', 'commandId', 'commandDigest', 'commandPayload',
  'eventId', 'eventType', 'aggregateType', 'aggregateId', 'aggregateVersion', 'schemaVersion',
  'payloadChecksum', 'payload', 'keyId', 'publicMediaUrl'];

function validateExpected(expected) {
  assert.ok(expected && typeof expected === 'object' && !Array.isArray(expected));
  assert.ok(Object.keys(expected).every(key => FIELDS.includes(key)));
  assert.ok(['contact', 'media'].includes(expected.kind));
  for (const field of ['sourceId', 'changeRequestId', 'commandId', 'eventId', 'aggregateId', 'keyId']) {
    assert.match(expected[field], UUID);
  }
  for (const field of ['commandDigest', 'payloadChecksum']) assert.match(expected[field], HASH);
  assert.ok(Number.isSafeInteger(expected.aggregateVersion) && expected.aggregateVersion > 0);
  assert.equal(expected.schemaVersion, 1);
  assert.equal(expected.eventType, expected.kind === 'contact' ? 'REVOKE_WHATSAPP_CONTACT' : 'REVOKE_MEDIA');
  assert.equal(expected.aggregateType, expected.kind === 'contact' ? 'WHATSAPP_CONTACT' : 'MEDIA');
  assert.ok(expected.payload && typeof expected.payload === 'object' && !Array.isArray(expected.payload));
  assert.ok(Number.isFinite(Date.parse(expected.payload.revoked_at)));
  if (expected.kind === 'contact') {
    assert.equal(expected.aggregateId, expected.sourceId);
    assert.equal(expected.payload.whatsapp_contact_id, expected.sourceId);
    assert.equal(expected.publicMediaUrl, null);
  } else {
    assert.equal(expected.payload.media_id, expected.aggregateId);
    assert.equal(typeof expected.publicMediaUrl, 'string');
  }
}

async function verifyOwnedTargets({load, controlPath, db, settings}) {
  const proof = settings?.proof;
  assert.equal(proof?.kind, 'RA-SJ-02-disposable-v1');
  assert.match(proof.runId, /^[0-9a-f]{32}$/);
  assert.match(proof.tokenHash, HASH);
  assertContainer(proof, proof.pg);
  assertContainer(proof, proof.redis);
  for (const id of [settings.institutionId, settings.instanceId]) assert.match(id, UUID);
  const origin = new URL(settings.origin);
  assert.equal(origin.protocol, 'http:'); assert.equal(origin.hostname, '127.0.0.1');
  assert.ok(origin.port); assert.equal(origin.pathname, '/');
  for (const field of ['username', 'password', 'search', 'hash']) assert.equal(origin[field], '');
  const controlUrl = new URL(settings.cross.controlUrl);
  assert.equal(process.env.CONTROL_DATABASE_URL, settings.cross.controlUrl);
  assert.equal(controlUrl.hostname, '127.0.0.1');
  assert.equal(Number(controlUrl.port), proof.pg.port);
  assert.equal(controlUrl.pathname, '/' + settings.cross.controlDb);
  const {query} = await load(controlPath('src/server/database.ts'));
  const [controlRole] = await query(`SELECT current_database() AS db, current_user AS role,
    r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole,
    shobj_description(d.oid,'pg_database') AS marker
    FROM pg_roles r CROSS JOIN pg_database d
    WHERE r.rolname=current_user AND d.datname=current_database()`);
  assert.equal(controlRole.db, settings.cross.controlDb);
  assert.equal(controlRole.role, settings.cross.controlRole);
  assert.equal(controlRole.marker, 'RA-SJ:' + proof.tokenHash);
  for (const flag of ['rolsuper', 'rolbypassrls', 'rolcreatedb', 'rolcreaterole']) assert.equal(controlRole[flag], false);
  const [controlOwner] = await query(`SELECT count(*)::int AS n FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','control') AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)`);
  assert.equal(controlOwner.n, 0);
  for (const [scope, client] of [['ingest', db.ingest], ['ops', db.ops]]) {
    const url = new URL(settings.cross.urls[scope]);
    assert.equal(url.hostname, '127.0.0.1'); assert.equal(Number(url.port), proof.pg.port);
    assert.equal(url.pathname, '/' + settings.cross.centralDb);
    const roles = await client.$queryRaw`SELECT current_database() AS db, current_user AS role,
      r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole,
      EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owns_tables,
      shobj_description(d.oid,'pg_database') AS marker
      FROM pg_roles r CROSS JOIN pg_database d
      WHERE r.rolname=current_user AND d.datname=current_database()`;
    assert.equal(roles.length, 1); assert.equal(roles[0].db, settings.cross.centralDb);
    assert.equal(roles[0].role, url.username); assert.equal(roles[0].marker, 'RA-SJ:' + proof.tokenHash);
    for (const flag of ['rolsuper', 'rolbypassrls', 'rolcreatedb', 'rolcreaterole', 'owns_tables']) assert.equal(roles[0][flag], false);
  }
  return origin.origin;
}

export async function lifecycleProof({load, centralPath, controlPath, db, settings, actor, expected}) {
  validateExpected(expected);
  const origin = await verifyOwnedTargets({load, controlPath, db, settings});
  assert.ok(actor?.sessionId && actor.principal?.active && actor.principal?.sessionVerified);
  assert.equal(actor.principal.id, actor.operator.id);
  const controlContract = await load(controlPath('src/domain/control-review-contract.ts'));
  assert.equal(controlContract.payloadDigest(expected.commandPayload), expected.commandDigest);
  const {getReviewCommand} = await load(controlPath('src/server/review-adapter.ts'));
  const command = await getReviewCommand(settings.instanceId, expected.commandId);
  assert.ok(command); assert.equal(command.id, expected.commandId);
  assert.equal(command.instance_id, settings.instanceId); assert.equal(command.state, 'APPLIED');
  assert.equal(command.request_digest, expected.commandDigest);
  assert.deepEqual(command.request_payload, expected.commandPayload);
  assert.equal(command.request_payload.actor_subject, 'ruwang-control:' + actor.operator.id);
  assert.equal(command.request_payload.instance_id, settings.instanceId);
  assert.equal(command.request_payload.resource.kind, 'change_request');
  assert.equal(command.request_payload.resource.id, expected.changeRequestId);
  assert.equal(command.request_payload.decision, 'approve');
  assert.equal(command.acknowledgment_payload.status, 'APPLIED');
  assert.equal(command.acknowledgment_payload.command_id, expected.commandId);
  assert.equal(command.acknowledgment_payload.command_digest, expected.commandDigest);
  const key = await db.ops.institutionKey.findUniqueOrThrow({where:{keyId:expected.keyId}});
  assert.equal(key.institutionId, settings.institutionId);
  assert.equal(key.installationId, settings.instanceId); assert.equal(key.state, 'ACTIVE');
  assertPublicKeyIdentity(key.publicKey, settings.keys.bankPublicKey);
  const {withInstitution} = await load(centralPath('apps/api/src/database.ts'));
  const result = await withInstitution(db.ingest, settings.institutionId, async tx => {
    const events = await tx.ingestEvent.findMany({where:{eventId:expected.eventId}});
    assert.equal(events.length, 1);
    const event = events[0];
    assert.equal(event.state, 'APPLIED'); assert.ok(event.processedAt);
    assert.equal(event.institutionId, settings.institutionId);
    assert.equal(event.installationId, settings.instanceId); assert.equal(event.keyId, expected.keyId);
    assert.equal(event.eventType, expected.eventType); assert.equal(event.aggregateType, expected.aggregateType);
    assert.equal(event.aggregateId, expected.aggregateId); assert.equal(event.aggregateVersion, expected.aggregateVersion);
    assert.equal(event.schemaVersion, expected.schemaVersion); assert.equal(event.payloadChecksum, expected.payloadChecksum);
    assert.deepEqual(event.payload, expected.payload); assert.equal(event.payload.institution_id, settings.institutionId);
    const cursor = await tx.aggregateCursor.findUniqueOrThrow({where:{
      institutionId_aggregateId:{institutionId:settings.institutionId, aggregateId:event.aggregateId},
    }});
    assert.equal(cursor.aggregateType, event.aggregateType); assert.equal(cursor.aggregateVersion, event.aggregateVersion);
    assert.equal(cursor.payloadChecksum, event.payloadChecksum); assert.equal(cursor.expectedState, 'REVOKED');
    if (expected.kind === 'contact') {
      const contact = await tx.whatsappContact.findUniqueOrThrow({where:{
        institutionId_sourceContactId:{institutionId:settings.institutionId, sourceContactId:expected.sourceId},
      }});
      assert.equal(contact.institutionId, settings.institutionId); assert.equal(contact.state, 'REVOKED');
      assert.equal(contact.sourceVersion, event.aggregateVersion); assert.equal(contact.payloadChecksum, event.payloadChecksum);
      assert.equal(contact.revokedAt.toISOString(), event.payload.revoked_at);
    } else {
      const media = await tx.mediaObject.findFirstOrThrow({where:{id:event.aggregateId, institutionId:settings.institutionId}});
      assert.equal(media.id, event.payload.media_id); assert.equal(media.sourceMediaId, expected.sourceId);
      assert.equal(media.originInstallationId, settings.instanceId); assert.equal(media.state, 'REVOKED');
      assert.equal(media.revokedAt.toISOString(), event.payload.revoked_at);
      // MediaObject has no event version/checksum columns. The actual cursor
      // above proves those values; the binary sha256 is a different contract.
    }
    return {eventId:event.eventId, aggregateVersion:event.aggregateVersion};
  });
  if (expected.kind === 'media') {
    const publicUrl = new URL(expected.publicMediaUrl);
    assert.equal(publicUrl.origin, origin);
    assert.equal(publicUrl.pathname, '/v1/public/media/' + expected.aggregateId);
    for (const field of ['username', 'password', 'search', 'hash']) assert.equal(publicUrl[field], '');
    const response = await fetch(publicUrl.href, {redirect:'error', signal:AbortSignal.timeout(15000)});
    assert.equal(response.status, 404); await response.arrayBuffer();
  }
  return {check:expected.kind === 'contact'
    ? 'real SJ contact revocation: immutable Control/bank command lineage, exact APPLIED event/cursor/version/checksum and final REVOKED contact'
    : 'real SJ media revocation: immutable Control/bank command lineage, exact APPLIED event/cursor/version/checksum and final REVOKED media; previously public media URL is denied',
    pass:true, evidence:'REAL_SERVICE_READ', ...result,
    boundary:'Actor is proved by Control/bank command and immutable outbox lineage; SJ event has no actor field. Media version/checksum are cursor/event evidence, not invented MediaObject fields.'};
}
