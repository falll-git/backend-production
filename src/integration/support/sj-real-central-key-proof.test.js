const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

test('owned real-service key proof accepts normalized PEM only for the same decoded key', async () => {
  const {assertPublicKeyIdentity} = await import('./sj-real-central-proof.mjs');
  const pair = crypto.generateKeyPairSync('ed25519');
  const pem = pair.publicKey.export({type:'spki',format:'pem'}).toString();
  assertPublicKeyIdentity(pem.trim(), pem);
  assertPublicKeyIdentity(pem.replaceAll('\n','\r\n'), pem);
  const other = crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString();
  assert.throws(() => assertPublicKeyIdentity(other, pem), {code:'ERR_ASSERTION'});
  assert.throws(() => assertPublicKeyIdentity('not a key', pem));
  assert.throws(() => assertPublicKeyIdentity(pem, 'not a key'));
});
