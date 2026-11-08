const test = require('node:test');
const assert = require('node:assert/strict');

test('every refresh lookup/revocation uses owner-scoped RLS, never the system client', async () => {
  const rlsPath = require.resolve('../../config/database-rls');
  const repositoryPath = require.resolve('./auth.repository');
  const originalRls = require.cache[rlsPath];
  const originalRepository = require.cache[repositoryPath];
  const calls = [];
  const userId = 'a8627f06-daa8-4f88-b2a9-f10c8a5217ea';
  const client = { refresh_tokens: {
    findFirst: async query => { calls.push(query); return null; },
    updateMany: async query => { calls.push(query); return { count: 0 }; },
  }};
  require.cache[rlsPath] = { id: rlsPath, filename: rlsPath, loaded: true, exports: {
    withRlsUserContext: async (owner, callback) => { assert.equal(owner, userId); return callback(client); },
    withSystemDatabaseClient: () => assert.fail('refresh must not use system bypass'),
  }};
  delete require.cache[repositoryPath];
  let repository;
  try { repository = require(repositoryPath); }
  finally {
    if (originalRls) require.cache[rlsPath] = originalRls; else delete require.cache[rlsPath];
    if (originalRepository) require.cache[repositoryPath] = originalRepository; else delete require.cache[repositoryPath];
  }
  await repository.findActiveRefreshTokenByHash('hash', userId);
  await repository.findRecentlyReplacedRefreshTokenByHash({ tokenHash: 'hash', revokedAfter: new Date(), userId });
  await repository.findActiveRefreshTokenByIdAndUserId({ id: 'session', userId });
  await repository.findRefreshTokenByIdAndUserId({ id: 'session', userId });
  await repository.findActiveRefreshTokenIdentityByHash('hash', userId);
  await repository.revokeActiveRefreshTokenByHash('hash', new Date(), userId);
  assert.equal(calls.length, 6);
  for (const query of calls) assert.equal(query.where.user_id, userId);
});
