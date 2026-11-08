// Transaction-scoped locks only. Keep network calls outside these transactions.
// Advisory locks cover singleton creation/default-contact updates; row locks also
// coordinate with workers that update aggregates without using this helper.
async function lockProfile(client) {
  await lockContactReferences(client);
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ruwang:sj:profile-workflow'))`;
  await client.$queryRaw`SELECT id FROM public.sj_public_profiles ORDER BY id FOR UPDATE`;
}

async function lockContact(client, id) {
  await lockContactReferences(client);
  // Same order as set-default: advisory lock, then contact row(s).
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ruwang:sj:whatsapp-default'))`;
  await client.$queryRaw`SELECT id FROM public.sj_whatsapp_contacts WHERE id = ${id}::text FOR UPDATE`;
}

async function lockPublication(client, id) {
  await lockContactReferences(client);
  await client.$queryRaw`SELECT id FROM public.sj_publications WHERE id = ${id}::text FOR UPDATE`;
}

async function lockContactReferences(client) {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ruwang:sj:contact-references'))`;
}

async function lockChangeWorkflow(client) {
  // Same order for creation, resubmission and central decision: workflow,
  // request row, then its target. Avoid unique-insert vs target-row deadlocks.
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ruwang:sj:change-workflow'))`;
}

async function lockReviewResource(client, resource) {
  if (resource.kind === 'profile') return lockProfile(client);
  if (resource.kind === 'contact') return lockContact(client, resource.id);
  if (resource.kind === 'publication') return lockPublication(client, resource.id);
  if (resource.kind === 'change_request') {
    await lockChangeWorkflow(client);
    await client.$queryRaw`SELECT id FROM public.sj_control_change_requests WHERE id = ${resource.id}::uuid FOR UPDATE`;
  }
}

module.exports = { lockProfile, lockContact, lockPublication, lockReviewResource, lockChangeWorkflow, lockContactReferences };
