const test = require('node:test');
const assert = require('node:assert/strict');
const { assertCurrentSubmissionDependencies: check } = require('./submissionDependencies');
const current = () => ({profile_version_id:'profile-current',profile_version:{state:'APPROVED',profile:{state:'VERIFIED',current_version_id:'profile-current'}},
  whatsapp_contact_version_id:'contact-current',whatsapp_contact_version:{state:'VERIFIED',contact:{state:'VERIFIED',revoked_at:null,current_version_id:'contact-current'}}});

test('current approved profile and active current contact are accepted without mutation', () => {
  const input = current(), before = structuredClone(input);
  assert.doesNotThrow(() => check(input));assert.deepEqual(input, before);
});
test('older approved profile is rejected as a business conflict, not a driver error', () => {
  const input = current();input.profile_version_id = 'profile-previous';
  const before = structuredClone(input);
  assert.throws(() => check(input), e => e.statusCode === 409 && e.code === 'SJ_SUBMISSION_PROFILE_NOT_CURRENT');
  assert.deepEqual(input, before);
});
test('partial, hidden and unapproved profile never qualify as current', () => {
  for (const patch of [undefined, {state:'DRAFT',profile:{state:'VERIFIED',current_version_id:'profile-current'}},
    {state:'APPROVED',profile:{state:'HIDDEN',current_version_id:'profile-current'}}, {state:'APPROVED',profile:{state:'VERIFIED',current_version_id:null}}]) {
    assert.throws(() => check({...current(),profile_version:patch}), e => e.code === 'SJ_SUBMISSION_PROFILE_NOT_CURRENT');
  }
  assert.throws(() => check(null), e => e.code === 'SJ_SUBMISSION_PROFILE_NOT_CURRENT');
});
test('stale, revoked, missing or unverified contact is rejected without substituting another identity', () => {
  for (const patch of [undefined, {state:'DRAFT',contact:{state:'VERIFIED',current_version_id:'contact-current'}},
    {state:'VERIFIED',contact:{state:'VERIFIED',current_version_id:'contact-next'}},
    {state:'VERIFIED',contact:{state:'REVOKED',current_version_id:'contact-current'}},
    {state:'VERIFIED',contact:{state:'VERIFIED',revoked_at:new Date(),current_version_id:'contact-current'}}]) {
    assert.throws(() => check({...current(),whatsapp_contact_version:patch}), e => e.statusCode === 409 && e.code === 'SJ_SUBMISSION_CONTACT_NOT_CURRENT');
  }
});
