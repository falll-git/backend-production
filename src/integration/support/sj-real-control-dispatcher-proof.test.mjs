// Pure tests of the same predicates used before child DB connection/dispatch.
// No Docker, DB, process spawning, application imports or business mutations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateControlTarget, validateBankOrigin, dispatcherCrashProof}
  from './sj-real-control-dispatcher-proof.mjs';

const runId = '1'.repeat(32);
const proof = {kind:'RA-SJ-02-disposable-v1', runId, tokenHash:'2'.repeat(64), pg:{port:45232}};
const cross = {controlDb:'ruwang_control_' + runId, controlRole:'ruwang_control_runtime_test',
  controlUrl:'postgresql://ruwang_control_runtime_test:synthetic@127.0.0.1:45232/ruwang_control_' + runId};
test('dispatcher guard accepts exact isolated Control endpoint', () => {
  assert.equal(validateControlTarget(proof,cross).pathname, '/' + cross.controlDb);
});
for (const [label, mutate] of [
  ['normal kind', pair => {pair[0].kind='normal';}],
  ['invalid owner id', pair => {pair[0].runId='not-an-owner';}],
  ['invalid proof digest', pair => {pair[0].tokenHash='invalid';}],
  ['privileged role', pair => {pair[1].controlRole='postgres';}],
  ['normal database', pair => {pair[1].controlDb='ruwang_control';}],
  ['remote hostname', pair => {pair[1].controlUrl=pair[1].controlUrl.replace('127.0.0.1','remote.example.invalid');}],
  ['wrong port', pair => {pair[1].controlUrl=pair[1].controlUrl.replace(':45232',':45233');}],
  ['wrong role', pair => {pair[1].controlUrl=pair[1].controlUrl.replace('runtime_test:','runtime_other:');}],
  ['query options', pair => {pair[1].controlUrl+='?options=unsafe';}],
  ['fragment', pair => {pair[1].controlUrl+='#unexpected';}],
  ['wrong scheme', pair => {pair[1].controlUrl=pair[1].controlUrl.replace('postgresql:','http:');}],
]) test('dispatcher refuses ' + label + ' before connecting', () => {
  const pair=structuredClone([proof,cross]);mutate(pair);
  assert.throws(() => validateControlTarget(...pair));
});
test('dispatcher guard accepts only explicit owned ephemeral bank origin shape', () => {
  assert.equal(validateBankOrigin('http://127.0.0.1:45234/'),'http://127.0.0.1:45234');
});
for (const value of ['https://127.0.0.1:45234/','http://localhost:45234/',
  'http://remote.example.invalid:45234/','http://127.0.0.1:4320/',
  'http://127.0.0.1:7111/','http://127.0.0.1:3111/','http://127.0.0.1:4411/',
  'http://127.0.0.1:80/','http://secret@127.0.0.1:45234/',
  'http://127.0.0.1:45234/other','http://127.0.0.1:45234/?x=1','http://127.0.0.1:45234/#x'])
  test('dispatcher bank origin rejects ' + value.replace('secret@','[synthetic]@'), () => {
    assert.throws(() => validateBankOrigin(value));
  });
test('invalid crash mode refuses before loading application modules', async () => {
  let loads=0;
  await assert.rejects(dispatcherCrashProof({mode:'unsupported', load(){loads++;throw Error('APP_IMPORT_FORBIDDEN');}}));
  assert.equal(loads,0);
});
