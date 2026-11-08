// Service integration only. This file is never imported by normal application
// code. The caller supplies the already-owned bank/Control/SJ run and services.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { assertLive } = require('./sj-disposable-guard');

module.exports = async function realBankNegativeProof({
  proof, token, http, server, tokens, worker, rpc, reviewer, central, keys,
  actors, publicationId, mediaId,
}) {
  // No application import or request may precede the target/role guard.
  await assertLive(proof, process.env, token);
  assert.equal(central.instanceId, process.env.SJ_CONTROL_INSTANCE_ID);
  assert.notEqual(actors.maker.division_id, actors.outsider.division_id);
  const request = require('supertest');
  const { withRlsUserContext } = require('../../config/database-rls');
  const profileContact = require('../../modules/seputar-jaminan/profileContact.service');
  const transport = require('../../modules/seputar-jaminan/syncWorker.service');
  const contract = require('../../modules/seputar-jaminan/controlReview.contract');
  const prefix = '/api/v1/seputar-jaminan';
  const checks = [];
  const record = check => checks.push({ check, pass: true, evidence: 'REAL_SERVICE_API' });
  const phone = () => '+6288' + crypto.randomInt(100000000, 1000000000);
  const scope = callback => withRlsUserContext(actors.maker.id, callback);
  const snapshotRows = id => reviewer.sj_sync_outbox.findMany({
    where: { event_type: 'CONTROL_REVIEW_SNAPSHOT', aggregate_id: id },
    orderBy: { created_at: 'asc' },
  });
  const race = async (method, url, bodies) => {
    const responses = await Promise.all(bodies.map(body => request(server)[method](prefix + url)
      .set('Authorization', 'Bearer ' + tokens.maker).send(body)));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409],
      'exactly one concurrent versioned operation must succeed');
    return responses.find(response => response.status === 200).body.data;
  };

  // Contacts/profiles are shared within a bank. Do not invent division-private
  // contact semantics; use the actual publication RLS scope for this check.
  assert.ok(publicationId, 'an API-created publication is required for scope proof');
  const publication = await http('maker', 'get', `/publications/${publicationId}`);
  await http(null, 'get', `/publications/${publicationId}`, null, 401);
  await http('denied', 'get', `/publications/${publicationId}`, null, 403);
  await http('outsider', 'get', `/publications/${publicationId}`, null, 404);
  await http('outsider', 'patch', `/publications/${publicationId}/draft`, {
    expected_version: publication.lock_version, title: 'Perubahan di luar scope',
  }, 404);
  assert.equal((await http('outsider', 'get', '/publications?limit=100')).items.length, 0);
  assert.equal(await withRlsUserContext(actors.outsider.id, client =>
    client.sj_publications.count({ where: { id: publicationId } })), 0);
  await http('maker', 'post', `/publications/${publicationId}/approve-and-publish`, {
    expected_version: publication.lock_version,
  }, 403);
  assert.deepEqual(await http('maker', 'get', `/publications/${publicationId}`), publication);
  if (mediaId) {
    await http(null, 'get', `/media/${mediaId}/content`, null, 401);
    await http('denied', 'get', `/media/${mediaId}/content`, null, 403);
  }
  record('real bank HTTP/RLS: inaccessible publication returns 404 and no list/direct-RLS row; denied/anonymous and maker decision permission rejected without mutation (division scope, not another-bank proof)');

  const invalidId = crypto.randomUUID();
  await http('maker', 'post', `/contacts/save-operations/${invalidId}`, {
    intent: 'SAVE_AND_SUBMIT', draft: { label: 'Kontak tidak valid', phone_e164: 'invalid' },
  }, 422);
  assert.deepEqual(await http('maker', 'get', `/save-operations/${invalidId}`), {
    status: 'NOT_RECORDED', receipt: null,
  });
  const draftId = crypto.randomUUID();
  const draftBody = { intent: 'SAVE_DRAFT', draft: { label: 'Kontak uji konkurensi', phone_e164: phone() } };
  await http('denied', 'post', `/contacts/save-operations/${draftId}`, draftBody, 403);
  const receipts = await Promise.all([0, 1].map(() =>
    http('maker', 'post', `/contacts/save-operations/${draftId}`, draftBody)));
  assert.deepEqual(receipts[0], receipts[1]);
  const saved = receipts[0];
  assert.equal(saved.state, 'DRAFT');
  assert.equal(saved.intent, 'SAVE_DRAFT');
  assert.equal(await scope(client => client.sj_whatsapp_contact_versions.count({
    where: { contact_id: saved.resource_id },
  })), 1);
  let contact = await http('maker', 'get', `/contacts/${saved.resource_id}`);
  assert.equal(contact.pending_version.state, 'DRAFT');
  assert.equal((await snapshotRows(contact.pending_version.id)).length, 0,
    'saving a draft must not enqueue a review snapshot');
  assert.deepEqual(await http('checker', 'get', `/save-operations/${draftId}`), {
    status: 'NOT_RECORDED', receipt: null,
  });
  await http('maker', 'post', `/contacts/save-operations/${draftId}`, {
    ...draftBody, draft: { ...draftBody.draft, label: 'Intent berbeda' },
  }, 409);
  contact = await race('patch', `/contacts/${contact.id}/draft`, [0, 1].map(index => ({
    expected_version: contact.lock_version, label: `Sunting tab ${index + 1}`,
  })));
  contact = await race('post', `/contacts/${contact.id}/submit`, [0, 1].map(() => ({
    expected_version: contact.lock_version,
  })));
  const firstVersion = structuredClone(contact.pending_version);
  assert.equal(firstVersion.state, 'IN_REVIEW');
  assert.equal(firstVersion.version_number, 1);
  await http('maker', 'patch', `/contacts/${contact.id}/draft`, {
    expected_version: contact.lock_version, label: 'Tidak boleh mengubah snapshot',
  }, 409);
  await http('maker', 'post', `/contacts/${contact.id}/submit`, {
    expected_version: saved.lock_version,
  }, 409);
  await http('maker', 'post', `/contacts/${contact.id}/verify`, {
    expected_version: contact.lock_version,
  }, 403);
  await http('checker', 'post', `/contacts/${contact.id}/verify`, {
    expected_version: contact.lock_version,
  }, 409);
  assert.equal(await scope(client => client.sj_whatsapp_contact_versions.count({
    where: { contact_id: contact.id },
  })), 1);
  const originalSnapshots = await snapshotRows(firstVersion.id);
  assert.equal(originalSnapshots.length, 1);
  const originalSnapshot = originalSnapshots[0];
  assert.equal(originalSnapshot.payload_json.source_version, contact.lock_version);
  assert.equal(originalSnapshot.payload_json.payload_checksum, firstVersion.checksum);
  record('real bank atomic draft-only save, concurrent same-key receipt, actor-bound receipt, invalid input, changed intent, two edit tabs and two submit tabs; one immutable version/snapshot and stale/authority rejection');

  await worker();
  const firstReview = await rpc('prepare-review', { kind: 'contact', sourceId: contact.id });
  assert.equal(firstReview.reviewId, firstVersion.id);
  assert.equal(firstReview.sourceVersion, contact.lock_version);
  const settings = await reviewer.sj_integration_settings.findFirstOrThrow();
  const duplicateResults = await Promise.all([0, 1].map(() =>
    transport.deliverControlSnapshot(originalSnapshot, settings)));
  for (const result of duplicateResults) assert.equal(result.http_status, 202);
  assert.deepEqual(await rpc('prepare-review', { kind: 'contact', sourceId: contact.id }), firstReview);
  const storedSnapshot = (await snapshotRows(firstVersion.id))[0];
  assert.deepEqual(storedSnapshot.payload_json, originalSnapshot.payload_json);
  assert.equal(storedSnapshot.payload_checksum, originalSnapshot.payload_checksum);
  assert.equal((await snapshotRows(firstVersion.id)).length, 1);

  const revisionCommand = await rpc('decide', {
    kind: 'contact', sourceId: contact.id, decision: 'request_revision',
    reason: 'Perbaiki label kontak sesuai pemeriksaan.',
  });
  assert.equal(revisionCommand.state, 'APPLIED');
  contact = await http('maker', 'get', `/contacts/${contact.id}`);
  assert.equal(contact.pending_version.state, 'REVISION_REQUIRED');
  const revised = await http('maker', 'patch', `/contacts/${contact.id}/draft`, {
    expected_version: contact.lock_version, label: 'Kontak revisi yang benar',
  });
  await http('maker', 'post', `/contacts/${contact.id}/submit`, {
    expected_version: contact.lock_version,
  }, 409);
  contact = await http('maker', 'post', `/contacts/${contact.id}/submit`, {
    expected_version: revised.lock_version,
  });
  assert.equal(contact.pending_version.version_number, 2);
  assert.notEqual(contact.pending_version.id, firstVersion.id);
  assert.notEqual(contact.pending_version.checksum, firstVersion.checksum);
  await worker();
  const currentReview = await rpc('prepare-review', { kind: 'contact', sourceId: contact.id });
  assert.equal(currentReview.reviewId, contact.pending_version.id);
  assert.equal(currentReview.sourceVersion, contact.lock_version);
  assert.ok(currentReview.sourceVersion > firstReview.sourceVersion);
  const historicalReview = await rpc('review', firstReview);
  assert.equal(historicalReview.sourceVersion, firstReview.sourceVersion);
  assert.equal(historicalReview.state, 'REVISION_REQUIRED');
  // Replaying the identical old snapshot is idempotent, not a new submission.
  assert.equal((await transport.deliverControlSnapshot(originalSnapshot, settings)).http_status, 202);
  assert.deepEqual(await rpc('prepare-review', { kind: 'contact', sourceId: contact.id }), currentReview);
  // Signed adversarial envelopes are derived from genuine bank snapshots. Only
  // their in-memory transport copies change; no database snapshot/status edits.
  const stalePayload = { ...originalSnapshot.payload_json, snapshot_id: crypto.randomUUID() };
  await assert.rejects(transport.deliverControlSnapshot({
    ...originalSnapshot, aggregate_id: stalePayload.snapshot_id, payload_json: stalePayload,
    payload_checksum: contract.payloadDigest(stalePayload),
  }, settings), error => error.code === 'SNAPSHOT_STALE_OR_DUPLICATE_VERSION');
  const changedPayload = {
    ...originalSnapshot.payload_json,
    detail: { ...originalSnapshot.payload_json.detail, label: 'Snapshot ID dipakai ulang' },
  };
  await assert.rejects(transport.deliverControlSnapshot({
    ...originalSnapshot, payload_json: changedPayload,
    payload_checksum: contract.payloadDigest(changedPayload),
  }, settings), error => error.code === 'SNAPSHOT_ID_REUSED');
  assert.deepEqual(await rpc('prepare-review', { kind: 'contact', sourceId: contact.id }), currentReview);
  const approved = await rpc('decide', { kind: 'contact', sourceId: contact.id });
  assert.equal(approved.state, 'APPLIED');
  contact = await http('maker', 'get', `/contacts/${contact.id}`);
  assert.equal(contact.approved_version.id, currentReview.reviewId);
  assert.equal(contact.approved_version.version_number, 2);
  assert.equal(contact.approved_version.label, 'Kontak revisi yang benar');
  assert.equal((await rpc('review', firstReview)).sourceVersion, firstReview.sourceVersion);
  record('actual signed bank-to-Control duplicate ingress, historical replay, stale/out-of-order and reused-snapshot conflict; actual Control revision, bank correction/resubmit and version-2 application preserve version-1 snapshot');

  // Explicit test-only service adapter: throw AFTER the real submit has written
  // its version and outbox inside the save-operation transaction. The HTTP route
  // and PostgreSQL rollback remain genuine. No SQL status or fixture mutation.
  const faultId = crypto.randomUUID();
  const faultPhone = phone();
  const faultBody = { intent: 'SAVE_AND_SUBMIT', draft: {
    label: 'Kontak rollback setelah simpan', phone_e164: faultPhone,
  } };
  const originalSubmit = profileContact.submitContact;
  let faultReached = false;
  profileContact.submitContact = async (...args) => {
    const result = await originalSubmit(...args);
    if (result.phone_e164 !== faultPhone) return result;
    faultReached = true;
    throw new Error('OWNED_TEST_FAILURE_AFTER_SUBMISSION_WRITE');
  };
  try {
    await http('maker', 'post', `/contacts/save-operations/${faultId}`, faultBody, 500);
  } finally {
    profileContact.submitContact = originalSubmit;
  }
  assert.equal(faultReached, true);
  assert.equal(await scope(client => client.sj_whatsapp_contacts.count({
    where: { phone_e164: faultPhone },
  })), 0);
  assert.equal(await scope(client => client.sj_whatsapp_contact_versions.count({
    where: { phone_e164: faultPhone },
  })), 0);
  assert.equal(await reviewer.sj_sync_outbox.count({ where: {
    event_type: 'CONTROL_REVIEW_SNAPSHOT',
    payload_json: { path: ['detail', 'phone_e164'], equals: faultPhone },
  } }), 0);
  assert.deepEqual(await http('maker', 'get', `/save-operations/${faultId}`), {
    status: 'NOT_RECORDED', receipt: null,
  });
  const recovered = await http('maker', 'post', `/contacts/save-operations/${faultId}`, faultBody);
  assert.equal(recovered.state, 'IN_REVIEW');
  assert.deepEqual(await http('maker', 'post', `/contacts/save-operations/${faultId}`, faultBody), recovered);
  assert.equal(await scope(client => client.sj_whatsapp_contacts.count({
    where: { phone_e164: faultPhone },
  })), 1);
  record('real bank HTTP save/submit transaction rolls back contact, version, snapshot and receipt after explicit post-submit adapter failure; same operation recovers once without a duplicate');

  // Fail the immutable bank decision ledger finalization AFTER real application.
  // This valid signed negative receiver probe is a test issuer, not a second
  // real Control decision. The subsequent positive recovery uses real Control.
  await worker();
  const pending = await http('maker', 'get', `/contacts/${recovered.resource_id}`);
  const [pendingSnapshot] = await snapshotRows(pending.pending_version.id);
  assert.ok(pendingSnapshot);
  const now = new Date();
  const command = {
    contract_version: 1, command_id: crypto.randomUUID(), instance_id: central.instanceId,
    actor_subject: 'ruwang-control:' + crypto.randomUUID(), audience: process.env.SJ_CONTROL_AUDIENCE,
    resource: pendingSnapshot.payload_json.resource, decision: 'approve',
    contributor_subjects: pendingSnapshot.payload_json.contributor_subjects,
    expected_version: pendingSnapshot.payload_json.source_version,
    expected_checksum: pendingSnapshot.payload_json.payload_checksum,
    issued_at: now.toISOString(), expires_at: new Date(now.getTime() + 60000).toISOString(),
  };
  assert.equal(contract.validateCommand(command).valid, true);
  const commandPath = '/api/v1/internal/ruwang-control/sj-review/commands';
  const nonce = crypto.randomUUID(), timestamp = new Date().toISOString();
  const digest = contract.payloadDigest(command);
  const headers = {
    [contract.headerNames.instanceId]: central.instanceId,
    [contract.headerNames.keyId]: process.env.SJ_CONTROL_KEY_ID,
    [contract.headerNames.timestamp]: timestamp,
    [contract.headerNames.nonce]: nonce,
    [contract.headerNames.contentSha256]: digest,
    [contract.headerNames.signature]: contract.signTransport(contract.signingMessage({
      method: 'POST', path: commandPath, timestamp, nonce, contentSha256: digest,
    }), keys.controlPrivateKey),
  };
  const originalTransaction = reviewer.$transaction;
  let ledgerFaultReached = false;
  reviewer.$transaction = function (callback, ...options) {
    assert.equal(typeof callback, 'function', 'receiver must use an interactive transaction');
    return originalTransaction.call(this, client => callback(new Proxy(client, {
      get(target, property) {
        if (property === 'sj_control_review_commands') return new Proxy(target[property], {
          get(model, method) {
            if (method === 'update') return async input => {
              if (input.where.command_id === command.command_id) {
                ledgerFaultReached = true;
                assert.equal(input.data.status, 'APPLIED', 'fault must follow actual business application');
                throw new Error('OWNED_TEST_FAILURE_AT_BANK_COMMAND_AUDIT_COMMIT');
              }
              return model.update(input);
            };
            const value = Reflect.get(model, method);
            return typeof value === 'function' ? value.bind(model) : value;
          },
        });
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    })), ...options);
  };
  try {
    const response = await request(server).post(commandPath).set(headers).send(command);
    assert.equal(response.status, 500);
  } finally {
    reviewer.$transaction = originalTransaction;
  }
  assert.equal(ledgerFaultReached, true);
  assert.equal(await reviewer.sj_control_review_commands.count({
    where: { command_id: command.command_id },
  }), 0);
  assert.equal(await reviewer.sj_control_request_nonces.count({ where: { nonce } }), 0);
  assert.equal(await reviewer.sj_sync_outbox.count({
    where: { event_type: 'UPSERT_WHATSAPP_CONTACT', aggregate_id: pending.id },
  }), 0);
  const afterFailure = await http('maker', 'get', `/contacts/${pending.id}`);
  assert.equal(afterFailure.state, 'IN_REVIEW');
  assert.equal(afterFailure.lock_version, pending.lock_version);
  assert.deepEqual(afterFailure.pending_version, pending.pending_version);
  assert.equal(afterFailure.approved_version, null);
  const realCommand = await rpc('decide', { kind: 'contact', sourceId: pending.id });
  assert.equal(realCommand.state, 'APPLIED');
  assert.equal((await http('maker', 'get', `/contacts/${pending.id}`)).state, 'VERIFIED');
  assert.equal(await reviewer.sj_sync_outbox.count({
    where: { event_type: 'UPSERT_WHATSAPP_CONTACT', aggregate_id: pending.id },
  }), 1);
  record('real signed bank receiver rolls back application, outbox, nonce and command ledger on explicit audit-finalization adapter failure; valid real Control decision then applies once (negative request uses a test issuer, not a double bank/SJ)');
  return checks;
};
