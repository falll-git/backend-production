const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jsonwebtoken = require('jsonwebtoken');
const jwt = require('../../utils/jwt');
const {renewFixtureActorTokens,fixtureRenewalReceiptName} = require('./sj-fixture-credential-renewal');

async function withFixture(callback) {
  const original = {JWT_SECRET: process.env.JWT_SECRET, JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN};
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
  process.env.JWT_EXPIRES_IN = '30m';
  try {
    const actors = Object.fromEntries(['maker', 'checker', 'denied', 'outsider', 'outsideChecker', 'browserMaker'].map(name => [name, {
      id: crypto.randomUUID(), session_id: crypto.randomUUID(), role_id: crypto.randomUUID(), division_id: crypto.randomUUID(),
    }]));
    actors.collateralIds = {LAND: crypto.randomUUID()};
    actors.performanceCollateralIds = [crypto.randomUUID()];
    const tokens = Object.fromEntries(Object.entries(actors).filter(([, actor]) => actor.id).map(([name, actor]) => [name,
      jwt.generateAccessToken({id: actor.id, session_id: actor.session_id, iat: Math.floor(Date.now() / 1000) - 60}),
    ]));
    let mintCount = 0;
    let ownedCount = 0;
    const payloads = [];
    const options = {
      actors, tokens, reason: 'before-production-performance',
      assertOwned: async () => { ownedCount++; },
      generateAccessToken: payload => { mintCount++; payloads.push({...payload}); return jwt.generateAccessToken(payload); },
      verifyAccessToken: jwt.verifyAccessToken,
    };
    await callback({actors, tokens, options, payloads, minted: () => mintCount, owned: () => ownedCount});
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

function unchanged(tokens, original) {
  assert.equal(Object.keys(tokens).every(name => tokens[name] === original[name]), true, 'token map must stay unchanged');
}

test('owned fixture renewal keeps identity, session, scope and normal 1800-second TTL', async () => withFixture(async fixture => {
  const {actors, tokens, options, payloads} = fixture;
  const before = JSON.stringify(actors);
  const result = await renewFixtureActorTokens(options);
  assert.equal(fixture.owned(), 1);
  assert.equal(fixture.minted(), 6);
  assert.equal(JSON.stringify(actors) === before, true, 'actor permissions and metadata stay intact');
  assert.deepEqual(Object.keys(result).sort(), ['count', 'previousExpiredCount', 'renewedAt', 'ttlSeconds']);
  assert.equal(result.count, 6);
  assert.equal(result.previousExpiredCount, 0);
  assert.equal(result.ttlSeconds, 1800);
  assert.equal(Number.isFinite(Date.parse(result.renewedAt)), true);
  for (const [index, name] of Object.keys(tokens).entries()) {
    assert.deepEqual(Object.keys(payloads[index]).sort(), ['id', 'session_id']);
    assert.equal(payloads[index].id === actors[name].id && payloads[index].session_id === actors[name].session_id, true);
    const claims = jwt.verifyAccessToken(tokens[name]);
    assert.equal(claims.id === actors[name].id && claims.session_id === actors[name].session_id, true);
    assert.equal(claims.exp - claims.iat, 1800);
    assert.deepEqual(Object.keys(claims).sort(), ['aud', 'exp', 'iat', 'id', 'iss', 'session_id']);
  }
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(process.env.JWT_SECRET) || Object.values(tokens).some(token => serialized.includes(token)) ||
    Object.values(actors).some(actor => actor.id && serialized.includes(actor.id)), false, 'report contains no credentials or actor identifiers');
}));

test('expired fixture token remains rejected normally; renewal mints same actor without extending TTL', async () => withFixture(async fixture => {
  const {actors, tokens, options} = fixture;
  tokens.maker = jwt.generateAccessToken({id: actors.maker.id, session_id: actors.maker.session_id, iat: Math.floor(Date.now() / 1000) - 1801});
  const expired = tokens.maker;
  assert.throws(() => jwt.verifyAccessToken(expired), error => error instanceof jsonwebtoken.TokenExpiredError);
  const result = await renewFixtureActorTokens(options);
  assert.equal(result.previousExpiredCount, 1);
  assert.throws(() => jwt.verifyAccessToken(expired), error => error instanceof jsonwebtoken.TokenExpiredError);
  const claims = jwt.verifyAccessToken(tokens.maker);
  assert.equal(claims.id === actors.maker.id && claims.session_id === actors.maker.session_id, true);
  assert.equal(claims.exp - claims.iat, 1800);
}));

test('explicit post-measurement lifecycle boundary preserves normal claims and TTL without retrying a failed response', async () => withFixture(async fixture => {
  fixture.options.reason='before-lawful-performance-cleanup';
  const result=await renewFixtureActorTokens(fixture.options);
  assert.equal(fixture.owned(),1);assert.equal(result.ttlSeconds,1800);
  for(const [name,token] of Object.entries(fixture.tokens)){
    const claims=jwt.verifyAccessToken(token);
    assert.equal(claims.id,fixture.actors[name].id);assert.equal(claims.session_id,fixture.actors[name].session_id);
    assert.equal(claims.exp-claims.iat,1800);
  }
}));

test('Step6 source metadata and explicit UI boundaries preserve identity and 1800-second TTL', async () => withFixture(async fixture => {
  fixture.actors.step6CollateralIds={LAND:crypto.randomUUID()};
  fixture.actors.step6CollateralNumbers={LAND:'SJ-'+crypto.randomBytes(16).toString('hex')+'-UI-LAND'};
  const before=JSON.stringify(fixture.actors);
  for(const reason of ['before-step6-ui-extension','after-step6-main-inspection']){
    fixture.options.reason=reason;
    const result=await renewFixtureActorTokens(fixture.options);
    assert.equal(result.ttlSeconds,1800);assert.equal(JSON.stringify(fixture.actors),before);
  }
}));

test('renewal boundary receipts are distinct and an auth-error retry is refused',()=>{
 const reasons=['before-production-performance','before-lawful-performance-cleanup','before-step6-ui-extension','after-step6-main-inspection'];
 assert.equal(new Set(reasons.map(fixtureRenewalReceiptName)).size,4);
 assert.throws(()=>fixtureRenewalReceiptName('on-http-401'),/CONTEXT_INVALID/);
 assert.throws(()=>fixtureRenewalReceiptName('toString'),/CONTEXT_INVALID/);
});

test('ownership guard finishes before any mint, including when asynchronous', async () => withFixture(async fixture => {
  let owned = false;
  fixture.options.assertOwned = async () => { await Promise.resolve(); owned = true; };
  const originalMint = fixture.options.generateAccessToken;
  fixture.options.generateAccessToken = payload => { assert.equal(owned, true); return originalMint(payload); };
  await renewFixtureActorTokens(fixture.options);
}));

for (const denied of ['returns false', 'throws']) {
  test(`ownership guard ${denied}: no mint or token mutation and sanitized error`, async () => withFixture(async fixture => {
    const original = {...fixture.tokens};
    fixture.options.assertOwned = async () => { if (denied === 'throws') throw new Error(process.env.JWT_SECRET); return false; };
    await assert.rejects(renewFixtureActorTokens(fixture.options), {message: 'FIXTURE_TOKEN_OWNERSHIP_DENIED'});
    assert.equal(fixture.minted(), 0);
    unchanged(fixture.tokens, original);
  }));
}

const malformedInputs = {
  'unknown actor': fixture => { fixture.actors.admin = {...fixture.actors.maker}; },
  'unknown token alias': fixture => { fixture.tokens.admin = fixture.tokens.maker; },
  'missing token': fixture => { delete fixture.tokens.checker; },
  'malformed ID': fixture => { fixture.actors.maker.id = 'not-a-uuid'; },
  'malformed session': fixture => { fixture.actors.maker.session_id = null; },
  'duplicate identity': fixture => { fixture.actors.checker.id = fixture.actors.maker.id; },
  'duplicate session': fixture => { fixture.actors.checker.session_id = fixture.actors.maker.session_id; },
  'frozen token map': fixture => { Object.freeze(fixture.tokens); },
  'token getter': fixture => { Object.defineProperty(fixture.tokens, 'maker', {get: () => 'never read', enumerable: true}); },
  'wrong reason': fixture => { fixture.options.reason = 'on-http-401'; },
  'missing ownership guard': fixture => { fixture.options.assertOwned = undefined; },
  'malformed token': fixture => { fixture.tokens.maker = 'not-a-jwt'; },
  'swapped actor tokens': fixture => { fixture.tokens.maker = fixture.tokens.checker; },
  'extra privilege claims': fixture => { fixture.tokens.maker = jwt.generateAccessToken({id: fixture.actors.maker.id, session_id: fixture.actors.maker.session_id, role: 'admin'}); },
};
for (const [name, mutate] of Object.entries(malformedInputs)) {
  test(`${name} fails before mint/mutation`, async () => withFixture(async fixture => {
    mutate(fixture);
    const original = Object.getOwnPropertyDescriptors(fixture.tokens);
    await assert.rejects(renewFixtureActorTokens(fixture.options), /^Error: FIXTURE_TOKEN_/);
    assert.equal(fixture.minted(), 0);
    const after = Object.getOwnPropertyDescriptors(fixture.tokens);
    assert.equal(Object.keys(after).every(key => after[key].value === original[key].value && after[key].get === original[key].get), true);
  }));
}

test('expired token with a different signing key is rejected before mint', async () => withFixture(async fixture => {
  const actor = fixture.actors.maker;
  fixture.tokens.maker = jsonwebtoken.sign({id: actor.id, session_id: actor.session_id, iat: Math.floor(Date.now() / 1000) - 1801},
    crypto.randomBytes(48).toString('hex'), {algorithm: 'HS256', issuer: 'ruwang-arsip-api', audience: 'ruwang-arsip-access', expiresIn: '30m'});
  const original = {...fixture.tokens};
  await assert.rejects(renewFixtureActorTokens(fixture.options), {message: 'FIXTURE_TOKEN_INVALID'});
  assert.equal(fixture.minted(), 0);
  unchanged(fixture.tokens, original);
}));

for (const claim of ['iss', 'aud']) {
  test(`expired token with wrong ${claim} is rejected before mint`, async () => withFixture(async fixture => {
    const actor = fixture.actors.maker;
    fixture.tokens.maker = jsonwebtoken.sign({id: actor.id, session_id: actor.session_id, iat: Math.floor(Date.now() / 1000) - 1801},
      process.env.JWT_SECRET, {algorithm: 'HS256', issuer: claim === 'iss' ? 'other' : 'ruwang-arsip-api',
        audience: claim === 'aud' ? 'other' : 'ruwang-arsip-access', expiresIn: '30m'});
    const original = {...fixture.tokens};
    await assert.rejects(renewFixtureActorTokens(fixture.options), {message: 'FIXTURE_TOKEN_CLAIMS_INVALID'});
    assert.equal(fixture.minted(), 0);
    unchanged(fixture.tokens, original);
  }));
}

for (const fault of ['bad identity', 'privilege claim', 'long TTL', 'old issue time', 'issuer failure', 'verifier failure']) {
  test(`fresh ${fault} rejects the complete staged renewal without partial update`, async () => withFixture(async fixture => {
    const original = {...fixture.tokens};
    let minted = 0;
    const originalVerifier = fixture.options.verifyAccessToken;
    fixture.options.generateAccessToken = payload => {
      minted++;
      if (minted !== 2) return jwt.generateAccessToken(payload);
      if (fault === 'issuer failure') throw new Error(process.env.JWT_SECRET);
      if (fault === 'bad identity') return jwt.generateAccessToken({...payload, session_id: crypto.randomUUID()});
      if (fault === 'privilege claim') return jwt.generateAccessToken({...payload, permissions: ['*']});
      if (fault === 'old issue time') return jwt.generateAccessToken({...payload, iat: Math.floor(Date.now() / 1000) - 60});
      if (fault === 'long TTL') {
        return jsonwebtoken.sign(payload, process.env.JWT_SECRET, {algorithm: 'HS256', issuer: 'ruwang-arsip-api',
          audience: 'ruwang-arsip-access', expiresIn: '1h'});
      }
      return jwt.generateAccessToken(payload);
    };
    fixture.options.verifyAccessToken = token => {
      if (fault === 'verifier failure' && minted === 2) throw new Error(process.env.JWT_SECRET);
      return originalVerifier(token);
    };
    await assert.rejects(renewFixtureActorTokens(fixture.options), {message: fault === 'issuer failure' ? 'FIXTURE_TOKEN_ISSUER_FAILED' : 'FIXTURE_TOKEN_FRESH_INVALID'});
    assert.equal(minted, 2);
    unchanged(fixture.tokens, original);
  }));
}

test('a token map made read-only during staging is rejected before commit', async () => withFixture(async fixture => {
  const original = {...fixture.tokens};
  const mint = fixture.options.generateAccessToken;
  fixture.options.generateAccessToken = payload => { Object.freeze(fixture.tokens); return mint(payload); };
  await assert.rejects(renewFixtureActorTokens(fixture.options), {message: 'FIXTURE_TOKEN_INPUT_CHANGED'});
  unchanged(fixture.tokens, original);
}));
