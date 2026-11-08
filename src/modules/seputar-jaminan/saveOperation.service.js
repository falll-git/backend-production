const { withDatabaseTransaction } = require('../../config/database-rls');
const { AppError } = require('../../utils/errors');
const { payloadDigest } = require('./controlReview.contract');
const profileContact = require('./profileContact.service');
const publications = require('./seputarJaminan.service');

const receipt = row => ({ operation_id: row.id, kind: row.kind, intent: row.intent,
  resource_id: row.resource_id, lock_version: row.lock_version, state: row.state,
  completed_at: new Date(row.completed_at).toISOString(), submission_error: row.submission_error || null });

async function find(client, id, actorId) {
  const rows = await client.$queryRaw`SELECT * FROM public.sj_save_operations WHERE id=${id}::uuid AND actor_id=${actorId}`;
  return rows[0] || null;
}

exports.read = (id, user) => withDatabaseTransaction(async client => {
  const row = await find(client, id, user.id);
  // Not recorded is not proof that an in-flight request failed.
  return row ? { status: 'COMPLETED', receipt: receipt(row) } : { status: 'NOT_RECORDED', receipt: null };
});

exports.execute = (kind, id, input, user) => withDatabaseTransaction(async client => {
  const checksum = payloadDigest({ kind, ...input });
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sj:save:${user.id}:${id}`},0))`;
  const existing = await find(client, id, user.id);
  if (existing) {
    if (existing.request_checksum !== checksum) throw new AppError('Permintaan ini sudah dipakai untuk perubahan lain.',409);
    return receipt(existing);
  }
  // Reuse this exact RLS transaction, never open nested independent commits.
  const transaction = callback => callback(client);
  const { resource_id: resourceId, draft, intent } = input;
  let saved;
  if (kind === 'PROFILE') saved = await profileContact.saveProfileDraft(draft,user,transaction);
  else if (kind === 'CONTACT') saved = resourceId
    ? await profileContact.updateContact(resourceId,draft,user,transaction)
    : await profileContact.createContact(draft,user,transaction);
  else saved = resourceId
    ? await publications.updatePublicationDraft(resourceId,draft,user,transaction)
    : await publications.createPublication(draft,user,transaction);
  let submissionError = null;
  if (intent === 'SAVE_AND_SUBMIT') {
    const command = { expected_version: saved.lock_version };
    if (kind === 'PROFILE') saved = await profileContact.submitProfile(command,user,transaction);
    else if (kind === 'CONTACT') saved = await profileContact.submitContact(saved.id,command,user,transaction);
    else {
      // New photos need a committed publication/media link before the worker
      // can process them. Keep that draft only for this explicit readiness case.
      await client.$executeRawUnsafe('SAVEPOINT sj_initial_submission');
      try { saved = await publications.submitPublication(saved.id,command,user,transaction); }
      catch (error) {
        await client.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sj_initial_submission');
        if (resourceId || error.code !== 'SJ_SUBMISSION_DEPENDENCIES_NOT_READY') throw error;
        submissionError = 'Foto atau data pendukung belum siap. Buka draf untuk memeriksa dan mengajukan kembali.';
      }
      await client.$executeRawUnsafe('RELEASE SAVEPOINT sj_initial_submission');
    }
  }
  const rows = await client.$queryRaw`INSERT INTO public.sj_save_operations
    (id,actor_id,kind,request_checksum,intent,resource_id,lock_version,state,submission_error)
    VALUES (${id}::uuid,${user.id},${kind},${checksum},${intent},${saved.id},${saved.lock_version},${saved.state},${submissionError}) RETURNING *`;
  return receipt(rows[0]);
}, { timeout: 15000 }).catch(error => {
  if (error.code === 'P2002') throw new AppError('Data ini sudah digunakan. Periksa data yang ada sebelum menyimpan kembali.',409);
  throw error;
});
