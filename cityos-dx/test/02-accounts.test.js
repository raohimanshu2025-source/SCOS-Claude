// Officer accounts: login, roles, CSRF, lockout, password change.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startCity, PASSWORD } from './helpers.js';

let c;
before(async () => { c = await startCity({ config: { loginMaxFailures: 3 } }); });
after(async () => { await c.stop(); });

test('login sets a Secure HttpOnly SameSite cookie and the session acts with the linked certificate', async () => {
  const r = await c.req('POST', '/auth/v1/login', { body: { username: 'officer.wd', password: PASSWORD } });
  assert.equal(r.status, 200);
  assert.match(r.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Strict/);
  const s = await c.login('officer.wd');
  const me = await s.as('GET', '/auth/v1/me');
  assert.equal(me.body.principal.email, 'officer@wd.demo-city.example');
  assert.equal(me.body.principal.cls, 3);
  assert.equal(me.body.principal.role, 'provider');
});

test('wrong password is refused with the same message as an unknown user', async () => {
  const a = await c.req('POST', '/auth/v1/login', { body: { username: 'officer.wd', password: 'nope-nope-123' } });
  const b = await c.req('POST', '/auth/v1/login', { body: { username: 'nobody', password: 'nope-nope-123' } });
  assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.body.error, b.body.error);
});

test('account locks after repeated failures and an administrator can unlock it', async () => {
  for (let i = 0; i < 3; i++) await c.req('POST', '/auth/v1/login', { body: { username: 'developer', password: 'wrong-password-1' } });
  const locked = await c.req('POST', '/auth/v1/login', { body: { username: 'developer', password: PASSWORD } });
  assert.equal(locked.status, 423);
  const admin = await c.login('admin');
  await admin.as('POST', '/identity/v1/accounts/unlock', { body: { username: 'developer' } });
  assert.equal((await c.req('POST', '/auth/v1/login', { body: { username: 'developer', password: PASSWORD } })).status, 200);
});

test('changes made with a session need the CSRF token', async () => {
  const s = await c.login('officer.transport');
  const without = await c.req('PUT', '/auth/v1/acl?id=urn:demo-cat:fare/fare-revenue', { cookie: s.cookie, body: { C: [] } });
  assert.equal(without.status, 403); assert.match(without.body.error, /CSRF/);
  const withTok = await s.as('PUT', '/auth/v1/acl?id=urn:demo-cat:fare/fare-revenue', { body: { C: [] } });
  assert.equal(withTok.status, 200);
});

test('roles gate the admin and audit screens', async () => {
  const officer = await c.login('officer.mc');
  assert.equal((await officer.as('GET', '/identity/v1/certs')).status, 403);
  assert.equal((await officer.as('GET', '/ops/v1/audit')).status, 403);
  const auditor = await c.login('auditor');
  assert.equal((await auditor.as('GET', '/ops/v1/audit')).status, 200);
  assert.equal((await auditor.as('POST', '/ops/v1/backup', { body: {} })).status, 403, 'auditor is read only');
  assert.equal((await c.req('GET', '/ops/v1/audit')).status, 401);
});

test('weak passwords are refused; password change ends all sessions', async () => {
  const admin = await c.login('admin');
  const weak = await admin.as('POST', '/identity/v1/accounts', { body: { username: 'newbie', password: 'short', role: 'consumer' } });
  assert.equal(weak.status, 400);
  const ok = await admin.as('POST', '/identity/v1/accounts', { body: { username: 'newbie', password: 'Good-password-99', role: 'consumer', displayName: 'New user' } });
  assert.equal(ok.status, 200); assert.equal(ok.body.must_change, 1);
  const s = await c.login('newbie', 'Good-password-99');
  const ch = await s.as('POST', '/auth/v1/password', { body: { old: 'Good-password-99', new: 'Better-password-100' } });
  assert.equal(ch.status, 200);
  assert.equal((await s.as('GET', '/auth/v1/me')).body.principal.role, 'anonymous', 'old session ended');
});

test('logout ends the session', async () => {
  const s = await c.login('planner');
  await s.as('POST', '/auth/v1/logout');
  assert.equal((await s.as('GET', '/auth/v1/me')).body.principal.role, 'anonymous');
});
