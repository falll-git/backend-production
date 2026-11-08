const test = require('node:test');
const assert = require('node:assert/strict');
const {withdrawalEligibility} = require('./publicationLifecycle');

test('withdrawal preserves the approved version while a replacement draft exists', () => {
  for (const state of ['DRAFT','REVISION_REQUIRED','APPROVED','PUBLISHED']) {
    assert.deepEqual(withdrawalEligibility({state,published_version_id:'approved-v1',current_version_id:'draft-v2'}),
      {eligible:true,reason:null});
  }
});

test('withdrawal is blocked during review, after withdrawal/archive, or without an approved version', () => {
  for (const state of ['IN_REVIEW','UNPUBLISHED','ARCHIVED','UNKNOWN']) {
    const result=withdrawalEligibility({state,published_version_id:'approved-v1'});
    assert.equal(result.eligible,false);
    assert.ok(result.reason.length>0);
  }
  assert.equal(withdrawalEligibility({state:'DRAFT',published_version_id:null}).eligible,false);
});
