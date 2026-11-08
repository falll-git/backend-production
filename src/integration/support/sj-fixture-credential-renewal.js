// TEST SUPPORT ONLY. This renews credentials issued by the disposable fixture
// issuer; it is not an application login/refresh endpoint or a response retry.
const jwt = require('jsonwebtoken');

const ACTOR_NAMES = new Set(['maker', 'checker', 'denied', 'outsider', 'outsideChecker', 'browserMaker']);
const METADATA_NAMES = new Set(['collateralIds', 'performanceCollateralIds', 'step6CollateralIds', 'step6CollateralNumbers']);
const RENEWAL_RECEIPTS = Object.freeze({
  'before-production-performance':'fixture-credential-renewal.json',
  'before-lawful-performance-cleanup':'fixture-credential-renewal-cleanup.json',
  'before-step6-ui-extension':'fixture-credential-renewal-step6-before.json',
  'after-step6-main-inspection':'fixture-credential-renewal-step6-after.json',
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLAIM_NAMES = ['aud', 'exp', 'iat', 'id', 'iss', 'session_id'];
const TTL_SECONDS = 1800;

function fail(code) {
  throw new Error(code);
}

function fixtureRenewalReceiptName(reason) {
  if(!Object.hasOwn(RENEWAL_RECEIPTS,reason))fail('FIXTURE_TOKEN_RENEWAL_CONTEXT_INVALID');
  return RENEWAL_RECEIPTS[reason];
}

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('FIXTURE_TOKEN_INPUT_INVALID');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail('FIXTURE_TOKEN_INPUT_INVALID');
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string')) fail('FIXTURE_TOKEN_INPUT_INVALID');
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('FIXTURE_TOKEN_INPUT_INVALID');
  }
  return value;
}

function decodedToken(token) {
  if (typeof token !== 'string' || token.length > 8192 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
    fail('FIXTURE_TOKEN_INVALID');
  }
  let decoded;
  try { decoded = jwt.decode(token, {complete: true}); } catch { fail('FIXTURE_TOKEN_INVALID'); }
  if (!decoded || decoded.header.alg !== 'HS256' || decoded.header.typ !== 'JWT') fail('FIXTURE_TOKEN_INVALID');
  return decoded.payload;
}

function claimsMatch(claims, actor, now) {
  record(claims);
  if (Object.keys(claims).sort().join(',') !== CLAIM_NAMES.join(',') ||
      claims.id !== actor.id || claims.session_id !== actor.session_id ||
      claims.iss !== 'ruwang-arsip-api' || claims.aud !== 'ruwang-arsip-access' ||
      !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) ||
      claims.iat <= 0 || claims.iat > now || claims.exp - claims.iat !== TTL_SECONDS) {
    fail('FIXTURE_TOKEN_CLAIMS_INVALID');
  }
}

async function renewFixtureActorTokens({actors, tokens, assertOwned, generateAccessToken, verifyAccessToken, reason} = {}) {
  fixtureRenewalReceiptName(reason);
  if (typeof assertOwned !== 'function' ||
      typeof generateAccessToken !== 'function' || typeof verifyAccessToken !== 'function') {
    fail('FIXTURE_TOKEN_RENEWAL_CONTEXT_INVALID');
  }
  record(actors);
  record(tokens);
  const names = Object.keys(actors).filter(name => ACTOR_NAMES.has(name));
  if (!names.length || Object.keys(actors).some(name => !ACTOR_NAMES.has(name) && !METADATA_NAMES.has(name)) ||
      Object.keys(tokens).sort().join(',') !== [...names].sort().join(',')) fail('FIXTURE_TOKEN_ACTORS_INVALID');
  const identities = new Set();
  const sessions = new Set();
  const original = {};
  const expected = {};
  for (const name of names) {
    const actor = record(actors[name]);
    if (!UUID.test(actor.id) || !UUID.test(actor.session_id) || identities.has(actor.id) || sessions.has(actor.session_id) ||
        !Object.getOwnPropertyDescriptor(tokens, name).writable) fail('FIXTURE_TOKEN_ACTORS_INVALID');
    identities.add(actor.id);
    sessions.add(actor.session_id);
    expected[name] = {id: actor.id, session_id: actor.session_id};
    original[name] = tokens[name];
    claimsMatch(decodedToken(original[name]), expected[name], Math.floor(Date.now() / 1000));
  }

  // The caller proves ownership of the complete disposable run before minting.
  try { if (await assertOwned() === false) fail('FIXTURE_TOKEN_OWNERSHIP_DENIED'); }
  catch { fail('FIXTURE_TOKEN_OWNERSHIP_DENIED'); }
  let previousExpiredCount = 0;
  for (const name of names) {
    const token = original[name];
    const claims = decodedToken(token);
    try {
      const verified = await verifyAccessToken(token);
      claimsMatch(verified, expected[name], Math.floor(Date.now() / 1000));
      if (verified.exp <= Math.floor(Date.now() / 1000)) fail('FIXTURE_TOKEN_INVALID');
    } catch (error) {
      // jsonwebtoken checks signature/algorithm before reporting expiry. The
      // allowlisted decoded claims above also check issuer/audience/identity,
      // which its normal verifier checks only after expiry. No ignoreExpiration.
      if (!(error instanceof jwt.TokenExpiredError) || !(error.expiredAt instanceof Date) ||
          error.expiredAt.getTime() !== claims.exp * 1000 || claims.exp > Math.floor(Date.now() / 1000)) {
        fail('FIXTURE_TOKEN_INVALID');
      }
      previousExpiredCount++;
    }
  }

  const startedAt = Date.now();
  const renewed = {};
  for (const name of names) {
    let token;
    try { token = await generateAccessToken({...expected[name]}); }
    catch { fail('FIXTURE_TOKEN_ISSUER_FAILED'); }
    let verified;
    try {
      claimsMatch(decodedToken(token), expected[name], Math.floor(Date.now() / 1000));
      verified = await verifyAccessToken(token);
      claimsMatch(verified, expected[name], Math.floor(Date.now() / 1000));
      if (verified.iat < Math.floor(startedAt / 1000) || verified.exp <= Math.floor(Date.now() / 1000)) {
        fail('FIXTURE_TOKEN_FRESHNESS_INVALID');
      }
    } catch { fail('FIXTURE_TOKEN_FRESH_INVALID'); }
    renewed[name] = token;
  }
  // Reject changed/non-writable maps before the synchronous all-actor commit.
  record(tokens);
  if (Object.keys(tokens).sort().join(',') !== [...names].sort().join(',') || names.some(name =>
    tokens[name] !== original[name] || !Object.getOwnPropertyDescriptor(tokens, name).writable ||
    actors[name].id !== expected[name].id || actors[name].session_id !== expected[name].session_id)) {
    fail('FIXTURE_TOKEN_INPUT_CHANGED');
  }
  for (const name of names) tokens[name] = renewed[name];
  return {
    count: names.length,
    renewedAt: new Date().toISOString(),
    ttlSeconds: TTL_SECONDS,
    previousExpiredCount,
  };
}

module.exports = {renewFixtureActorTokens,fixtureRenewalReceiptName};
