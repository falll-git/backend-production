// Actual bank auth/notification HTTP routes against the live, proved run-owned
// non-owner, non-superuser, non-BYPASSRLS role. Never log tokens/cookies/passwords.
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('node:fs');
const path = require('node:path');
const { hashToken } = require('../../utils/auth-onboarding');

exports.run = async ({ app, proof, actors, password }) => {
  const checks = [], userAgent = 'owned-auth-proof-' + proof.runId;
  const cookieName = process.env.AUTH_REFRESH_COOKIE_NAME;
  const cookie = response => {
    const header = (response.headers['set-cookie'] || []).map(h => h.split(';')[0])
      .find(h => h.startsWith(cookieName + '=') && h.length > cookieName.length + 1);
    assert.ok(header, 'refresh cookie missing'); return header;
  };
  const access = response => response.body.data.token;
  const expectStatus = (response, code, label) => {
    if (response.status !== code) {
      // Private test evidence only; no headers, cookies, credentials or auth body.
      const message = String(response.body.message || '').replace(/postgres(?:ql)?:\/\/\S+/g, '[database]');
      fs.writeFileSync(path.join(proof.root, 'auth-failure.json'), JSON.stringify({ label, status: response.status, message }, null, 2));
    }
    assert.equal(response.status, code, label);
  };
  const login = await request(app).post('/api/v1/auth/login').set('User-Agent', userAgent)
    .send({ username: 'browserMaker-' + proof.runId, password });
  expectStatus(login, 200, 'real password login');
  const oldCookie = cookie(login);
  assert.ok(access(login));
  assert.ok((login.headers['set-cookie'] || []).some(h => h.startsWith(cookieName + '=') && /;\s*HttpOnly(?:;|$)/i.test(h)));
  checks.push({ check: 'real password login and HttpOnly refresh cookie', pass: true });
  const { withRlsUserContext } = require('../../config/database-rls');
  const notificationPrivileges = await withRlsUserContext(actors.browserMaker.id, c => c.$queryRaw`
    SELECT t, has_table_privilege(current_user, t, 'SELECT') AS can_read
    FROM unnest(ARRAY['public.digital_document_access_requests', 'public.digital_document_loans',
      'public.incoming_mail_dispositions', 'public.memorandum_dispositions', 'public.notifications']) t
  `);
  fs.writeFileSync(path.join(proof.root, 'notification-privileges.json'), JSON.stringify(notificationPrivileges, null, 2));
  try {
    const { runWithDatabaseUserContext } = require('../../config/database-context');
    await runWithDatabaseUserContext(actors.browserMaker.id, () => require('../../modules/notifications/notifications.service')
      .getAll({ query: { limit: 10 }, userId: actors.browserMaker.id }));
  } catch (error) {
    fs.writeFileSync(path.join(proof.root, 'notification-diagnostic.json'), JSON.stringify({
      name: error.name, code: error.code,
      message: String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, '[database]'),
      causeCode: error.cause?.code,
    }, null, 2));
    throw error;
  }
  for (const endpoint of ['/users/me', '/notifications?limit=10', '/notifications/unread-count']) {
    const response = await request(app).get('/api/v1' + endpoint).set('Authorization', 'Bearer ' + access(login));
    expectStatus(response, 200, endpoint);
  }
  checks.push({ check: 'users/me and notification list/count succeed under actual owner RLS', pass: true });
  const rotations = await Promise.all(Array.from({ length: 6 }, () => request(app)
    .post('/api/v1/auth/refresh').set('User-Agent', userAgent).set('Cookie', oldCookie).send({ remember: false })));
  for (const r of rotations) expectStatus(r, 200, 'parallel refresh');
  const replacements = new Set(rotations.map(cookie));
  assert.equal(replacements.size, 1, 'one replacement, not six sessions');
  const replacement = cookie(rotations[0]);
  assert.notEqual(replacement, oldCookie);
  const own = await withRlsUserContext(actors.browserMaker.id, c => c.refresh_tokens.findMany({ where: { revoked_at: null } }));
  assert.equal(own.length, 1);
  assert.equal(own[0].token_hash, hashToken(decodeURIComponent(replacement.slice(cookieName.length + 1))));
  const foreign = await withRlsUserContext(actors.checker.id, c => c.refresh_tokens.findMany({ where: { user_id: actors.browserMaker.id } }));
  assert.deepEqual(foreign, []);
  checks.push({ check: 'six concurrent refreshes produce one active session; other user cannot read its tokens', pass: true });
  const wrongClient = await request(app).post('/api/v1/auth/refresh').set('User-Agent', userAgent + '-other')
    .set('Cookie', oldCookie).send({ remember: false });
  expectStatus(wrongClient, 401, 'old cookie recovery rejects other client');
  const invalid = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookieName + '=tampered').send({ remember: false });
  expectStatus(invalid, 401, 'tampered refresh rejected');
  const logout = await request(app).post('/api/v1/auth/logout').set('Cookie', replacement).send({});
  expectStatus(logout, 200, 'cookie logout');
  const revoked = await request(app).post('/api/v1/auth/refresh').set('User-Agent', userAgent).set('Cookie', replacement).send({ remember: false });
  expectStatus(revoked, 401, 'revoked session cannot refresh');
  const revokedAccess = await request(app).get('/api/v1/users/me').set('Authorization', 'Bearer ' + access(rotations[0]));
  expectStatus(revokedAccess, 401, 'revoked access rejected');
  checks.push({ check: 'mismatched recovery/tampered cookie rejected; logout revokes refresh and access', pass: true });
  const relogin = await request(app).post('/api/v1/auth/login').set('User-Agent', userAgent)
    .send({ username: 'browserMaker-' + proof.runId, password });
  expectStatus(relogin, 200, 'relogin');
  const bearerLogout = await request(app).post('/api/v1/auth/logout').set('Authorization', 'Bearer ' + access(relogin)).send({});
  expectStatus(bearerLogout, 200, 'bearer logout');
  const afterLogout = await request(app).get('/api/v1/users/me').set('Authorization', 'Bearer ' + access(relogin));
  expectStatus(afterLogout, 401, 'bearer logout revokes access');
  checks.push({ check: 'bearer-only logout persists revocation and relogin uses actual password validation', pass: true });
  return { check: 'bank auth/RLS real API proof, not browser or test double auth', pass: true, checks };
};
